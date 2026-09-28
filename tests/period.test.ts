import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  businessToday,
  buildViewWindow,
  canShiftSelection,
  clampSelection,
  collectSellerDataMonths,
  getAvailableYears,
  getPeriodPhase,
  getProjectionPeriods,
  getRollingMonths,
  getYTDPeriods,
  parseYearMonth,
  periodFileName,
  serializeYearMonth,
  shiftSelection,
  switchSelectionMode,
  windowMonthLabels,
  yearMonthOfISODate,
  type PeriodSelection,
} from '../src/lib/period.ts';
import { keys, ym } from './helpers.ts';

const calendar = (year: number): PeriodSelection => ({ mode: 'calendar', year });
const rolling12 = (end: string): PeriodSelection => ({ mode: 'rolling', end: ym(end), length: 12 });
const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));

describe('YearMonth: una sola forma de parsear y serializar', () => {
  it('serializa y parsea YYYY-MM de ida y vuelta', () => {
    assert.equal(serializeYearMonth({ year: 2026, month: 9 }), '2026-09');
    assert.deepEqual(parseYearMonth('2026-09'), { year: 2026, month: 9 });
    assert.deepEqual(parseYearMonth(' 2027-01 '), { year: 2027, month: 1 });
  });

  it('rechaza claves invalidas', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-01', '2026/01', '', null, undefined]) assert.equal(parseYearMonth(bad), null);
  });

  it('lee el mes de una fecha como texto, sin depender de la zona horaria', () => {
    // new Date('2026-09-01') en Chile es 31-ago: esa era la causa del bug.
    assert.deepEqual(yearMonthOfISODate('2026-09-01'), { year: 2026, month: 9 });
    assert.deepEqual(yearMonthOfISODate('2027-01-01'), { year: 2027, month: 1 });
    assert.deepEqual(yearMonthOfISODate('2027-01-01T00:00:00Z'), { year: 2027, month: 1 });
    assert.equal(yearMonthOfISODate(''), null);
  });

  it('"hoy" se evalua en hora de Chile', () => {
    // 02:30 UTC del 1-ene = 23:30 del 31-dic en Santiago (UTC-3 en verano).
    assert.deepEqual(businessToday(new Date('2027-01-01T02:30:00Z')), { date: '2026-12-31', ym: { year: 2026, month: 12 } });
    assert.deepEqual(businessToday(new Date('2027-01-01T04:00:00Z')), { date: '2027-01-01', ym: { year: 2027, month: 1 } });
  });
});

describe('Año calendario y YTD', () => {
  it('1. today=2026-12-31, año 2026 → Ene–Dic 2026', () => {
    const w = buildViewWindow(calendar(2026), ym('2026-12'));
    assert.deepEqual(keys(w.months), monthsOf(2026));
    assert.equal(w.label, 'Ene–Dic 2026');
    assert.equal(w.containsToday, true);
    assert.deepEqual(keys(w.ytdMonths ?? []), monthsOf(2026));
    assert.equal(getPeriodPhase(ym('2026-12'), ym('2026-12')), 'current');
    assert.equal(getPeriodPhase(ym('2026-11'), ym('2026-12')), 'past');
  });

  it('2. today=2027-01-01, año 2026 → sigue siendo Ene–Dic 2026, completo y pasado', () => {
    const today = ym('2027-01');
    const w = buildViewWindow(calendar(2026), today);
    assert.deepEqual(keys(w.months), monthsOf(2026));
    assert.equal(w.containsToday, false);
    // YTD de un año pasado es el año completo: nunca se trunca con el mes de hoy.
    assert.deepEqual(keys(w.ytdMonths ?? []), monthsOf(2026));
    assert.ok(w.months.every((m) => getPeriodPhase(m, today) === 'past'));
    assert.deepEqual(getProjectionPeriods(w.months, today), []);
  });

  it('3. today=2027-01-01, año 2027 → YTD = Ene-27', () => {
    const today = ym('2027-01');
    const w = buildViewWindow(calendar(2027), today);
    assert.deepEqual(keys(w.ytdMonths ?? []), ['2027-01']);
    assert.equal(getProjectionPeriods(w.months, today).length, 11);
  });

  it('YTD de un año futuro esta vacio', () => {
    assert.deepEqual(getYTDPeriods(2028, ym('2027-06')), []);
  });
});

describe('Rolling', () => {
  it('4. today=2027-03, Rolling 12M → Abr-26 … Mar-27', () => {
    const w = buildViewWindow(rolling12('2027-03'), ym('2027-03'));
    assert.deepEqual(keys(w.months), [
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
      '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
    ]);
    assert.equal(w.label, 'Abr-26 – Mar-27');
    assert.equal(w.spansYears, true);
    assert.deepEqual(windowMonthLabels(w).slice(0, 2), ['Abr-26', 'May-26']);
    assert.equal(w.ytdMonths, null);
  });

  it('la misma infraestructura sirve para 3M y 6M', () => {
    assert.deepEqual(keys(getRollingMonths(ym('2027-02'), 3)), ['2026-12', '2027-01', '2027-02']);
    assert.equal(getRollingMonths(ym('2027-02'), 6).length, 6);
    assert.throws(() => getRollingMonths(ym('2027-02'), 0));
  });
});

describe('Reportes por periodo', () => {
  it('nombres de CSV segun la ventana', () => {
    assert.equal(periodFileName('resumen_ingresos', buildViewWindow(calendar(2026), ym('2027-03'))), 'resumen_ingresos_2026.csv');
    assert.equal(periodFileName('resumen_ingresos', buildViewWindow(calendar(2027), ym('2027-03'))), 'resumen_ingresos_2027.csv');
    assert.equal(
      periodFileName('resumen_ingresos', buildViewWindow(rolling12('2027-03'), ym('2027-03'))),
      'resumen_ingresos_rolling_12m_2027-03.csv'
    );
  });
});

describe('Años disponibles y navegacion', () => {
  it('salen de los datos y de hoy, sin años hardcodeados', () => {
    const data = collectSellerDataMonths([
      { fContrato: '2025-06-10', customDctos: {} },
      { fContrato: '2026-02-01', customDctos: { '2027-01': 700000, 'basura': 1 } },
    ]);
    assert.deepEqual(getAvailableYears(data, ym('2026-09')), [2025, 2026, 2027]);
    assert.deepEqual(getAvailableYears([], ym('2030-05')), [2030]);
  });

  it('9. el cambio de año no requiere cambios de codigo (2027 → 2028 → 2030)', () => {
    for (const today of ['2027-12', '2028-01', '2030-06']) {
      const t = ym(today);
      const years = getAvailableYears(collectSellerDataMonths([{ fContrato: '2026-03-01', customDctos: {} }]), t);
      assert.equal(years[0], 2026);
      assert.equal(years[years.length - 1], t.year);
      const w = buildViewWindow(calendar(t.year), t);
      assert.deepEqual(keys(w.months), monthsOf(t.year));
      assert.equal(keys(w.ytdMonths ?? []).at(-1), today);
      // El año anterior sigue disponible y completo.
      assert.deepEqual(keys(buildViewWindow(calendar(t.year - 1), t).ytdMonths ?? []), monthsOf(t.year - 1));
    }
  });

  it('anterior/siguiente y cambio de vista respetan los limites', () => {
    const years = [2025, 2026];
    assert.equal(canShiftSelection(calendar(2026), 1, years), false);
    assert.equal(canShiftSelection(calendar(2026), -1, years), true);
    assert.deepEqual(shiftSelection(rolling12('2027-01'), -1), rolling12('2026-12'));
    assert.deepEqual(clampSelection(calendar(2031), years), calendar(2026));
    assert.deepEqual(switchSelectionMode(calendar(2025), 'rolling', ym('2026-09')), rolling12('2025-12'));
    assert.deepEqual(switchSelectionMode(calendar(2026), 'rolling', ym('2026-09')), rolling12('2026-09'));
    assert.deepEqual(switchSelectionMode(rolling12('2026-03'), 'calendar', ym('2026-09')), calendar(2026));
  });
});
