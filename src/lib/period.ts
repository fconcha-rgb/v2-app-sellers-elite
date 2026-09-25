/* ════════════════════════════════════════════════════════════════════════════
   PERIODO SELECCIONADO — lo que el usuario esta mirando (distinto de "hoy").
   El modelo base (YearMonth, parse/serialize, ventanas) vive en el modulo
   compartido con las Edge Functions; aqui solo lo propio de la UI.
   ════════════════════════════════════════════════════════════════════════════ */
import {
  MONTHS_PER_YEAR,
  businessToday,
  compareYearMonth,
  getCalendarYearMonths,
  getRollingMonths,
  getYTDPeriods,
  isSameYearMonth,
  makeYearMonth,
  parseYearMonth,
  serializeYearMonth,
  yearMonthOfISODate,
  addMonths,
  type YearMonth,
} from '../../supabase/functions/_shared/period.ts';

export * from '../../supabase/functions/_shared/period.ts';

export const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const;
export const ROLLING_LENGTH = 12;

export type PeriodMode = 'calendar' | 'rolling';
export type PeriodSelection =
  | { readonly mode: 'calendar'; readonly year: number }
  | { readonly mode: 'rolling'; readonly end: YearMonth; readonly length: number };

export type ViewWindow = {
  readonly selection: PeriodSelection;
  readonly months: readonly YearMonth[];
  /** 'Ene–Dic 2026' · 'Abr-26 – Mar-27' */
  readonly label: string;
  /** sufijo de archivos: '2026' · 'rolling_12m_2027-03' */
  readonly fileSlug: string;
  /** true si los meses cruzan años (las etiquetas llevan el año) */
  readonly spansYears: boolean;
  readonly containsToday: boolean;
  /** meses YTD del año calendario; null en rolling */
  readonly ytdMonths: readonly YearMonth[] | null;
};

/* ── Etiquetas ───────────────────────────────────────────────────────────── */
const twoDigitYear = (year: number) => String(year % 100).padStart(2, '0');

/** 'Sep' o, si withYear, 'Sep-26'. */
export const formatMonthShort = (ym: YearMonth, withYear = false): string =>
  MONTHS_SHORT[ym.month - 1] + (withYear ? '-' + twoDigitYear(ym.year) : '');

/** 'Sep 2026' */
export const formatMonthTitle = (ym: YearMonth): string => MONTHS_SHORT[ym.month - 1] + ' ' + ym.year;

/** 'septiembre de 2026' (sin leer el reloj: fecha fija a mitad de mes en UTC). */
export const formatMonthLong = (ym: YearMonth): string =>
  new Date(Date.UTC(ym.year, ym.month - 1, 15)).toLocaleDateString('es-CL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Fecha de negocio de un timestamp persistido (p.ej. closed_at); '' si no es valido. */
export const businessDateOf = (timestamp: string): string => {
  const d = new Date(timestamp);
  return Number.isNaN(d.getTime()) ? '' : businessToday(d).date;
};

/* ── Ventana visible ─────────────────────────────────────────────────────── */
export const buildViewWindow = (selection: PeriodSelection, today: YearMonth): ViewWindow => {
  const months =
    selection.mode === 'calendar' ? getCalendarYearMonths(selection.year) : getRollingMonths(selection.end, selection.length);
  const first = months[0];
  const last = months[months.length - 1];
  const spansYears = first.year !== last.year;
  return {
    selection,
    months,
    label:
      selection.mode === 'calendar'
        ? MONTHS_SHORT[0] + '–' + MONTHS_SHORT[MONTHS_PER_YEAR - 1] + ' ' + selection.year
        : formatMonthShort(first, true) + ' – ' + formatMonthShort(last, true),
    fileSlug:
      selection.mode === 'calendar'
        ? String(selection.year)
        : 'rolling_' + selection.length + 'm_' + serializeYearMonth(selection.end),
    spansYears,
    containsToday: months.some((m) => isSameYearMonth(m, today)),
    ytdMonths: selection.mode === 'calendar' ? getYTDPeriods(selection.year, today) : null,
  };
};

export const windowMonthLabels = (w: ViewWindow): string[] => w.months.map((m) => formatMonthShort(m, w.spansYears));

export const periodFileName = (base: string, w: ViewWindow): string => base + '_' + w.fileSlug + '.csv';

/* ── Años disponibles (sin hardcodes: salen de los datos y de hoy) ───────── */
export const collectSellerDataMonths = (
  sellers: readonly { fContrato: string; customDctos: Readonly<Record<string, unknown>> }[]
): YearMonth[] => {
  const out: YearMonth[] = [];
  sellers.forEach((s) => {
    const inicio = yearMonthOfISODate(s.fContrato);
    if (inicio) out.push(inicio);
    Object.keys(s.customDctos || {}).forEach((k) => {
      const ym = parseYearMonth(k);
      if (ym) out.push(ym);
    });
  });
  return out;
};

/** Desde el primer año con datos hasta max(año actual, ultimo año con datos). */
export const getAvailableYears = (dataMonths: Iterable<YearMonth>, today: YearMonth): number[] => {
  let first = today.year;
  let last = today.year;
  for (const m of dataMonths) {
    if (m.year < first) first = m.year;
    if (m.year > last) last = m.year;
  }
  const years: number[] = [];
  for (let y = first; y <= last; y++) years.push(y);
  return years;
};

export type SelectionBounds = { readonly first: YearMonth; readonly last: YearMonth };

export const selectionBounds = (years: readonly number[]): SelectionBounds => ({
  first: makeYearMonth(years[0], 1),
  last: makeYearMonth(years[years.length - 1], MONTHS_PER_YEAR),
});

const clampYearMonth = (ym: YearMonth, b: SelectionBounds): YearMonth =>
  compareYearMonth(ym, b.first) < 0 ? b.first : compareYearMonth(ym, b.last) > 0 ? b.last : ym;

/** Mantiene la seleccion dentro de los años disponibles. */
export const clampSelection = (sel: PeriodSelection, years: readonly number[]): PeriodSelection => {
  const b = selectionBounds(years);
  if (sel.mode === 'calendar') {
    const year = Math.min(Math.max(sel.year, b.first.year), b.last.year);
    return year === sel.year ? sel : { mode: 'calendar', year };
  }
  const end = clampYearMonth(sel.end, b);
  return isSameYearMonth(end, sel.end) ? sel : { ...sel, end };
};

/** Anterior / siguiente: un año en calendario, un mes en rolling. */
export const shiftSelection = (sel: PeriodSelection, step: number): PeriodSelection =>
  sel.mode === 'calendar' ? { mode: 'calendar', year: sel.year + step } : { ...sel, end: addMonths(sel.end, step) };

export const canShiftSelection = (sel: PeriodSelection, step: number, years: readonly number[]): boolean => {
  const b = selectionBounds(years);
  if (sel.mode === 'calendar') {
    const y = sel.year + step;
    return y >= b.first.year && y <= b.last.year;
  }
  const end = addMonths(sel.end, step);
  return compareYearMonth(end, b.first) >= 0 && compareYearMonth(end, b.last) <= 0;
};

/** Al cambiar de vista se conserva el contexto: el año del rolling, o el mes
 *  de hoy / diciembre del año elegido como fin del rolling. */
export const switchSelectionMode = (sel: PeriodSelection, mode: PeriodMode, today: YearMonth): PeriodSelection => {
  if (sel.mode === mode) return sel;
  if (mode === 'calendar') return { mode: 'calendar', year: sel.mode === 'rolling' ? sel.end.year : today.year };
  const year = sel.mode === 'calendar' ? sel.year : today.year;
  return { mode: 'rolling', end: year === today.year ? today : makeYearMonth(year, MONTHS_PER_YEAR), length: ROLLING_LENGTH };
};
