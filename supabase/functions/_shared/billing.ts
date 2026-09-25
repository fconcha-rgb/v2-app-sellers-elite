/* ════════════════════════════════════════════════════════════════════════════
   MOTOR DE COBRO UNICO — lo usan el dashboard (Vite) y el reporte de Cobros
   (Edge Function send-monthly-billing-report). Antes existian tres motores
   con reglas distintas; este archivo es ahora la unica definicion.

   Reglas de un mes M (solo para meses SIN cierre; los cerrados se leen del
   snapshot persistido y no pasan por aqui):
     · Ventana, corte dia 25:  factura M  ⇔  f_contrato < M-25
                                          y (f_termino vacio  o  f_termino ≥ M-25)
     · Sin f_contrato, o Fuga sin f_termino: no factura (dato incompleto).
     · custom_dctos['YYYY-MM'] reemplaza el monto de ese mes, dentro de la ventana.
     · Individual: tarifa; los primeros `dcto` meses (contados desde el mes
       calendario del contrato) a tarifa × PROMO_DISCOUNT_RATE. Pausa factura.
     · Multicuenta: tarifa_base × % de la posicion en el holding, sin promo.
       Pausa/Fuga quedan fuera de la escalera y no facturan.
   ════════════════════════════════════════════════════════════════════════════ */
import {
  isoDateOf,
  isValidYearMonth,
  makeYearMonth,
  monthsBetween,
  normalizeISODate,
  parseYearMonth,
  serializeYearMonth,
  yearMonthOfISODate,
  type YearMonth,
  type YearMonthKey,
} from './period.ts';

export const BILLING_ENGINE_VERSION = '2.0.0';
export const BILLING_CUTOFF_DAY = 25;
export const PROMO_DISCOUNT_RATE = 0.424412189118071;
export const IVA_FACTOR = 1.19;
/** Ademas del mes en curso, cuantos meses hacia atras se pueden cerrar. */
export const CLOSABLE_MONTHS_BACK = 1;

export const SELLER_STATUS = { active: 'Iniciado', paused: 'Pausa', churned: 'Fuga' } as const;

type UnknownRecord = Record<string, unknown>;
const asRecord = (v: unknown): UnknownRecord => (v && typeof v === 'object' ? (v as UnknownRecord) : {});
const nullableNumber = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

/* ── Pricing (tabla pricing_config y snapshots pricing_override) ─────────── */
export type PricingConfig = {
  tarifaBase: number;
  /** % por posicion 1ª..5ª (escala 0–100) */
  pctPos: [number, number, number, number, number];
  /** % 6ª cuenta y siguientes (tope) */
  pctPos6Plus: number;
  /** cuantas cuentas activas del mismo KAM equivalen a 1 cupo (ceil) */
  cupoDivisor: number;
  updatedAt: string;
  updatedBy: string;
};

export const DEFAULT_PRICING: PricingConfig = {
  tarifaBase: 990000,
  pctPos: [100, 0, 25, 35, 45],
  pctPos6Plus: 50,
  cupoDivisor: 2,
  updatedAt: '',
  updatedBy: '',
};

export const mapPricingConfig = (raw: unknown): PricingConfig => {
  const r = asRecord(raw);
  return {
    tarifaBase: Number(r.tarifa_base ?? DEFAULT_PRICING.tarifaBase),
    pctPos: [
      Number(r.pct_pos1 ?? 100),
      Number(r.pct_pos2 ?? 0),
      Number(r.pct_pos3 ?? 25),
      Number(r.pct_pos4 ?? 35),
      Number(r.pct_pos5 ?? 45),
    ],
    pctPos6Plus: Number(r.pct_pos6_plus ?? 50),
    cupoDivisor: Math.max(1, Number(r.cupo_divisor ?? 2)),
    updatedAt: String(r.updated_at ?? ''),
    updatedBy: String(r.updated_by ?? ''),
  };
};

/** Snapshot de condiciones en sellers.pricing_override; null si no hay. */
export const mapPricingOverride = (raw: unknown): PricingConfig | null => {
  if (!raw) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return null;
    const r = o as UnknownRecord;
    const pct = Array.isArray(r.pctPos) ? r.pctPos : [];
    return {
      tarifaBase: Number(r.tarifaBase ?? 0),
      pctPos: [
        Number(pct[0] ?? 100),
        Number(pct[1] ?? 0),
        Number(pct[2] ?? 25),
        Number(pct[3] ?? 35),
        Number(pct[4] ?? 45),
      ],
      pctPos6Plus: Number(r.pctPos6Plus ?? 50),
      cupoDivisor: Math.max(1, Number(r.cupoDivisor ?? 2)),
      updatedAt: String(r.congeladoEl ?? ''),
      updatedBy: String(r.congeladoPor ?? ''),
    };
  } catch {
    return null;
  }
};

/** % que corresponde al indice 0-based de la escalera (0 = 1ª cuenta). */
export const getPctForPosition = (idx0: number, cfg: PricingConfig): number =>
  idx0 < cfg.pctPos.length ? cfg.pctPos[idx0] : cfg.pctPos6Plus;

/** custom_dctos tal como viene de la DB. Se preserva completo (ida y vuelta
 *  sin perder claves); los valores se validan recien al leer un mes. */
export const parseCustomDctos = (raw: unknown): Record<string, number> => {
  if (!raw) return {};
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, number>) : {};
  } catch {
    return {};
  }
};

/* ── Seller ──────────────────────────────────────────────────────────────── */
export type BillingSeller = {
  sid: string;
  seller: string;
  sec: string;
  kam: string;
  tipo: string;
  status: string;
  tarifa: number;
  fContrato: string;
  fTermino: string;
  dcto: number;
  customDctos: Readonly<Record<string, unknown>>;
  esMulticuenta: boolean;
  principalSid: string;
  pricingOverride?: PricingConfig | null;
};

export const SELLER_BILLING_COLUMNS =
  'sid, seller, seccion, kam, tipo, status, tarifa, f_contrato, f_termino, dcto, custom_dctos, es_multicuenta, principal_sid, pricing_override';

export const billingSellerFromRow = (raw: unknown): BillingSeller => {
  const r = asRecord(raw);
  return {
    sid: String(r.sid ?? ''),
    seller: String(r.seller ?? ''),
    sec: String(r.seccion ?? ''),
    kam: String(r.kam ?? '-'),
    tipo: String(r.tipo ?? ''),
    status: String(r.status ?? ''),
    tarifa: Number(r.tarifa ?? 0),
    fContrato: String(r.f_contrato ?? ''),
    fTermino: String(r.f_termino ?? ''),
    dcto: Number(r.dcto ?? 0),
    customDctos: parseCustomDctos(r.custom_dctos),
    esMulticuenta: !!r.es_multicuenta,
    principalSid: r.principal_sid ? String(r.principal_sid) : '',
    pricingOverride: mapPricingOverride(r.pricing_override),
  };
};

/* ── Multicuenta: escalera de cada holding ───────────────────────────────────
   es_multicuenta y principal_sid vacio → principal; con principal_sid → secundaria.
   Escalera = [principal si esta activa, ...secundarias activas por f_contrato
   ASC (empate: sid)]. Si la principal esta en Pausa/Fuga, la activa mas antigua
   asume el 100% (principal temporal). Se deriva del estado ACTUAL: por eso los
   meses cerrados guardan la posicion aplicada en su snapshot. */
export type HoldingMember = {
  sid: string;
  seller: string;
  status: string;
  fContrato: string;
  esMulticuenta: boolean;
  principalSid: string;
  pricingOverride?: PricingConfig | null;
};

export type HoldingPosition = {
  /** posicion en la escalera (1 = principal efectiva); null si esta inactiva */
  pos: number | null;
  /** % de la tarifa base segun posicion; null si inactiva */
  pct: number | null;
  /** sid de la principal designada del cluster */
  principalSid: string;
  esPrincipalDesignada: boolean;
  /** true cuando esta cuenta asume el 100% porque la designada esta inactiva */
  esPrincipalTemporal: boolean;
  /** total de cuentas del cluster (activas + inactivas) */
  clusterSize: number;
  /** cuentas activas del cluster */
  activas: number;
  /** condiciones del holding (congeladas si las tiene, si no las generales) */
  cfg: PricingConfig;
};

export type HoldingRanking<T extends HoldingMember> = {
  bySid: Map<string, HoldingPosition>;
  /** principales designadas, por nombre */
  principales: T[];
  /** escalera activa por sid de principal */
  ladderOf: Map<string, T[]>;
  /** escalera + inactivas al final, por sid de principal */
  clusterOf: Map<string, T[]>;
  cfgOf: Map<string, PricingConfig>;
  congelados: Set<string>;
  /** secundarias cuyo principal_sid no apunta a una principal valida (facturan individual) */
  huerfanas: string[];
};

const byFechaSid = (a: HoldingMember, b: HoldingMember): number => {
  const fa = a.fContrato || '9999-12-31';
  const fb = b.fContrato || '9999-12-31';
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0;
};

export const rankHoldings = <T extends HoldingMember>(sellers: readonly T[], cfgGlobal: PricingConfig): HoldingRanking<T> => {
  const bySid = new Map<string, HoldingPosition>();
  const ladderOf = new Map<string, T[]>();
  const clusterOf = new Map<string, T[]>();
  const cfgOf = new Map<string, PricingConfig>();
  const congelados = new Set<string>();
  const isActive = (m: T) => m.status === SELLER_STATUS.active;

  const principales = sellers
    .filter((s) => s.esMulticuenta && !s.principalSid)
    .slice()
    .sort((a, b) => a.seller.localeCompare(b.seller));
  const principalSet = new Set(principales.map((p) => p.sid));
  const huerfanas = sellers
    .filter((s) => s.esMulticuenta && s.principalSid && !principalSet.has(s.principalSid))
    .map((s) => s.sid);

  principales.forEach((p) => {
    const cfg = p.pricingOverride || cfgGlobal;
    cfgOf.set(p.sid, cfg);
    if (p.pricingOverride) congelados.add(p.sid);
    const members = [p, ...sellers.filter((s) => s.principalSid === p.sid && s.sid !== p.sid)];
    const activas = members.filter(isActive);
    const principalActiva = isActive(p);
    const ladder = principalActiva
      ? [p, ...activas.filter((m) => m.sid !== p.sid).sort(byFechaSid)]
      : activas.slice().sort(byFechaSid);
    const sucesion = !principalActiva && ladder.length > 0;

    const base = { principalSid: p.sid, clusterSize: members.length, activas: ladder.length, cfg };
    ladder.forEach((m, i) =>
      bySid.set(m.sid, {
        ...base,
        pos: i + 1,
        pct: getPctForPosition(i, cfg),
        esPrincipalDesignada: m.sid === p.sid,
        esPrincipalTemporal: sucesion && i === 0,
      })
    );
    const inactivas = members.filter((m) => !isActive(m));
    inactivas.forEach((m) =>
      bySid.set(m.sid, { ...base, pos: null, pct: null, esPrincipalDesignada: m.sid === p.sid, esPrincipalTemporal: false })
    );
    ladderOf.set(p.sid, ladder);
    clusterOf.set(p.sid, [...ladder, ...inactivas]);
  });

  return { bySid, principales, ladderOf, clusterOf, cfgOf, congelados, huerfanas };
};

/* ── Cobro de un mes ─────────────────────────────────────────────────────── */
export type ChargeKind = 'standard' | 'promo' | 'custom' | 'multicuenta';
export type InactiveReason =
  | 'sin_f_contrato'
  | 'antes_de_inicio'
  | 'terminado'
  | 'fuga_sin_termino'
  | 'fuera_de_escalera';

export type MulticuentaCharge = {
  principalSid: string;
  position: number;
  pct: number;
  tarifaBase: number;
  esPrincipalTemporal: boolean;
};

export type MonthCharge = {
  active: boolean;
  inactiveReason: InactiveReason | null;
  /** neto final del mes */
  amount: number;
  /** neto antes de promo/custom: tarifa (individual) o tarifa_base × % (multicuenta) */
  listAmount: number;
  kind: ChargeKind | null;
  isCustom: boolean;
  isPromo: boolean;
  isDiscount: boolean;
  mc: MulticuentaCharge | null;
};

export type BillingContext = { readonly positions: ReadonlyMap<string, HoldingPosition> };

export const buildBillingContext = (sellers: readonly BillingSeller[], cfgGlobal: PricingConfig): BillingContext => ({
  positions: rankHoldings(sellers, cfgGlobal).bySid,
});

export const billingCutoffDate = (ym: YearMonth): string => isoDateOf(ym, BILLING_CUTOFF_DAY);

export const getBillingWindowStatus = (
  s: Pick<BillingSeller, 'fContrato' | 'fTermino' | 'status'>,
  ym: YearMonth
): InactiveReason | null => {
  const inicio = normalizeISODate(s.fContrato);
  if (!inicio) return 'sin_f_contrato';
  const corte = billingCutoffDate(ym);
  if (inicio >= corte) return 'antes_de_inicio';
  const termino = normalizeISODate(s.fTermino);
  if (termino) return termino < corte ? 'terminado' : null;
  return s.status === SELLER_STATUS.churned ? 'fuga_sin_termino' : null;
};

export const customAmountFor = (s: Pick<BillingSeller, 'customDctos'>, key: YearMonthKey): number | null => {
  const raw = s.customDctos ? s.customDctos[key] : undefined;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const inactive = (reason: InactiveReason): MonthCharge => ({
  active: false,
  inactiveReason: reason,
  amount: 0,
  listAmount: 0,
  kind: null,
  isCustom: false,
  isPromo: false,
  isDiscount: false,
  mc: null,
});

const activeCharge = (amount: number, listAmount: number, kind: ChargeKind, mc: MulticuentaCharge | null): MonthCharge => ({
  active: true,
  inactiveReason: null,
  amount,
  listAmount,
  kind,
  isCustom: kind === 'custom',
  isPromo: kind === 'promo',
  isDiscount: amount < listAmount,
  mc,
});

export const computeMonthCharge = (seller: BillingSeller, ym: YearMonth, ctx: BillingContext): MonthCharge => {
  const reason = getBillingWindowStatus(seller, ym);
  if (reason) return inactive(reason);
  const custom = customAmountFor(seller, serializeYearMonth(ym));

  const holding = ctx.positions.get(seller.sid);
  if (holding) {
    if (holding.pos == null || holding.pct == null) return inactive('fuera_de_escalera');
    const list = Math.round((holding.cfg.tarifaBase * holding.pct) / 100);
    const mc: MulticuentaCharge = {
      principalSid: holding.principalSid,
      position: holding.pos,
      pct: holding.pct,
      tarifaBase: holding.cfg.tarifaBase,
      esPrincipalTemporal: holding.esPrincipalTemporal,
    };
    return custom != null ? activeCharge(custom, list, 'custom', mc) : activeCharge(list, list, 'multicuenta', mc);
  }

  const list = Number(seller.tarifa) || 0;
  if (custom != null) return activeCharge(custom, list, 'custom', null);
  const inicio = yearMonthOfISODate(seller.fContrato);
  const mesesDesdeContrato = inicio ? monthsBetween(inicio, ym) : -1;
  const promo = seller.dcto > 0 && mesesDesdeContrato >= 0 && mesesDesdeContrato < seller.dcto;
  return promo ? activeCharge(Math.round(list * PROMO_DISCOUNT_RATE), list, 'promo', null) : activeCharge(list, list, 'standard', null);
};

/* ── Lineas de billing (lo que se reporta y lo que se congela al cerrar) ── */
export type BillingLine = {
  period: YearMonthKey;
  sid: string;
  sellerName: string;
  seccion: string;
  kam: string;
  tipo: string;
  statusAtClose: string;
  tarifaLista: number;
  descuento: number;
  montoNetoFinal: number;
  montoBruto: number;
  chargeKind: ChargeKind;
  mcPrincipalSid: string | null;
  mcPosition: number | null;
  mcPct: number | null;
  mcTarifaBase: number | null;
  mcPrincipalTemporal: boolean;
};

export const grossAmount = (net: number): number => Math.round(net * IVA_FACTOR);

export const toBillingLine = (seller: BillingSeller, ym: YearMonth, charge: MonthCharge): BillingLine => ({
  period: serializeYearMonth(ym),
  sid: seller.sid,
  sellerName: seller.seller,
  seccion: seller.sec,
  kam: seller.kam,
  tipo: seller.tipo,
  statusAtClose: seller.status,
  tarifaLista: charge.listAmount,
  descuento: charge.listAmount - charge.amount,
  montoNetoFinal: charge.amount,
  montoBruto: grossAmount(charge.amount),
  chargeKind: charge.kind ?? 'standard',
  mcPrincipalSid: charge.mc ? charge.mc.principalSid : null,
  mcPosition: charge.mc ? charge.mc.position : null,
  mcPct: charge.mc ? charge.mc.pct : null,
  mcTarifaBase: charge.mc ? charge.mc.tarifaBase : null,
  mcPrincipalTemporal: charge.mc ? charge.mc.esPrincipalTemporal : false,
});

/** Lineas facturables del mes, ordenadas por sid (orden estable del CSV). */
export const computeMonthLines = (sellers: readonly BillingSeller[], ym: YearMonth, ctx: BillingContext): BillingLine[] =>
  sellers
    .map((s) => ({ s, charge: computeMonthCharge(s, ym, ctx) }))
    .filter((x) => x.charge.active)
    .map((x) => toBillingLine(x.s, ym, x.charge))
    .sort((a, b) => a.sid.localeCompare(b.sid));

export type BillingTotals = { lines: number; neto: number; descuento: number; bruto: number; netoPorTipo: Record<string, number> };

export const summarizeBillingLines = (lines: readonly BillingLine[]): BillingTotals => {
  const netoPorTipo: Record<string, number> = {};
  let neto = 0;
  let descuento = 0;
  let bruto = 0;
  lines.forEach((l) => {
    neto += l.montoNetoFinal;
    descuento += l.descuento;
    bruto += l.montoBruto;
    netoPorTipo[l.tipo] = (netoPorTipo[l.tipo] || 0) + l.montoNetoFinal;
  });
  return { lines: lines.length, neto, descuento, bruto, netoPorTipo };
};

export const BILLING_CSV_HEADER = ['Seller ID', 'Tipo', 'Monto Neto', 'Descuento', 'Monto Neto Final', 'Monto Bruto'] as const;

export const buildBillingCsv = (lines: readonly BillingLine[]): string =>
  [
    BILLING_CSV_HEADER.join(','),
    ...lines.map((l) => [l.sid, l.tipo, l.tarifaLista, l.descuento, l.montoNetoFinal, l.montoBruto].join(',')),
  ].join('\n');

/* ── Persistencia: filas de billing_period_lines / billing_periods ───────── */
const CHARGE_KINDS: readonly ChargeKind[] = ['standard', 'promo', 'custom', 'multicuenta'];

export const billingLineToRow = (l: BillingLine) => ({
  period: l.period,
  sid: l.sid,
  seller_name: l.sellerName,
  seccion: l.seccion,
  kam: l.kam,
  tipo: l.tipo,
  status_at_close: l.statusAtClose,
  tarifa_lista: l.tarifaLista,
  descuento: l.descuento,
  monto_neto_final: l.montoNetoFinal,
  monto_bruto: l.montoBruto,
  charge_kind: l.chargeKind,
  mc_principal_sid: l.mcPrincipalSid,
  mc_position: l.mcPosition,
  mc_pct: l.mcPct,
  mc_tarifa_base: l.mcTarifaBase,
  mc_principal_temporal: l.mcPrincipalTemporal,
});

export const billingLineFromRow = (raw: unknown): BillingLine | null => {
  const r = asRecord(raw);
  const ym = parseYearMonth(String(r.period ?? ''));
  if (!ym || !r.sid) return null;
  const kind = String(r.charge_kind ?? '') as ChargeKind;
  return {
    period: serializeYearMonth(ym),
    sid: String(r.sid),
    sellerName: String(r.seller_name ?? ''),
    seccion: String(r.seccion ?? ''),
    kam: String(r.kam ?? ''),
    tipo: String(r.tipo ?? ''),
    statusAtClose: String(r.status_at_close ?? ''),
    tarifaLista: Number(r.tarifa_lista ?? 0),
    descuento: Number(r.descuento ?? 0),
    montoNetoFinal: Number(r.monto_neto_final ?? 0),
    montoBruto: Number(r.monto_bruto ?? 0),
    chargeKind: CHARGE_KINDS.includes(kind) ? kind : 'standard',
    mcPrincipalSid: r.mc_principal_sid ? String(r.mc_principal_sid) : null,
    mcPosition: nullableNumber(r.mc_position),
    mcPct: nullableNumber(r.mc_pct),
    mcTarifaBase: nullableNumber(r.mc_tarifa_base),
    mcPrincipalTemporal: !!r.mc_principal_temporal,
  };
};

export type ClosedPeriodInfo = {
  period: YearMonthKey;
  closedAt: string;
  closedBy: string;
  source: string;
  engineVersion: string;
};

export const closedPeriodInfoFromRow = (raw: unknown): ClosedPeriodInfo | null => {
  const r = asRecord(raw);
  const ym = parseYearMonth(String(r.period ?? ''));
  if (!ym) return null;
  return {
    period: serializeYearMonth(ym),
    closedAt: String(r.closed_at ?? ''),
    closedBy: String(r.closed_by ?? ''),
    source: String(r.source ?? ''),
    engineVersion: String(r.engine_version ?? ''),
  };
};

/* ── Contrato del endpoint send-monthly-billing-report ───────────────────── */
export type BillingReportMode = 'manual' | 'cron';

export type BillingReportRequest = {
  year: number;
  month: number;
  close: boolean;
  forceMode: BillingReportMode;
};

export const buildBillingReportRequest = (
  period: YearMonth,
  options: { close?: boolean; forceMode?: BillingReportMode } = {}
): BillingReportRequest => ({
  year: period.year,
  month: period.month,
  close: options.close === true,
  forceMode: options.forceMode ?? 'manual',
});

export type ParsedBillingReportRequest =
  | { ok: true; period: YearMonth; close: boolean; forceMode: string; explicitPeriod: boolean }
  | { ok: false; error: string };

/** year/month ausentes → mes de `today` (compatibilidad con el cron). */
export const parseBillingReportRequest = (body: unknown, today: YearMonth): ParsedBillingReportRequest => {
  const b = asRecord(body);
  const year = b.year == null ? today.year : Number(b.year);
  const month = b.month == null ? today.month : Number(b.month);
  if (!isValidYearMonth(year, month)) return { ok: false, error: 'Periodo invalido: ' + String(b.year) + '-' + String(b.month) };
  return {
    ok: true,
    period: makeYearMonth(year, month),
    close: b.close === true,
    forceMode: typeof b.forceMode === 'string' && b.forceMode ? b.forceMode : 'cron',
    explicitPeriod: b.year != null && b.month != null,
  };
};

/** Solo el mes en curso y el anterior: cerrar un mes mas antiguo con el
 *  estado actual seria inventar historia. */
export const canClosePeriod = (period: YearMonth, today: YearMonth): boolean => {
  const d = monthsBetween(period, today);
  return d >= 0 && d <= CLOSABLE_MONTHS_BACK;
};
