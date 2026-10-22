// supabase/functions/send-seller-notification/index.ts
//
// Edge Function que recibe un evento de seller (created / fuga / pausa / reactivacion)
// y publica una Adaptive Card en 2 canales de Teams: Data y Soporte.
//
// Webhooks de Teams (Power Automate Workflows) se guardan como Secrets en Supabase.
//
// Setup: ver docs/SETUP_TEAMS.md
//
// Deploy:
//   supabase functions deploy send-seller-notification
//
// Secrets:
//   supabase secrets set TEAMS_WEBHOOK_DATA="https://prod-XX.../triggers/manual/..."
//   supabase secrets set TEAMS_WEBHOOK_SOPORTE="https://prod-XX.../triggers/manual/..."
//   supabase secrets set TEAMS_WEBHOOK_TEST="https://prod-XX.../triggers/manual/..."  (opcional)
//
// Secrets opcionales para envio adicional a un 2do canal por audiencia:
//   supabase secrets set TEAMS_WEBHOOK_DATA_2="https://prod-XX.../triggers/manual/..."
//   supabase secrets set TEAMS_WEBHOOK_SOPORTE_2="https://prod-XX.../triggers/manual/..."
//
// Si estos secrets _2 estan configurados, la misma card se publica tambien en esos
// canales (replica exacta). Si no estan configurados, se omiten silenciosamente.
// NOTA: los canales _2 NO se usan en modo test para evitar duplicar mensajes en Tests.
//
// Modo test: si TEST_MODE=1 esta seteado, todos los mensajes van al canal Tests.
//   supabase secrets set TEST_MODE=1     (activar)
//   supabase secrets unset TEST_MODE     (desactivar = produccion)
//
// Sin duplicados (oct-2026): el mismo aviso (evento|sid|fecha) se publica una sola vez
// cada 5 minutos. Un segundo clic en Confirmar/Guardar invocaba esta funcion dos veces
// y Teams recibia todo doble. Usa se_reservar_aviso / se_liberar_aviso
// (supabase/migrations/20261022160000_avisos_sin_duplicados.sql).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================
//   TIPOS
// ============================================================

type EventType = "created" | "fuga" | "pausa" | "reactivacion";

interface NotificationPayload {
  event: EventType;
  seller: {
    sid: string;
    seller: string;
    mail: string;
    contacto?: string;
    seccion?: string;
    tipo?: string;
    kam?: string;
  };
  eventDate?: string; // ISO date "YYYY-MM-DD"
  kamEmail: string;
}

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
//   CONFIGURACION POR EVENTO
// ============================================================
//
// Cada evento tiene un titulo, color y accion especifica para cada audiencia.
// Esto reemplaza las plantillas HTML de la version Resend.

interface EventConfig {
  emoji: string;
  color: "Good" | "Warning" | "Attention" | "Accent"; // colores de Adaptive Cards
  data: {
    title: string;
    action: string; // que se le pide al equipo Data
  };
  support: {
    title: string;
    action: string; // que se le pide al equipo Soporte
  };
}

const EVENT_CONFIG: Record<EventType, EventConfig> = {
  created: {
    emoji: "🆕",
    color: "Good",
    data: {
      title: "Nuevo seller en Cobros",
      action:
        "Por favor, **crear la cuenta** del seller en el reporte de Looker para que pueda acceder a sus metricas.",
    },
    support: {
      title: "Nuevo seller en Cobros",
      action:
        "Por favor:\r1. **Crear la cuenta** del seller en Salesforce.\r2. **Derivar** al seller a un Analista de Soporte.",
    },
  },
  fuga: {
    emoji: "🔴",
    color: "Attention",
    data: {
      title: "Seller dado de baja (Fuga)",
      action:
        "Por favor, **dar de baja** la cuenta del seller en el reporte de Looker para revocar su acceso.",
    },
    support: {
      title: "Seller dado de baja (Fuga)",
      action:
        "Por favor, **cerrar el caso en Salesforce** y liberar al Analista de Soporte asignado.",
    },
  },
  pausa: {
    emoji: "⏸️",
    color: "Warning",
    data: {
      title: "Seller en Pausa",
      action:
        "Por favor, **pausar (no eliminar)** el acceso del seller al reporte de Looker mientras dure la suspension.",
    },
    support: {
      title: "Seller en Pausa",
      action:
        "Por favor, **marcar el caso en Salesforce como pausado** (no cerrar, podria reactivarse).",
    },
  },
  reactivacion: {
    emoji: "▶️",
    color: "Accent",
    data: {
      title: "Seller reactivado",
      action:
        "Este seller estaba en Pausa y volvio a Iniciado. Por favor, **reactivar su cuenta** en el reporte de Looker.",
    },
    support: {
      title: "Seller reactivado",
      action:
        "Este seller estaba en Pausa y volvio a Iniciado. Por favor, **reactivar el caso en Salesforce** y reasignar al Analista de Soporte.",
    },
  },
};

// ============================================================
//   HELPERS DE FECHA
// ============================================================

function formatFechaChilena(iso?: string): string {
  if (!iso) return "—";
  const parts = iso.slice(0, 10).split("-");
  if (parts.length !== 3) return iso;
  const [yyyy, mm, dd] = parts;
  return `${dd}-${mm}-${yyyy}`;
}

function dateLabelFor(event: EventType): string {
  switch (event) {
    case "created":      return "Fecha inicio servicio";
    case "fuga":         return "Fecha de fuga";
    case "pausa":        return "Fecha de pausa";
    case "reactivacion": return "Fecha de reactivacion";
  }
}

// ============================================================
//   SIN DUPLICADOS
// ============================================================
//
// Reserva el aviso en la base antes de publicarlo. Si falla la base, se publica
// igual: es preferible un aviso doble a uno perdido.

const VENTANA_DUPLICADOS_SEG = 300;

function claveAviso(payload: NotificationPayload): string {
  return [payload.event, String(payload.seller.sid), String(payload.eventDate ?? "").slice(0, 10)].join("|");
}

function clienteBase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function reservarAviso(clave: string): Promise<boolean> {
  try {
    const db = clienteBase();
    if (!db) return true;
    const { data, error } = await db.rpc("se_reservar_aviso", {
      p_clave: clave,
      p_ventana_segundos: VENTANA_DUPLICADOS_SEG,
    });
    if (error) {
      console.error("[sin duplicados] no se pudo reservar, se publica igual:", error.message);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error("[sin duplicados] error, se publica igual:", e);
    return true;
  }
}

async function liberarAviso(clave: string): Promise<void> {
  try {
    const db = clienteBase();
    if (!db) return;
    const { error } = await db.rpc("se_liberar_aviso", { p_clave: clave });
    if (error) console.error("[sin duplicados] no se pudo liberar:", error.message);
  } catch (e) {
    console.error("[sin duplicados] error al liberar:", e);
  }
}

// ============================================================
//   ADAPTIVE CARD BUILDER
// ============================================================
//
// Las Adaptive Cards son el formato moderno de tarjetas en Teams.
// Spec: https://adaptivecards.io/explorer/

function buildAdaptiveCard(
  audience: "data" | "support",
  payload: NotificationPayload,
  isTest: boolean,
  realChannelName: string
): unknown {
  const cfg = EVENT_CONFIG[payload.event];
  const audCfg = audience === "data" ? cfg.data : cfg.support;
  const { seller, kamEmail } = payload;

  // Banner de modo test (solo si aplica)
  const testBanner = isTest
    ? [
        {
          type: "Container",
          style: "warning",
          bleed: true,
          items: [
            {
              type: "TextBlock",
              text: `🧪 **MODO TEST** — En produccion este mensaje iria a: **${realChannelName}**`,
              wrap: true,
              size: "Small",
            },
          ],
        },
      ]
    : [];

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.4",
    body: [
      ...testBanner,
      // Header con emoji + titulo + color de evento
      {
        type: "Container",
        style: cfg.color === "Good" ? "good"
              : cfg.color === "Attention" ? "attention"
              : cfg.color === "Warning" ? "warning"
              : "emphasis",
        bleed: true,
        items: [
          {
            type: "TextBlock",
            text: `${cfg.emoji} ${audCfg.title}`,
            weight: "Bolder",
            size: "Large",
            wrap: true,
          },
          {
            type: "TextBlock",
            text: `Audiencia: Equipo ${audience === "data" ? "Data" : "Soporte"}`,
            size: "Small",
            isSubtle: true,
            spacing: "None",
          },
        ],
      },
      // Datos del seller en formato fact-set
      {
        type: "FactSet",
        facts: [
          { title: `${dateLabelFor(payload.event)}:`, value: formatFechaChilena(payload.eventDate) },
          { title: "Seller:", value: seller.seller || "—" },
          { title: "Seller ID:", value: seller.sid || "—" },
          { title: "Contacto:", value: seller.contacto || "—" },
          { title: "Email seller:", value: seller.mail || "—" },
          { title: "Seccion:", value: seller.seccion || "—" },
          { title: "Plan:", value: seller.tipo || "—" },
          { title: "KAM:", value: seller.kam || "—" },
          { title: "Iniciado por:", value: kamEmail || "—" },
        ],
      },
      // Accion solicitada
      {
        type: "TextBlock",
        text: "**Accion requerida:**",
        wrap: true,
        spacing: "Medium",
      },
      {
        type: "TextBlock",
        text: audCfg.action,
        wrap: true,
      },
    ],
    msteams: {
      width: "Full",
    },
  };
}

// ============================================================
//   ENVIO A TEAMS
// ============================================================

async function postToTeams(
  webhookUrl: string,
  card: unknown
): Promise<{ ok: boolean; status: number; body: string }> {
  // Power Automate Workflows espera el formato estandar de mensaje de Teams
  // con la card como attachment.
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

  // Leer config desde Supabase Secrets
  const URL_DATA = Deno.env.get("TEAMS_WEBHOOK_DATA");
  const URL_DATA_2 = Deno.env.get("TEAMS_WEBHOOK_DATA_2");       // opcional
  const URL_SOPORTE = Deno.env.get("TEAMS_WEBHOOK_SOPORTE");
  const URL_SOPORTE_2 = Deno.env.get("TEAMS_WEBHOOK_SOPORTE_2"); // opcional
  const URL_TEST = Deno.env.get("TEAMS_WEBHOOK_TEST");
  const TEST_MODE = Deno.env.get("TEST_MODE") === "1";

  if (TEST_MODE && !URL_TEST) {
    return json(
      { error: "TEST_MODE activo pero TEAMS_WEBHOOK_TEST no esta configurado" },
      500
    );
  }
  if (!TEST_MODE && (!URL_DATA || !URL_SOPORTE)) {
    return json(
      { error: "TEAMS_WEBHOOK_DATA y/o TEAMS_WEBHOOK_SOPORTE no configurados" },
      500
    );
  }

  // Parsear payload
  let payload: NotificationPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body no es JSON valido" }, 400);
  }

  const validEvents: EventType[] = ["created", "fuga", "pausa", "reactivacion"];
  if (!payload?.event || !validEvents.includes(payload.event)) {
    return json(
      { error: `event invalido. Debe ser uno de: ${validEvents.join(", ")}` },
      400
    );
  }
  if (!payload.seller?.sid || !payload.seller?.seller) {
    return json(
      { error: "seller.sid y seller.seller son obligatorios" },
      400
    );
  }

  // Sin duplicados: si este mismo aviso ya se publico hace menos de 5 minutos, no se repite
  const clave = claveAviso(payload);
  if (!(await reservarAviso(clave))) {
    console.log("[sin duplicados] omitido:", clave);
    return json({ ok: true, event: payload.event, duplicado: true });
  }
  // Para probar el filtro sin publicar en Teams: seller ID que empieza con PRUEBA-NO-ENVIAR
  if (String(payload.seller.sid).startsWith("PRUEBA-NO-ENVIAR")) {
    return json({ ok: true, event: payload.event, duplicado: false, prueba: true });
  }

  // Armar las 2 cards (una para Data, una para Soporte)
  const dataCard = buildAdaptiveCard(
    "data",
    payload,
    TEST_MODE,
    "Notificaciones — Data"
  );
  const supportCard = buildAdaptiveCard(
    "support",
    payload,
    TEST_MODE,
    "Notificaciones — Soporte"
  );

  // En modo test, ambas van al canal Tests. En produccion, cada una a su canal.
  const dataUrl = TEST_MODE ? URL_TEST! : URL_DATA!;
  const supportUrl = TEST_MODE ? URL_TEST! : URL_SOPORTE!;

  // Determinar los segundos canales (solo en produccion, no en modo test).
  // En modo test ya se envia al canal Tests, no duplicamos ahi.
  const data2Url = !TEST_MODE && URL_DATA_2 ? URL_DATA_2 : null;
  const support2Url = !TEST_MODE && URL_SOPORTE_2 ? URL_SOPORTE_2 : null;

  // Enviar todos en paralelo. Los canales secundarios reciben la misma card.
  const [dataRes, supportRes, data2Res, support2Res] = await Promise.all([
    postToTeams(dataUrl, dataCard),
    postToTeams(supportUrl, supportCard),
    data2Url ? postToTeams(data2Url, dataCard) : Promise.resolve(null),
    support2Url ? postToTeams(support2Url, supportCard) : Promise.resolve(null),
  ]);

  const allOk =
    dataRes.ok &&
    supportRes.ok &&
    (data2Res === null || data2Res.ok) &&
    (support2Res === null || support2Res.ok);

  // Si Teams rechazo el envio, un reintento tiene que poder publicar
  if (!allOk) await liberarAviso(clave);

  return json(
    {
      ok: allOk,
      event: payload.event,
      testMode: TEST_MODE,
      data: { status: dataRes.status, body: dataRes.body },
      support: { status: supportRes.status, body: supportRes.body },
      data2: data2Res
        ? { status: data2Res.status, body: data2Res.body }
        : { skipped: true },
      support2: support2Res
        ? { status: support2Res.status, body: support2Res.body }
        : { skipped: true },
    },
    allOk ? 200 : 502
  );
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
