/* ════════════════════════════════════════════════════════════════════════════
   BARRA DE PERIODO — que esta mirando el usuario (distinto de "hoy").
   Periodo: ‹ [2026 ▼] ›   Vista: [Año calendario | Rolling 12M]
   A la derecha, la ventana y cuantos meses son Real / Actual / Estimado /
   Proyeccion, para que nunca se mezclen silenciosamente.
   ════════════════════════════════════════════════════════════════════════════ */
import { C } from './theme';
import {
  canShiftSelection,
  parseYearMonth,
  selectionBounds,
  serializeYearMonth,
  shiftSelection,
  switchSelectionMode,
  type PeriodMode,
  type PeriodSelection,
  type ViewWindow,
  type YearMonth,
} from './lib/period.ts';
import type { StatusBreakdown } from './lib/ledger.ts';

export function SegmentedToggle<K extends string>(props: {
  value: K;
  options: readonly (readonly [K, string])[];
  onChange: (k: K) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 2, background: C.bgDark, padding: 2, borderRadius: 8 }}>
      {props.options.map(([k, l]) => (
        <button
          key={k}
          onClick={() => props.onChange(k)}
          style={{
            padding: '5px 12px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
            background: props.value === k ? C.primary : 'transparent',
            color: props.value === k ? '#fff' : C.textSec,
            transition: 'all .15s',
          }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

const MODE_OPTIONS: readonly (readonly [PeriodMode, string])[] = [
  ['calendar', 'Año calendario'],
  ['rolling', 'Rolling 12M'],
];

const labelStyle = {
  fontSize: 10,
  color: C.textMuted,
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '.4px',
};

type Props = {
  selection: PeriodSelection;
  viewWindow: ViewWindow;
  years: readonly number[];
  counts: StatusBreakdown;
  today: YearMonth;
  onChange: (sel: PeriodSelection) => void;
};

export default function PeriodBar({ selection, viewWindow, years, counts, today, onChange }: Props) {
  const bounds = selectionBounds(years);
  const summary = [
    counts.closed > 0 && counts.closed + ' real',
    counts.current > 0 && counts.current + ' actual',
    counts.forecast > 0 && counts.forecast + ' proyección',
  ].filter(Boolean);
  const arrow = (step: number, glyph: string, title: string) => (
    <button
      className="btn btn-ghost btn-sm"
      style={{ padding: '4px 10px', fontSize: 13, lineHeight: 1 }}
      disabled={!canShiftSelection(selection, step, years)}
      onClick={() => onChange(shiftSelection(selection, step))}
      title={title}
    >
      {glyph}
    </button>
  );
  return (
    <div className="card" style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={labelStyle}>Periodo</span>
        {arrow(-1, '‹', selection.mode === 'calendar' ? 'Año anterior' : 'Mes anterior')}
        {selection.mode === 'calendar' ? (
          <select
            value={selection.year}
            onChange={(e) => onChange({ mode: 'calendar', year: Number(e.target.value) })}
            style={{ fontWeight: 700 }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="month"
            value={serializeYearMonth(selection.end)}
            min={serializeYearMonth(bounds.first)}
            max={serializeYearMonth(bounds.last)}
            onChange={(e) => {
              const end = parseYearMonth(e.target.value);
              if (end) onChange({ ...selection, end });
            }}
            title="Mes final de la ventana"
            style={{ fontWeight: 700 }}
          />
        )}
        {arrow(1, '›', selection.mode === 'calendar' ? 'Año siguiente' : 'Mes siguiente')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={labelStyle}>Vista</span>
        <SegmentedToggle value={selection.mode} options={MODE_OPTIONS} onChange={(m) => onChange(switchSelectionMode(selection, m, today))} />
      </div>
      <div style={{ flex: '1 1 220px', textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{viewWindow.label}</div>
        <div style={{ fontSize: 10.5, color: C.textMuted, fontWeight: 600 }}>
          {summary.join(' · ')}
          {counts.estimated > 0 && (
            <span
              style={{ color: C.warning, fontWeight: 700 }}
              title="Meses pasados sin cierre persistido: se recalculan con las condiciones actuales de cada seller y pueden no coincidir con lo facturado."
            >
              {(summary.length ? ' · ' : '') + counts.estimated + (counts.estimated === 1 ? ' mes sin cierre (estimado)' : ' meses sin cierre (estimados)')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
