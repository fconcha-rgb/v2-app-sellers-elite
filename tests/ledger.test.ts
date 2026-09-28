import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonthLines, type ClosedPeriodInfo } from '../supabase/functions/_shared/billing.ts';
import {
  buildDetailGroups,
  buildLedger,
  detailCsvTable,
  monthlyTotalsBy,
  summarizeLedger,
  summaryCsvTable,
  type ClosedPeriod,
  type LedgerMonth,
} from '../src/lib/ledger.ts';
import { buildViewWindow, getCalendarYearMonths, serializeYearMonth, type YearMonth } from '../src/lib/period.ts';
import { TARIFA, ctxOf, seller, ym, type TestSeller } from './helpers.ts';

/** Cierra `month` con el estado de `sellers` en ese momento (lo que hace la Edge Function). */
const closeMonth = (sellers: readonly TestSeller[], month: YearMonth): [string, ClosedPeriod] => {
  const key = serializeYearMonth(month);
  const info: ClosedPeriodInfo = { period: key, closedAt: '2027-01-24T12:00:00Z', closedBy: 'admin@x.cl', source: 'manual', engineVersion: '2.0.0' };
  return [key, { info, lines: computeMonthLines(sellers, month, ctxOf(sellers)) }];
};

const ledgerOf = (sellers: readonly TestSeller[], months: readonly YearMonth[], today: YearMonth, closed: [string, ClosedPeriod][] = []) =>
  buildLedger({ months, today, sellers, ctx: ctxOf(sellers), closed: new Map(closed) });

const amountOf = (m: LedgerMonth, sid: string) => m.entries.find((e) => e.sid === sid)?.cell.amount ?? null;

describe('Estado de cada mes: Real / Actual / Estimado / Proyeccion', () => {
  it('lo decide la persistencia, no solo el calendario', () => {
    const s = [seller({ sid: 'A' })];
    const today = ym('2027-03');
    const ledger = ledgerOf(s, getCalendarYearMonths(2027), today, [closeMonth(s, ym('2027-01'))]);
    assert.deepEqual(
      ledger.months.slice(0, 5).map((m) => m.status),
      ['closed', 'estimated', 'current', 'forecast', 'forecast']
    );
    // Un año completo sin cierres (todo lo previo a la nueva arquitectura) es "estimado", nunca "real".
    assert.ok(ledgerOf(s, getCalendarYearMonths(2026), today).months.every((m) => m.status === 'estimated'));
  });

  it('YTD y Full Year quedan desglosados por estado', () => {
    const s = [seller({ sid: 'A' })];
    const today = ym('2027-03');
    const w = buildViewWindow({ mode: 'calendar', year: 2027 }, today);
    const summary = summarizeLedger(ledgerOf(s, w.months, today, [closeMonth(s, ym('2027-01'))]), w.ytdMonths);
    assert.equal(summary.ytd?.months, 3);
    assert.equal(summary.ytd?.total, 3 * TARIFA);
    assert.deepEqual(summary.ytd?.byStatus, { closed: TARIFA, estimated: TARIFA, current: TARIFA, forecast: 0 });
    assert.equal(summary.window.total, 12 * TARIFA);
    assert.equal(summary.window.byStatus.forecast, 9 * TARIFA);
  });
});

describe('Meses cerrados son inmutables', () => {
  it('10. multicuenta: la salida de A no reinterpreta enero (B sigue 2ª, C sigue 3ª)', () => {
    const enero = [
      seller({ sid: 'A', esMulticuenta: true, fContrato: '2026-01-05' }),
      seller({ sid: 'B', esMulticuenta: true, principalSid: 'A', fContrato: '2026-02-05' }),
      seller({ sid: 'C', esMulticuenta: true, principalSid: 'A', fContrato: '2026-03-05' }),
    ];
    const cierreEnero = closeMonth(enero, ym('2027-01'));
    // Despues A abandona el programa.
    const hoy = enero.map((s) => (s.sid === 'A' ? { ...s, status: 'Fuga', fTermino: '2027-02-10' } : s));
    const [jan, feb] = ledgerOf(hoy, [ym('2027-01'), ym('2027-02')], ym('2027-03'), [cierreEnero]).months;

    assert.equal(jan.status, 'closed');
    assert.deepEqual([amountOf(jan, 'A'), amountOf(jan, 'B'), amountOf(jan, 'C')], [990000, 0, 247500]);
    assert.equal(jan.total, 1237500);
    // Febrero (sin cierre) si refleja la nueva escalera: B asume el 100%, C pasa a 2ª.
    assert.deepEqual([amountOf(feb, 'A'), amountOf(feb, 'B'), amountOf(feb, 'C')], [null, 990000, 0]);
  });

  it('cambios posteriores de tarifa o custom_dctos no alteran un mes cerrado', () => {
    const antes = [seller({ sid: 'A' })];
    const cierre = closeMonth(antes, ym('2027-01'));
    const despues = [seller({ sid: 'A', tarifa: 1500000, customDctos: { '2027-01': 1 } })];
    const [jan, feb] = ledgerOf(despues, [ym('2027-01'), ym('2027-02')], ym('2027-02'), [cierre]).months;
    assert.equal(amountOf(jan, 'A'), TARIFA);
    assert.equal(amountOf(feb, 'A'), 1500000);
  });

  it('el mismo mes sin cierre si se recalcula (y por eso se rotula estimado)', () => {
    const despues = [seller({ sid: 'A', tarifa: 1500000 })];
    const [jan] = ledgerOf(despues, [ym('2027-01')], ym('2027-03')).months;
    assert.equal(jan.status, 'estimated');
    assert.equal(amountOf(jan, 'A'), 1500000);
  });
});

describe('Tablas de detalle', () => {
  it('un seller borrado despues del cierre sigue apareciendo en ese mes', () => {
    const cierre = closeMonth([seller({ sid: 'A' }), seller({ sid: 'GONE' })], ym('2027-01'));
    const sellers = [seller({ sid: 'A' })];
    const ledger = ledgerOf(sellers, [ym('2027-01'), ym('2027-02')], ym('2027-02'), [cierre]);
    const [group] = buildDetailGroups({ ledger, sellers, plan: 'Full', groupBySeccion: true, groupOrder: ['Moda'], includeCurrentSellers: true });
    const ghost = group.rows.find((r) => r.sid === 'GONE');
    assert.ok(ghost);
    assert.equal(ghost.seller, null);
    assert.equal(ghost.cells[0]?.amount, TARIFA);
    assert.equal(ghost.cells[1], null);
    // Totales de grupo = suma de sus filas.
    assert.deepEqual(group.monthTotals, [2 * TARIFA, TARIFA]);
  });

  it('un cambio de plan posterior no mueve los meses cerrados de grupo', () => {
    const cierre = closeMonth([seller({ sid: 'X', tipo: 'Premium', tarifa: 300000 })], ym('2027-01'));
    const sellers = [seller({ sid: 'X', tipo: 'Full' })];
    const ledger = ledgerOf(sellers, [ym('2027-01'), ym('2027-02')], ym('2027-02'), [cierre]);
    const prem = buildDetailGroups({ ledger, sellers, plan: 'Premium', groupBySeccion: false, groupOrder: [], includeCurrentSellers: true });
    const full = buildDetailGroups({ ledger, sellers, plan: 'Full', groupBySeccion: false, groupOrder: [], includeCurrentSellers: true });
    assert.deepEqual(prem[0].monthTotals, [300000, 0]);
    assert.deepEqual(full[0].monthTotals, [0, TARIFA]);
    const byPlan = monthlyTotalsBy(ledger, 'tipo', ['Full', 'Premium', 'Basico']);
    assert.deepEqual(byPlan.map((m) => m.values), [
      { Full: 0, Premium: 300000, Basico: 0 },
      { Full: TARIFA, Premium: 0, Basico: 0 },
    ]);
  });

  it('en un año pasado no se listan sellers que no cobraron en esa ventana', () => {
    const sellers = [seller({ sid: 'OLD', fContrato: '2026-01-05' }), seller({ sid: 'NEW', fContrato: '2027-05-05' })];
    const ledger = ledgerOf(sellers, getCalendarYearMonths(2026), ym('2027-06'));
    const groups = buildDetailGroups({ ledger, sellers, plan: 'Full', groupBySeccion: true, groupOrder: ['Moda'], includeCurrentSellers: false });
    assert.deepEqual(groups[0].rows.map((r) => r.sid), ['OLD']);
  });
});

describe('CSV por periodo', () => {
  it('resumen y detalle incluyen una fila de estado por mes', () => {
    const s = [seller({ sid: 'A' })];
    const ledger = ledgerOf(s, [ym('2027-01'), ym('2027-02')], ym('2027-02'), [closeMonth(s, ym('2027-01'))]);
    const summary = summaryCsvTable(monthlyTotalsBy(ledger, 'tipo', ['Full']), ['Full'], ['Ene', 'Feb']);
    assert.deepEqual(summary.headers, ['Plan', 'Ene', 'Feb', 'Total']);
    assert.deepEqual(summary.rows.at(-1), ['ESTADO', 'Real', 'Actual', '']);
    assert.deepEqual(summary.rows[0], ['Full', String(TARIFA), String(TARIFA), String(2 * TARIFA)]);
    const groups = buildDetailGroups({ ledger, sellers: s, plan: 'Full', groupBySeccion: true, groupOrder: ['Moda'], includeCurrentSellers: true });
    const detail = detailCsvTable(groups, ['Ene', 'Feb'], ledger.months.map((m) => m.status));
    assert.equal(detail.headers.length, detail.rows[0].length);
    assert.equal(detail.rows.at(-1)?.length, detail.headers.length);
  });
});
