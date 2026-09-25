import assert from 'node:assert/strict';
import { DEFAULT_PRICING, buildBillingContext, type BillingContext, type BillingSeller } from '../supabase/functions/_shared/billing.ts';
import { parseYearMonth, serializeYearMonth, type YearMonth } from '../src/lib/period.ts';

export const TARIFA = 990000;

/** 'YYYY-MM' → YearMonth (falla el test si la clave es invalida). */
export const ym = (key: string): YearMonth => {
  const v = parseYearMonth(key);
  assert.ok(v, 'clave invalida en el test: ' + key);
  return v;
};

export const keys = (months: readonly YearMonth[]): string[] => months.map(serializeYearMonth);

export type TestSeller = BillingSeller & { min: number };

export const seller = (over: Partial<TestSeller> & { sid: string }): TestSeller => ({
  seller: over.sid + ' SpA',
  sec: 'Moda',
  kam: 'KAM 1',
  tipo: 'Full',
  status: 'Iniciado',
  tarifa: TARIFA,
  fContrato: '2026-01-05',
  fTermino: '',
  dcto: 0,
  min: 6,
  customDctos: {},
  esMulticuenta: false,
  principalSid: '',
  pricingOverride: null,
  ...over,
});

export const ctxOf = (sellers: readonly BillingSeller[]): BillingContext => buildBillingContext(sellers, DEFAULT_PRICING);
