import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_CSV_HEADER,
  BILLING_ENGINE_VERSION,
  DEFAULT_PRICING,
  PROMO_DISCOUNT_RATE,
  billingLineFromRow,
  billingLineToRow,
  buildBillingCsv,
  buildBillingReportRequest,
  canClosePeriod,
  computeMonthCharge,
  computeMonthLines,
  engineVersionMismatch,
  grossAmount,
  mapPricingOverride,
  parseBillingReportRequest,
  staleServerMessage,
  summarizeBillingLines,
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

/* Incidente oct-2026: la Edge Function desplegada (v11, mayo) cobraba a cada
   cuenta su propia `tarifa`. Estos casos reproducen los holdings afectados con
   sus datos reales de cobro (sin datos personales). */
describe('Reporte de Cobros con holdings pactados (caso BAMERS / CONVERSE)', () => {
  const pactadas = mapPricingOverride({ tarifaBase: 990000, pctPos: [100, 0, 0, 0, 0], pctPos6Plus: 0, cupoDivisor: 2, congeladoEl: '2026-09-22' });
  const holdings = [
    seller({ sid: 'SC794DC', seller: 'BAMERS', esMulticuenta: true, fContrato: '2026-08-01', pricingOverride: pactadas }),
    seller({ sid: 'SC23BCD', seller: 'BELSPORT', esMulticuenta: true, principalSid: 'SC794DC', fContrato: '2026-08-01' }),
    seller({ sid: 'SC5CAA2', seller: 'OAKLEY', esMulticuenta: true, principalSid: 'SC794DC', fContrato: '2026-08-01' }),
    seller({ sid: 'SC8ECF8', seller: 'CONVERSE', esMulticuenta: true, fContrato: '2026-08-24', pricingOverride: pactadas }),
    seller({ sid: 'SC4AA12', seller: 'UMBRO', esMulticuenta: true, principalSid: 'SC8ECF8', fContrato: '2026-08-24' }),
    seller({ sid: 'SC75DEC', seller: 'BLOCKSTORE.', esMulticuenta: true, principalSid: 'SC8ECF8', fContrato: '2026-08-24' }),
    seller({ sid: 'SCFD3E9', seller: 'FILA', esMulticuenta: true, principalSid: 'SC8ECF8', fContrato: '2026-08-24' }),
  ];
  const secundarias = ['SC23BCD', 'SC5CAA2', 'SC4AA12', 'SC75DEC', 'SCFD3E9'];

  for (const key of ['2026-08', '2026-09', '2026-10']) {
    it(key + ': solo las principales cobran; las secundarias van a $0 con el descuento visible', () => {
      const lines = computeMonthLines(holdings, ym(key), ctxOf(holdings));
      const bySid = new Map(lines.map((l) => [l.sid, l]));
      assert.equal(bySid.get('SC794DC')?.montoNetoFinal, TARIFA);
      assert.equal(bySid.get('SC8ECF8')?.montoNetoFinal, TARIFA);
      secundarias.forEach((sid) => {
        assert.equal(bySid.get(sid)?.montoNetoFinal, 0, sid);
        assert.equal(bySid.get(sid)?.montoBruto, 0, sid);
      });
      const csv = buildBillingCsv(lines).split('\n');
      assert.ok(csv.includes('SC23BCD,Full,990000,990000,0,0'));
      assert.ok(csv.includes('SC794DC,Full,990000,0,990000,1178100'));
      const totals = summarizeBillingLines(lines);
      assert.equal(totals.neto, 2 * TARIFA);
      assert.equal(totals.bruto, 2 * grossAmount(TARIFA));
      assert.equal(totals.descuento, secundarias.length * TARIFA);
    });
  }

  it('holding con reglas generales y 2 cuentas: la 2ª cuenta no cobra', () => {
    const all = [
      seller({ sid: 'P', esMulticuenta: true, fContrato: '2026-06-23' }),
      seller({ sid: 'S', esMulticuenta: true, principalSid: 'P', fContrato: '2026-06-23' }),
    ];
    const lines = computeMonthLines(all, ym('2026-09'), ctxOf(all));
    assert.deepEqual(
      lines.map((l) => [l.sid, l.montoNetoFinal]),
      [
        ['P', TARIFA],
        ['S', 0],
      ]
    );
  });

  it('3ª cuenta con reglas generales: lista completa y escalera como descuento en el CSV', () => {
    const all = [
      seller({ sid: 'P', esMulticuenta: true }),
      seller({ sid: 'S2', esMulticuenta: true, principalSid: 'P', fContrato: '2026-02-01' }),
      seller({ sid: 'S3', esMulticuenta: true, principalSid: 'P', fContrato: '2026-03-01' }),
    ];
    const lines = computeMonthLines(all, ym('2026-09'), ctxOf(all));
    const s3 = lines.find((l) => l.sid === 'S3')!;
    assert.equal(s3.tarifaLista, 247500); // semantica del motor (persistida): base × %
    assert.ok(buildBillingCsv(lines).split('\n').includes('S3,Full,990000,742500,247500,' + grossAmount(247500)));
  });
});

describe('Misma version de motor en app y Edge Function', () => {
  it('la app manda su version en el pedido', () => {
    assert.equal(buildBillingReportRequest(ym('2026-10')).engineVersion, BILLING_ENGINE_VERSION);
  });

  it('la funcion rechaza un pedido de otra version y acepta el cron sin version', () => {
    const otra = parseBillingReportRequest({ year: 2026, month: 10, engineVersion: '1.0.0' }, ym('2026-10'));
    assert.ok(otra.ok);
    assert.match(engineVersionMismatch(otra.clientEngineVersion) ?? '', /v1\.0\.0/);
    const misma = parseBillingReportRequest(buildBillingReportRequest(ym('2026-10')), ym('2026-10'));
    assert.ok(misma.ok);
    assert.equal(engineVersionMismatch(misma.clientEngineVersion), null);
    const cron = parseBillingReportRequest({ close: true, forceMode: 'cron' }, ym('2026-10'));
    assert.ok(cron.ok);
    assert.equal(cron.clientEngineVersion, null);
    assert.equal(engineVersionMismatch(cron.clientEngineVersion), null);
  });

  it('la app detecta una funcion antigua (sin engineVersion en la respuesta)', () => {
    assert.match(staleServerMessage(undefined) ?? '', /NO es valido/);
    assert.match(staleServerMessage('2.0.0') ?? '', /v2\.0\.0/);
    assert.equal(staleServerMessage(BILLING_ENGINE_VERSION), null);
  });
});

describe('Contrato del endpoint de billing', () => {
  it('periodo explicito 2026-11 → year 2026, month 11 (sin depender del mes actual)', () => {
    assert.deepEqual(buildBillingReportRequest(ym('2026-11')), {
      year: 2026,
      month: 11,
      close: false,
      forceMode: 'manual',
      engineVersion: BILLING_ENGINE_VERSION,
    });
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
