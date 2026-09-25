/* ════════════════════════════════════════════════════════════════════════════
   LEDGER — una sola fuente para KPIs, graficos, tablas y CSV del dashboard.
   Para cada mes de la ventana decide de donde sale el dato:
     · mes con cierre persistido → snapshot (inmutable, nunca se recalcula)
     · mes sin cierre            → motor de cobro con las condiciones actuales
   y lo etiqueta: Real (cerrado) · Actual · Estimado (pasado sin cierre) · Proyeccion.
   Puro: sin React ni Supabase, `today` inyectado.
   ════════════════════════════════════════════════════════════════════════════ */
import {
  SELLER_STATUS,
  computeMonthCharge,
  type BillingContext,
  type BillingLine,
  type BillingSeller,
  type ClosedPeriodInfo,
  type MonthCharge,
} from '../../supabase/functions/_shared/billing.ts';
import { getPeriodPhase, isSameYearMonth, serializeYearMonth, type YearMonth, type YearMonthKey } from './period.ts';

export type MonthStatus = 'closed' | 'current' | 'estimated' | 'forecast';
export const MONTH_STATUSES: readonly MonthStatus[] = ['closed', 'current', 'estimated', 'forecast'];
export const MONTH_STATUS_LABEL: Record<MonthStatus, string> = {
  closed: 'Real',
  current: 'Actual',
  estimated: 'Estimado',
  forecast: 'Proyección',
};

export type ClosedPeriod = { readonly info: ClosedPeriodInfo; readonly lines: readonly BillingLine[] };

export type LedgerCell = {
  amount: number;
  listAmount: number;
  isCustom: boolean;
  isPromo: boolean;
  isDiscount: boolean;
};

export type LedgerEntry = {
  sid: string;
  sellerName: string;
  tipo: string;
  seccion: string;
  kam: string;
  status: string;
  cell: LedgerCell;
};

export type LedgerMonth = {
  ym: YearMonth;
  key: YearMonthKey;
  status: MonthStatus;
  closed: ClosedPeriodInfo | null;
  entries: readonly LedgerEntry[];
  total: number;
};

export type Ledger = { months: readonly LedgerMonth[] };

export type LedgerInput = {
  months: readonly YearMonth[];
  today: YearMonth;
  sellers: readonly BillingSeller[];
  ctx: BillingContext;
  closed: ReadonlyMap<string, ClosedPeriod>;
};

export const getMonthStatus = (ym: YearMonth, today: YearMonth, isClosed: boolean): MonthStatus => {
  if (isClosed) return 'closed';
  const phase = getPeriodPhase(ym, today);
  return phase === 'past' ? 'estimated' : phase === 'current' ? 'current' : 'forecast';
};

const cellFromCharge = (c: MonthCharge): LedgerCell => ({
  amount: c.amount,
  listAmount: c.listAmount,
  isCustom: c.isCustom,
  isPromo: c.isPromo,
  isDiscount: c.isDiscount,
});

const cellFromLine = (l: BillingLine): LedgerCell => ({
  amount: l.montoNetoFinal,
  listAmount: l.tarifaLista,
  isCustom: l.chargeKind === 'custom',
  isPromo: l.chargeKind === 'promo',
  isDiscount: l.montoNetoFinal < l.tarifaLista,
});

const sumEntries = (entries: readonly LedgerEntry[]) => entries.reduce((acc, e) => acc + e.cell.amount, 0);

const buildLedgerMonth = (ym: YearMonth, input: LedgerInput): LedgerMonth => {
  const key = serializeYearMonth(ym);
  const snapshot = input.closed.get(key);
  const entries: LedgerEntry[] = snapshot
    ? snapshot.lines.map((l) => ({
        sid: l.sid,
        sellerName: l.sellerName,
        tipo: l.tipo,
        seccion: l.seccion,
        kam: l.kam,
        status: l.statusAtClose,
        cell: cellFromLine(l),
      }))
    : input.sellers.flatMap((s) => {
        const charge = computeMonthCharge(s, ym, input.ctx);
        return charge.active
          ? [{ sid: s.sid, sellerName: s.seller, tipo: s.tipo, seccion: s.sec, kam: s.kam, status: s.status, cell: cellFromCharge(charge) }]
          : [];
      });
  return {
    ym,
    key,
    status: getMonthStatus(ym, input.today, !!snapshot),
    closed: snapshot ? snapshot.info : null,
    entries,
    total: sumEntries(entries),
  };
};

export const buildLedger = (input: LedgerInput): Ledger => ({
  months: input.months.map((ym) => buildLedgerMonth(ym, input)),
});

/* ── Sumas por estado ────────────────────────────────────────────────────── */
export type StatusBreakdown = Record<MonthStatus, number>;
export type PeriodSum = { total: number; byStatus: StatusBreakdown; months: number };

const emptyBreakdown = (): StatusBreakdown => ({ closed: 0, current: 0, estimated: 0, forecast: 0 });

export const sumLedgerMonths = (months: readonly LedgerMonth[]): PeriodSum => {
  const byStatus = emptyBreakdown();
  months.forEach((m) => (byStatus[m.status] += m.total));
  return { total: months.reduce((acc, m) => acc + m.total, 0), byStatus, months: months.length };
};

export const countMonthsByStatus = (months: readonly LedgerMonth[]): StatusBreakdown => {
  const counts = emptyBreakdown();
  months.forEach((m) => counts[m.status]++);
  return counts;
};

export type LedgerSummary = { window: PeriodSum; ytd: PeriodSum | null };

/** `ytdMonths` null = la vista no tiene YTD (rolling). */
export const summarizeLedger = (ledger: Ledger, ytdMonths: readonly YearMonth[] | null): LedgerSummary => {
  const ytdKeys = ytdMonths ? new Set<string>(ytdMonths.map(serializeYearMonth)) : null;
  return {
    window: sumLedgerMonths(ledger.months),
    ytd: ytdKeys ? sumLedgerMonths(ledger.months.filter((m) => ytdKeys.has(m.key))) : null,
  };
};

/* ── Totales mensuales por plan / gerencia ───────────────────────────────── */
export type GroupField = 'tipo' | 'seccion';
export type MonthGroupTotals = {
  ym: YearMonth;
  key: YearMonthKey;
  status: MonthStatus;
  values: Record<string, number>;
  /** suma de los grupos pedidos */
  total: number;
};

const totalsByGroup = (entries: readonly LedgerEntry[], field: GroupField, groups: readonly string[]) => {
  const acc = new Map<string, number>(groups.map((g) => [g, 0]));
  entries.forEach((e) => {
    const g = e[field];
    const cur = acc.get(g);
    if (cur != null) acc.set(g, cur + e.cell.amount);
  });
  return acc;
};

export const monthlyTotalsBy = (ledger: Ledger, field: GroupField, groups: readonly string[]): MonthGroupTotals[] =>
  ledger.months.map((m) => {
    const acc = totalsByGroup(m.entries, field, groups);
    const values: Record<string, number> = {};
    acc.forEach((v, g) => (values[g] = v));
    return { ym: m.ym, key: m.key, status: m.status, values, total: groups.reduce((s, g) => s + (values[g] || 0), 0) };
  });

/** Mes de referencia para las vistas de un solo mes: hoy si esta en la
 *  ventana; si no, el ultimo mes de la ventana. */
export const getFocusMonth = (ledger: Ledger, today: YearMonth): LedgerMonth | null =>
  ledger.months.find((m) => isSameYearMonth(m.ym, today)) ?? ledger.months[ledger.months.length - 1] ?? null;

export const revenueBy = (month: LedgerMonth | null, field: GroupField, groups: readonly string[]) => {
  if (!month) return [];
  const acc = totalsByGroup(month.entries, field, groups);
  return groups.map((g) => ({ name: g, value: acc.get(g) || 0 })).filter((x) => x.value > 0);
};

/* ── Tablas de detalle (fila = seller dentro de su plan/gerencia) ────────────
   Un mes cerrado se atribuye al plan y gerencia que el seller tenia al cierre:
   si despues cambio de plan, aparece en ambos grupos con sus meses. Los sellers
   que ya no existen pero estan en un cierre aparecen igual (seller = null). */
export type DetailRow<S> = {
  id: string;
  sid: string;
  sellerName: string;
  seller: S | null;
  status: string;
  kam: string;
  seccion: string;
  cells: (LedgerCell | null)[];
  total: number;
};

export type DetailGroup<S> = {
  key: string;
  rows: DetailRow<S>[];
  monthTotals: number[];
  total: number;
  /** filas de sellers vigentes que no estan en Fuga */
  activeCount: number;
};

export type DetailInput<S> = {
  ledger: Ledger;
  sellers: readonly S[];
  plan: string;
  /** true: un grupo por gerencia; false: un unico grupo con el nombre del plan */
  groupBySeccion: boolean;
  groupOrder: readonly string[];
  /** incluir sellers vigentes del plan aunque no cobren en la ventana */
  includeCurrentSellers: boolean;
};

export const buildDetailGroups = <S extends BillingSeller>(input: DetailInput<S>): DetailGroup<S>[] => {
  const { ledger, sellers, plan, groupBySeccion, groupOrder, includeCurrentSellers } = input;
  const n = ledger.months.length;
  const bySid = new Map(sellers.map((s) => [s.sid, s]));
  const rowsByGroup = new Map<string, Map<string, DetailRow<S>>>();

  const ensureRow = (seccion: string, sid: string, fallback: { sellerName: string; status: string; kam: string }) => {
    const groupKey = groupBySeccion ? seccion : plan;
    let group = rowsByGroup.get(groupKey);
    if (!group) {
      group = new Map();
      rowsByGroup.set(groupKey, group);
    }
    let row = group.get(sid);
    if (!row) {
      const s = bySid.get(sid) ?? null;
      row = {
        id: groupKey + '|' + sid,
        sid,
        sellerName: s ? s.seller : fallback.sellerName,
        seller: s,
        status: s ? s.status : fallback.status,
        kam: s ? s.kam : fallback.kam,
        seccion: groupBySeccion ? seccion : s ? s.sec : seccion,
        cells: new Array<LedgerCell | null>(n).fill(null),
        total: 0,
      };
      group.set(sid, row);
    }
    return row;
  };

  ledger.months.forEach((m, i) =>
    m.entries.forEach((e) => {
      if (e.tipo !== plan) return;
      const row = ensureRow(e.seccion, e.sid, e);
      row.cells[i] = e.cell;
      row.total += e.cell.amount;
    })
  );
  if (includeCurrentSellers)
    sellers.forEach((s) => {
      if (s.tipo === plan && s.status !== SELLER_STATUS.churned)
        ensureRow(s.sec, s.sid, { sellerName: s.seller, status: s.status, kam: s.kam });
    });

  const extraKeys = Array.from(rowsByGroup.keys())
    .filter((k) => !groupOrder.includes(k))
    .sort((a, b) => a.localeCompare(b));
  return [...groupOrder.filter((k) => rowsByGroup.has(k)), ...extraKeys].map((key) => {
    const rows = Array.from(rowsByGroup.get(key)!.values()).sort((a, b) => a.sellerName.localeCompare(b.sellerName));
    const monthTotals = Array.from({ length: n }, (_, i) => rows.reduce((acc, r) => acc + (r.cells[i]?.amount ?? 0), 0));
    return {
      key,
      rows,
      monthTotals,
      total: monthTotals.reduce((a, b) => a + b, 0),
      activeCount: rows.filter((r) => r.seller && r.seller.status !== SELLER_STATUS.churned).length,
    };
  });
};

/* ── CSV ─────────────────────────────────────────────────────────────────── */
export type CsvTable = { headers: string[]; rows: string[][] };

export const summaryCsvTable = (
  monthRows: readonly MonthGroupTotals[],
  groups: readonly string[],
  labels: readonly string[]
): CsvTable => {
  const rows = groups.map((g) => {
    const vals = monthRows.map((m) => m.values[g] || 0);
    return [g, ...vals.map(String), String(vals.reduce((a, b) => a + b, 0))];
  });
  rows.push(['TOTAL', ...monthRows.map((m) => String(m.total)), String(monthRows.reduce((a, m) => a + m.total, 0))]);
  rows.push(['ESTADO', ...monthRows.map((m) => MONTH_STATUS_LABEL[m.status]), '']);
  return { headers: ['Plan', ...labels, 'Total'], rows };
};

export type DetailCsvSeller = BillingSeller & { min: number };

const DETAIL_CSV_FIXED = ['Seller', 'SID', 'KAM', 'Seccion', 'Status', 'Tarifa', 'Dcto', 'Min', 'F.Contrato'];

export const detailCsvTable = <S extends DetailCsvSeller>(
  groups: readonly DetailGroup<S>[],
  labels: readonly string[],
  statuses: readonly MonthStatus[]
): CsvTable => {
  const rows = groups.flatMap((g) =>
    g.rows.map((r) => {
      const s = r.seller;
      return [
        r.sellerName,
        r.sid,
        r.kam,
        r.seccion,
        r.status,
        s ? String(s.tarifa) : '',
        s ? String(s.dcto) : '',
        s ? String(s.min) : '',
        s ? s.fContrato : '',
        ...r.cells.map((c) => String(c ? c.amount : 0)),
        String(r.total),
      ];
    })
  );
  rows.push(['ESTADO', ...DETAIL_CSV_FIXED.slice(1).map(() => ''), ...statuses.map((st) => MONTH_STATUS_LABEL[st]), '']);
  return { headers: [...DETAIL_CSV_FIXED, ...labels, 'Total'], rows };
};
