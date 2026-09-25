// supabase/functions/send-monthly-billing-report/index.ts
//
// Edge Function que:
//   1. Determina el periodo pedido (year/month explicitos; si faltan, el mes
//      en curso en hora de Chile — solo para el cron).
//   2. Si el mes esta CERRADO, usa su snapshot persistido (no recalcula).
//      Si no, calcula los cobros con el motor compartido (_shared/billing.ts),
//      el mismo que usa el dashboard.
//   3. Si se pide close=true (mes en curso o anterior), congela el mes:
//      persiste el snapshot via RPC close_billing_period.
//   4. Genera el CSV, lo sube a Storage (bucket privado) con link firmado y
//      envia el resumen a Teams.
//
// Triggers:
//   - Boton "Forzar envio cobros" del Dashboard (siempre con periodo explicito)
//   - Cron opcional (ver supabase/README.md)
//
// Secrets requeridos:
//   - TEAMS_WEBHOOK_COBROS   (URL del Workflow del canal "Notificaciones - Cobros")
//   - TEST_MODE              (opcional: si "1", usa TEAMS_WEBHOOK_TEST)
//   - TEAMS_WEBHOOK_TEST     (opcional)
//   - BILLING_CLOSE_ALLOWED_EMAILS (opcional: emails separados por coma que pueden
//     cerrar meses; si no se define, cualquier usuario autenticado puede cerrar)
//
// Storage:
//   - Bucket: "reportes-cobros" (privado)
//   - Path: "YYYY/reporte_cobros_YYYY-MM.csv"
//   - Link firmado con expiracion configurable
//
// Payload del POST:
//   { year?: number, month?: number, close?: boolean, forceMode?: "manual" | "cron" }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { businessToday, serializeYearMonth, type YearMonth } from "../_shared/period.ts";
import {
  BILLING_ENGINE_VERSION,
  DEFAULT_PRICING,
  SELLER_BILLING_COLUMNS,
  billingLineFromRow,
  billingLineToRow,
  billingSellerFromRow,
  buildBillingContext,
  buildBillingCsv,
  canClosePeriod,
  closedPeriodInfoFromRow,
  computeMonthLines,
  mapPricingConfig,
  parseBillingReportRequest,
  summarizeBillingLines,
  type BillingLine,
  type ClosedPeriodInfo,
} from "../_shared/billing.ts";

// ============================================================
//   CONFIG
// ============================================================

// Storage
const STORAGE_BUCKET = "reportes-cobros";
const SIGNED_URL_EXPIRY_SECONDS = 60 * 60 * 24 * 30; // 30 dias
// Limite de filas por respuesta de PostgREST
const PAGE_SIZE = 1000;

// ============================================================
//   CORS
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============================================================
//   LECTURA DE DATOS
// ============================================================

type ReportSource = "snapshot" | "calculado";

async function loadClosedPeriod(
  supabase: SupabaseClient,
  periodKey: string
): Promise<{ info: ClosedPeriodInfo | null; lines: BillingLine[]; error: string | null }> {
  const { data, error } = await supabase
    .from("billing_periods")
    .select("period, closed_at, closed_by, source, engine_version")
    .eq("period", periodKey)
    .maybeSingle();
  if (error) return { info: null, lines: [], error: error.message };
  const info = closedPeriodInfoFromRow(data);
  if (!info) return { info: null, lines: [], error: null };

  const lines: BillingLine[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: page, error: linesError } = await supabase
      .from("billing_period_lines")
      .select("*")
      .eq("period", periodKey)
      .order("sid")
      .range(from, from + PAGE_SIZE - 1);
    if (linesError) return { info, lines: [], error: linesError.message };
    (page || []).forEach((row: unknown) => {
      const line = billingLineFromRow(row);
      if (line) lines.push(line);
    });
    if (!page || page.length < PAGE_SIZE) break;
  }
  lines.sort((a, b) => a.sid.localeCompare(b.sid));
  return { info, lines, error: null };
}

async function computeLines(
  supabase: SupabaseClient,
  period: YearMonth
): Promise<{ lines: BillingLine[]; pricing: unknown; error: string | null }> {
  const [{ data: sellers, error: errSellers }, { data: pricingRow, error: errPricing }] = await Promise.all([
    supabase.from("sellers").select(SELLER_BILLING_COLUMNS),
    supabase.from("pricing_config").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (errSellers) return { lines: [], pricing: null, error: "Error leyendo sellers: " + errSellers.message };
  if (errPricing) console.warn("[billing] pricing_config:", errPricing.message);
  const pricing = pricingRow ? mapPricingConfig(pricingRow) : DEFAULT_PRICING;
  const rows = ((sellers || []) as unknown[]).map(billingSellerFromRow);
  return { lines: computeMonthLines(rows, period, buildBillingContext(rows, pricing)), pricing, error: null };
}

// ============================================================
//   QUIEN PIDE EL CIERRE
// ============================================================

type Requester = { kind: "service" | "user" | "anonymous"; email: string | null };

async function resolveRequester(req: Request, supabase: SupabaseClient, serviceKey: string): Promise<Requester> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { kind: "anonymous", email: null };
  if (token === serviceKey) return { kind: "service", email: null };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { kind: "anonymous", email: null };
  return { kind: "user", email: data.user.email ?? null };
}

function closeDeniedReason(requester: Requester): string | null {
  if (requester.kind === "service") return null;
  if (requester.kind === "anonymous" || !requester.email) return "Cerrar un mes requiere un usuario autenticado";
  const allowed = (Deno.env.get("BILLING_CLOSE_ALLOWED_EMAILS") || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(requester.email.toLowerCase()))
    return "El usuario " + requester.email + " no esta autorizado para cerrar meses";
  return null;
}

// ============================================================
//   ADAPTIVE CARD
// ============================================================

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function buildAdaptiveCard(
  rows: BillingLine[],
  period: YearMonth,
  statusText: string,
  downloadUrl: string | null,
  downloadError: string | null,
  forceMode: string,
  isTest: boolean
): unknown {
  const mesNombre = MONTH_NAMES_ES[period.month - 1];
  const periodKey = serializeYearMonth(period);
  const totals = summarizeBillingLines(rows);

  const testBanner = isTest
    ? [
        {
          type: "Container",
          style: "warning",
          bleed: true,
          items: [
            {
              type: "TextBlock",
              text: "🧪 **MODO TEST** — En produccion este mensaje iria a: **Notificaciones — Cobros**",
              wrap: true,
              size: "Small",
            },
          ],
        },
      ]
    : [];

  // Bloque con el link de descarga (o mensaje de error si fallo)
  const downloadBlock: unknown[] = downloadUrl
    ? [
        {
          type: "TextBlock",
          text: "📥 **Descargar CSV:**",
          wrap: true,
          spacing: "Medium",
        },
        {
          type: "TextBlock",
          text: "[reporte_cobros_" + periodKey + ".csv](" + downloadUrl + ")",
          wrap: true,
        },
        {
          type: "TextBlock",
          text: "⏱️ El link se vence en 30 dias.",
          size: "Small",
          isSubtle: true,
          spacing: "None",
        },
      ]
    : [
        {
          type: "Container",
          style: "attention",
          items: [
            {
              type: "TextBlock",
              text: "⚠️ No se pudo subir el CSV a Storage: " + (downloadError || "error desconocido"),
              wrap: true,
              size: "Small",
            },
          ],
        },
      ];

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      ...testBanner,
      {
        type: "Container",
        style: "good",
        bleed: true,
        items: [
          {
            type: "TextBlock",
            text: "💰 Reporte de Cobros — " + mesNombre + " " + period.year,
            weight: "Bolder",
            size: "Large",
            wrap: true,
          },
          {
            type: "TextBlock",
            text: "Envio " + (forceMode === "manual" ? "manual (forzado)" : "automatico (cron)"),
            size: "Small",
            isSubtle: true,
            spacing: "None",
          },
        ],
      },
      {
        type: "FactSet",
        facts: [
          { title: "Estado:", value: statusText },
          { title: "Sellers facturados:", value: String(rows.length) },
          { title: "Monto Neto total:", value: "$" + totals.neto.toLocaleString("es-CL") },
          { title: "Descuento total:", value: "$" + totals.descuento.toLocaleString("es-CL") },
          { title: "Monto Bruto total:", value: "$" + totals.bruto.toLocaleString("es-CL") },
        ],
      },
      ...downloadBlock,
    ],
    msteams: { width: "Full" },
  };
}

// ============================================================
//   UPLOAD A SUPABASE STORAGE
// ============================================================

async function uploadCsvToStorage(
  supabase: SupabaseClient,
  csv: string,
  period: YearMonth
): Promise<{ url: string | null; error: string | null }> {
  try {
    // BOM UTF-8 al inicio para que Excel abra correctamente las tildes
    const bom = "﻿";
    const csvBytes = new TextEncoder().encode(bom + csv);

    const periodKey = serializeYearMonth(period);
    const filePath = period.year + "/reporte_cobros_" + periodKey + ".csv";

    // Upload (upsert: un mes cerrado siempre se regenera desde su snapshot,
    // asi que sobrescribir no cambia sus montos)
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, csvBytes, {
        contentType: "text/csv; charset=utf-8",
        upsert: true,
      });

    if (uploadError) {
      return { url: null, error: "upload: " + uploadError.message };
    }

    // Generar link firmado con expiracion
    const { data: signedData, error: signedError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(filePath, SIGNED_URL_EXPIRY_SECONDS);

    if (signedError) {
      return { url: null, error: "signed: " + signedError.message };
    }

    return { url: signedData?.signedUrl || null, error: null };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : "Error desconocido" };
  }
}

// ============================================================
//   ENVIO A TEAMS
// ============================================================

async function postToTeams(webhookUrl: string, card: unknown) {
  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: card,
      },
    ],
  };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

// ============================================================
//   HANDLER
// ============================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Parse payload (opcional)
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Periodo objetivo: explicito; si falta, el mes en curso en hora de negocio (Chile).
  const today = businessToday(new Date());
  const parsed = parseBillingReportRequest(body, today.ym);
  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
  }
  const { period, close, forceMode } = parsed;
  const periodKey = serializeYearMonth(period);

  // Conectar a Supabase con service role (necesario para leer sin RLS)
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: "Faltan credenciales SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Webhook de Teams
  const TEST_MODE = Deno.env.get("TEST_MODE") === "1";
  const URL_COBROS = Deno.env.get("TEAMS_WEBHOOK_COBROS");
  const URL_TEST = Deno.env.get("TEAMS_WEBHOOK_TEST");
  const webhookUrl = TEST_MODE ? URL_TEST : URL_COBROS;

  if (!webhookUrl) {
    return json(
      {
        error: TEST_MODE
          ? "TEST_MODE activo pero TEAMS_WEBHOOK_TEST no configurado"
          : "TEAMS_WEBHOOK_COBROS no configurado",
      },
      500
    );
  }

  // 1. ¿Mes cerrado? Entonces manda el snapshot, nunca un recalculo.
  const closed = await loadClosedPeriod(supabase, periodKey);
  if (closed.error) {
    // Sin la migracion aplicada el reporte sigue funcionando como antes,
    // pero no se puede cerrar.
    console.warn("[billing] snapshots no disponibles:", closed.error);
    if (close) return json({ error: "No se pudo leer billing_periods (¿migracion aplicada?): " + closed.error }, 500);
  }

  let lines: BillingLine[];
  let source: ReportSource;
  let closedNow = false;
  let statusText: string;

  if (closed.info) {
    lines = closed.lines;
    source = "snapshot";
    statusText = "Cerrado el " + businessToday(new Date(closed.info.closedAt)).date + " (snapshot)";
  } else {
    let requester: Requester | null = null;
    if (close) {
      if (!canClosePeriod(period, today.ym)) {
        return json({ error: "Solo se puede cerrar el mes en curso o el anterior (pedido: " + periodKey + ")" }, 400);
      }
      requester = await resolveRequester(req, supabase, supabaseKey);
      const denied = closeDeniedReason(requester);
      if (denied) return json({ error: denied }, 403);
    }
    const computed = await computeLines(supabase, period);
    if (computed.error) return json({ error: computed.error }, 500);
    lines = computed.lines;
    source = "calculado";
    statusText = "Preliminar (mes sin cierre)";

    if (requester && lines.length > 0) {
      const { error: closeError } = await supabase.rpc("close_billing_period", {
        p_period: periodKey,
        p_meta: {
          closed_by: requester.email ?? (requester.kind === "service" ? "service_role" : null),
          source: forceMode === "manual" ? "manual" : "cron",
          engine_version: BILLING_ENGINE_VERSION,
          pricing_config_snapshot: computed.pricing,
          totals: summarizeBillingLines(lines),
        },
        p_lines: lines.map(billingLineToRow),
      });
      if (closeError) {
        return json({ error: "No se pudo cerrar " + periodKey + ": " + closeError.message }, 409);
      }
      closedNow = true;
      statusText = "Cerrado ahora (" + today.date + ")";
    }
  }

  if (lines.length === 0) {
    return json(
      {
        ok: false,
        warning: "No hay sellers con cobro para " + periodKey,
        year: period.year,
        month: period.month,
      },
      200
    );
  }

  // Generar CSV (mismas columnas que antes)
  const csv = buildBillingCsv(lines);

  // Subir a Supabase Storage y obtener link firmado
  const { url: downloadUrl, error: uploadError } = await uploadCsvToStorage(supabase, csv, period);

  // Construir card con el link de descarga (o mensaje de error si fallo el upload)
  const card = buildAdaptiveCard(lines, period, statusText, downloadUrl, uploadError, forceMode, TEST_MODE);

  // Enviar a Teams
  const res = await postToTeams(webhookUrl, card);

  return json(
    {
      ok: res.ok && !uploadError,
      year: period.year,
      month: period.month,
      period: periodKey,
      sellersFacturados: lines.length,
      source,
      closed: source === "snapshot" || closedNow,
      closedNow,
      engineVersion: BILLING_ENGINE_VERSION,
      forceMode,
      testMode: TEST_MODE,
      storage: {
        uploaded: !uploadError,
        url: downloadUrl,
        error: uploadError,
      },
      teams: { status: res.status, body: res.body },
    },
    res.ok && !uploadError ? 200 : 502
  );
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
