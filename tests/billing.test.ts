import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_CSV_HEADER,
  DEFAULT_PRICING,
  PROMO_DISCOUNT_RATE,
  billingLineFromRow,
  billingLineToRow,
  buildBillingCsv,
  buildBillingReportRequest,
  canClosePeriod,
  computeMonthCharge,
  computeMonthLines,
  grossAmount,
  parseBillingReportRequest,
  type BillingSeller,
} from '../supabase/functions/_shared/billing.ts';
import { getCalendarYearMonths, getMonthRange } from '../src/lib/period.ts';
import { TARIFA, ctxOf, seller, ym } from './helpers.ts';

const PROMO = Math.round(TARIFA * PROMO_DISCOUNT_RATE);
const charge = (s: BillingSeller, key: string, all: readonly BillingSeller[] = [s]) => computeMonthCharge(s, ym(key), ctxOf(all));
const amounts = (s: BillingSeller, from: string, to: string) =>
  getMonthRange(ym(from), ym(to)).map((m) => {
    const c = computeMonthCharge(s, m, ctxOf([s]));
    return c.active ? c.amount : null;
  });

describe('Ventana de facturacion (corte dia 25)', () => {
  it('5. contrato 2026-09, 3 meses de descuento → el descuento no se reinicia en enero 2027', () => {
    const s = seller({ sid: 'S5', fContrato: '2026-09-10', dcto: 3 });
    assert.deepEqual(amounts(s, '2026-08', '2027-02'), [null, PROMO, PROMO, PROMO, TARIFA, TARIFA, TARIFA]);
    assert.equal(charge(s, '2026-10').kind, 'promo');
    assert.equal(charge(s, '2027-01').kind, 'standard');
  });

  it('6. custom_dctos 2026-11=X y 2027-01=Y → cada valor solo afecta su periodo', () => {
    const s = seller({ sid: 'S6', fContrato: '2026-06-01', customDctos: { '2026-11': 500000, '2027-01': 700000 } });
    assert.deepEqual(amounts(s, '2026-10', '2027-02'), [TARIFA, 500000, TARIFA, 700000, TARIFA]);
    assert.equal(charge(s, '2026-11').isCustom, true);
    assert.equal(charge(s, '2026-12').isCustom, false);
  });

  it('custom 0 es un cobro valido de $0 (no se ignora)', () => {
    const s = seller({ sid: 'S6b', fContrato: '2026-06-01', customDctos: { '2026-09': 0 } });
    const c = charge(s, '2026-09');
    assert.equal(c.active, true);
    assert.equal(c.amount, 0);
  });

  it('7. seller que termina en 2026 no genera cobros en 2027', () => {
    const s = seller({ sid: 'S7', status: 'Fuga', fContrato: '2026-03-01', fTermino: '2026-10-10' });
    assert.equal(charge(s, '2026-09').active, true); // f_termino ≥ 25-sep
    assert.equal(charge(s, '2026-10').inactiveReason, 'terminado'); // 10-oct < 25-oct
    assert.ok(getCalendarYearMonths(2027).every((m) => !computeMonthCharge(s, m, ctxOf([s])).active));
  });

  it('término el mismo dia del corte factura ese mes', () => {
    const s = seller({ sid: 'S7b', status: 'Fuga', fContrato: '2026-03-01', fTermino: '2026-10-25' });
    assert.equal(charge(s, '2026-10').active, true);
    assert.equal(charge(s, '2026-11').active, false);
  });

  it('8. seller que comienza en octubre 2027 no genera cobros anteriores', () => {
    const s = seller({ sid: 'S8', fContrato: '2027-10-05', dcto: 2 });
    const before = getMonthRange(ym('2026-01'), ym('2027-09'));
    assert.ok(before.every((m) => computeMonthCharge(s, m, ctxOf([s])).inactiveReason === 'antes_de_inicio'));
    assert.equal(charge(s, '2027-10').amount, PROMO);
  });

  it('contrato desde el dia 25 empieza a facturar el mes siguiente', () => {
    assert.equal(charge(seller({ sid: 'A', fContrato: '2026-09-24' }), '2026-09').active, true);
    assert.equal(charge(seller({ sid: 'B', fContrato: '2026-09-25' }), '2026-09').active, false);
    assert.equal(charge(seller({ sid: 'B', fContrato: '2026-09-25' }), '2026-10').active, true);
  });

  it('contratos del dia 1 no se adelantan un mes (bug de zona horaria)', () => {
    assert.equal(charge(seller({ sid: 'A', fContrato: '2026-09-01' }), '2026-08').active, false);
    assert.equal(charge(seller({ sid: 'B', fContrato: '2027-01-01' }), '2026-12').active, false);
    assert.equal(charge(seller({ sid: 'B', fContrato: '2027-01-01' }), '2027-01').active, true);
  });

  it('datos incompletos no facturan: Fuga sin f_termino y seller sin f_contrato', () => {
    assert.equal(charge(seller({ sid: 'F', status: 'Fuga', fTermino: '' }), '2026-09').inactiveReason, 'fuga_sin_termino');
    assert.equal(charge(seller({ sid: 'N', fContrato: '' }), '2026-09').inactiveReason, 'sin_f_contrato');
  });

  it('individual en Pausa sigue facturando (regla vigente)', () => {
    assert.equal(charge(seller({ sid: 'P', status: 'Pausa' }), '2026-09').amount, TARIFA);
  });
});

describe('Multicuenta', () => {
  const holding = (principalStatus = 'Iniciado') => [
    seller({ sid: 'A', esMulticuenta: true, status: principalStatus, fContrato: '2026-01-05', dcto: 2 }),
    seller({ sid: 'B', esMulticuenta: true, principalSid: 'A', fContrato: '2026-02-05' }),
    seller({ sid: 'C', esMulticuenta: true, principalSid: 'A', fContrato: '2026-03-05' }),
  ];

  it('escalera 100% / 0% / 25% de la tarifa base, sin descuento promocional', () => {
    const all = holding();
    const [a, b, c] = all;
    assert.equal(charge(a, '2026-04', all).amount, 990000);
    assert.equal(charge(b, '2026-04', all).amount, 0);
    assert.equal(charge(c, '2026-04', all).amount, 247500);
    assert.equal(charge(a, '2026-01', all).kind, 'multicuenta'); // mes con dcto: no aplica promo
    assert.equal(charge(c, '2026-04', all).mc?.position, 3);
  });

  it('principal en Pausa: no factura y la activa mas antigua asume el 100%', () => {
    const all = holding('Pausa');
    const [a, b, c] = all;
    assert.equal(charge(a, '2026-04', all).inactiveReason, 'fuera_de_escalera');
    assert.equal(charge(b, '2026-04', all).amount, 990000);
    assert.equal(charge(b, '2026-04', all).mc?.esPrincipalTemporal, true);
    assert.equal(charge(c, '2026-04', all).amount, 0);
  });

  it('condiciones congeladas del holding mandan sobre las generales', () => {
    const frozen = { ...DEFAULT_PRICING, tarifaBase: 800000, pctPos: [100, 10, 20, 30, 40] as [number, number, number, number, number] };
    const all = holding().map((s) => (s.sid === 'A' ? { ...s, pricingOverride: frozen } : s));
    assert.equal(charge(all[1], '2026-04', all).amount, 80000);
  });

  it('custom_dctos se respeta tambien en multicuenta', () => {
    const all = holding().map((s) => (s.sid === 'C' ? { ...s, customDctos: { '2026-04': 1000 } } : s));
    assert.equal(charge(all[2], '2026-04', all).amount, 1000);
    assert.equal(charge(all[2], '2026-04', all).isCustom, true);
  });
});

describe('Lineas y CSV del reporte de Cobros', () => {
  it('mismas columnas del CSV y bruto con IVA', () => {
    const s = [seller({ sid: 'Z' }), seller({ sid: 'A', dcto: 12 })];
    const lines = computeMonthLines(s, ym('2026-09'), ctxOf(s));
    assert.deepEqual(lines.map((l) => l.sid), ['A', 'Z']);
    assert.equal(lines[0].descuento, TARIFA - PROMO);
    assert.equal(lines[0].montoBruto, grossAmount(PROMO));
    const csv = buildBillingCsv(lines).split('\n');
    assert.equal(csv[0], BILLING_CSV_HEADER.join(','));
    assert.equal(csv[0], 'Seller ID,Tipo,Monto Neto,Descuento,Monto Neto Final,Monto Bruto');
    assert.equal(csv[1], ['A', 'Full', TARIFA, TARIFA - PROMO, PROMO, grossAmount(PROMO)].join(','));
  });

  it('una linea sobrevive ida y vuelta a la fila persistida', () => {
    const s = [seller({ sid: 'X', esMulticuenta: true })];
    const [line] = computeMonthLines(s, ym('2026-09'), ctxOf(s));
    assert.deepEqual(billingLineFromRow(billingLineToRow(line)), line);
  });
});

describe('Contrato del endpoint de billing', () => {
  it('periodo explicito 2026-11 → year 2026, month 11 (sin depender del mes actual)', () => {
    assert.deepEqual(buildBillingReportRequest(ym('2026-11')), { year: 2026, month: 11, close: false, forceMode: 'manual' });
    const parsed = parseBillingReportRequest({ year: 2026, month: 11 }, ym('2027-03'));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.period, { year: 2026, month: 11 });
    assert.equal(parsed.explicitPeriod, true);
  });

  it('sin periodo usa el mes de hoy (compatibilidad con el cron) y valida el mes', () => {
    const parsed = parseBillingReportRequest({}, ym('2027-03'));
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.period, { year: 2027, month: 3 });
    assert.equal(parsed.close, false);
    assert.equal(parseBillingReportRequest({ year: 2026, month: 13 }, ym('2027-03')).ok, false);
  });

  it('solo se puede cerrar el mes en curso o el anterior', () => {
    const today = ym('2027-03');
    assert.equal(canClosePeriod(ym('2027-03'), today), true);
    assert.equal(canClosePeriod(ym('2027-02'), today), true);
    assert.equal(canClosePeriod(ym('2027-01'), today), false);
    assert.equal(canClosePeriod(ym('2027-04'), today), false);
    assert.equal(canClosePeriod(ym('2026-12'), ym('2027-01')), true);
  });
});
