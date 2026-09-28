/* ════════════════════════════════════════════════════════════════════════════
   PERIODOS — modelo temporal canonico de Sellers Elite.
   Compartido por el frontend (Vite) y las Edge Functions (Deno): TypeScript
   puro, sin DOM, sin APIs de Deno y sin leer el reloj de forma implicita.

   · YearMonth es la unidad de facturacion. Su UNICA serializacion es 'YYYY-MM'
     (la misma clave que usan custom_dctos, los CSV, Storage y el billing).
   · Las fechas de negocio ('YYYY-MM-DD' de Postgres) se leen como texto:
     new Date('2026-09-01') en Chile es 31-ago y desplaza el mes de contrato.
   · "Hoy" siempre se inyecta. businessToday(now) es el unico punto que
     interpreta un instante, y lo hace en la zona horaria del negocio.
   ════════════════════════════════════════════════════════════════════════════ */

export const BUSINESS_TIME_ZONE = 'America/Santiago';
export const MONTHS_PER_YEAR = 12;

/** month: 1–12 */
export type YearMonth = { readonly year: number; readonly month: number };
/** 'YYYY-MM' producido exclusivamente por serializeYearMonth. */
export type YearMonthKey = string & { readonly __brand: 'YearMonthKey' };
/** 'YYYY-MM-DD' */
export type ISODate = string;
export type BusinessToday = { readonly date: ISODate; readonly ym: YearMonth };
export type PeriodPhase = 'past' | 'current' | 'future';

const MAX_YEAR = 9999;
const YEAR_MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:$|[T ])/;

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export const isValidYearMonth = (year: number, month: number): boolean =>
  Number.isInteger(year) &&
  year >= 0 &&
  year <= MAX_YEAR &&
  Number.isInteger(month) &&
  month >= 1 &&
  month <= MONTHS_PER_YEAR;

export const makeYearMonth = (year: number, month: number): YearMonth => {
  if (!isValidYearMonth(year, month)) throw new RangeError('Periodo invalido: ' + year + '-' + month);
  return { year, month };
};

export const parseYearMonth = (key: string | null | undefined): YearMonth | null => {
  const m = YEAR_MONTH_KEY_RE.exec(String(key ?? '').trim());
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
};

export const serializeYearMonth = (ym: YearMonth): YearMonthKey =>
  (pad(ym.year, 4) + '-' + pad(ym.month, 2)) as YearMonthKey;

/** 'YYYY-MM-DD' (o timestamp ISO) → 'YYYY-MM-DD'; '' si no es una fecha. */
export const normalizeISODate = (value: string | null | undefined): ISODate => {
  const m = ISO_DATE_RE.exec(String(value ?? '').trim());
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
};

/** Mes calendario de una fecha de negocio, leido como texto (sin zona horaria). */
export const yearMonthOfISODate = (value: string | null | undefined): YearMonth | null => {
  const d = normalizeISODate(value);
  return d ? { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) } : null;
};

export const isoDateOf = (ym: YearMonth, day: number): ISODate => serializeYearMonth(ym) + '-' + pad(day, 2);

/* ── Aritmetica de meses ─────────────────────────────────────────────────── */
export const monthIndex = (ym: YearMonth): number => ym.year * MONTHS_PER_YEAR + (ym.month - 1);

export const fromMonthIndex = (index: number): YearMonth => {
  const year = Math.floor(index / MONTHS_PER_YEAR);
  return { year, month: index - year * MONTHS_PER_YEAR + 1 };
};

export const addMonths = (ym: YearMonth, n: number): YearMonth => fromMonthIndex(monthIndex(ym) + n);
export const monthsBetween = (from: YearMonth, to: YearMonth): number => monthIndex(to) - monthIndex(from);
export const compareYearMonth = (a: YearMonth, b: YearMonth): number => monthIndex(a) - monthIndex(b);
export const isSameYearMonth = (a: YearMonth, b: YearMonth): boolean => compareYearMonth(a, b) === 0;

/** Meses de `from` a `to`, ambos incluidos. */
export const getMonthRange = (from: YearMonth, to: YearMonth): YearMonth[] => {
  const out: YearMonth[] = [];
  for (let i = monthIndex(from); i <= monthIndex(to); i++) out.push(fromMonthIndex(i));
  return out;
};

/* ── Ventanas ────────────────────────────────────────────────────────────── */
export const getCalendarYearMonths = (year: number): YearMonth[] =>
  getMonthRange(makeYearMonth(year, 1), makeYearMonth(year, MONTHS_PER_YEAR));

/** Ultimos `length` meses terminando en `end` (incluido): Rolling 3M/6M/12M. */
export const getRollingMonths = (end: YearMonth, length: number): YearMonth[] => {
  if (!Number.isInteger(length) || length < 1) throw new RangeError('Largo de rolling invalido: ' + length);
  return getMonthRange(addMonths(end, -(length - 1)), end);
};

export const getPeriodPhase = (ym: YearMonth, today: YearMonth): PeriodPhase => {
  const d = compareYearMonth(ym, today);
  return d < 0 ? 'past' : d === 0 ? 'current' : 'future';
};
export const isHistoricalPeriod = (ym: YearMonth, today: YearMonth): boolean => getPeriodPhase(ym, today) === 'past';
export const isCurrentPeriod = (ym: YearMonth, today: YearMonth): boolean => getPeriodPhase(ym, today) === 'current';
export const isFuturePeriod = (ym: YearMonth, today: YearMonth): boolean => getPeriodPhase(ym, today) === 'future';

/** YTD: año en curso → Ene..mes actual; año pasado → Ene..Dic; año futuro → []. */
export const getYTDPeriods = (year: number, today: YearMonth): YearMonth[] => {
  if (year > today.year) return [];
  const last = year === today.year ? today : makeYearMonth(year, MONTHS_PER_YEAR);
  return getMonthRange(makeYearMonth(year, 1), last);
};

export const getProjectionPeriods = (months: readonly YearMonth[], today: YearMonth): YearMonth[] =>
  months.filter((m) => isFuturePeriod(m, today));

/* ── Hoy ─────────────────────────────────────────────────────────────────── */
export const businessToday = (now: Date, timeZone: string = BUSINESS_TIME_ZONE): BusinessToday => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);
  const ym = makeYearMonth(part('year'), part('month'));
  return { date: isoDateOf(ym, part('day')), ym };
};
