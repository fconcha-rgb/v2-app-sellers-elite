/* ════════════════════════════════════════════════════════════════════════════
   DETALLE DE COBROS — una tabla por plan (Full / Premium / Basico).
   Mismo markup que las tres tablas originales; los datos salen del ledger, asi
   cada columna es un mes real de la ventana (cualquier año o rolling) y los
   meses cerrados se leen del snapshot y no se pueden editar.
   ════════════════════════════════════════════════════════════════════════════ */
import type { ReactNode } from 'react';
import { C, fmt } from './theme';
import type { DetailGroup, DetailRow, MonthStatus } from './lib/ledger.ts';

export type MonthColumn = {
  key: string;
  label: string;
  status: MonthStatus;
  isCurrent: boolean;
  /** tooltip del encabezado (estado del mes) */
  title: string;
};

/** Mismo tono atenuado que las barras proyectadas del grafico. */
const FORECAST_CELL_OPACITY = 0.7;

type Props<S> = {
  title: string;
  planPill: ReactNode;
  groupColor: string;
  countNoun: string;
  expandLabel: string;
  collapseLabel: string;
  groups: readonly DetailGroup<S>[];
  months: readonly MonthColumn[];
  isExpanded: (groupKey: string) => boolean;
  onToggle: (groupKey: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onDownload: () => void;
  renderTags: (row: DetailRow<S>) => ReactNode;
  onEditCell: (row: DetailRow<S>, monthIdx: number) => void;
};

const thBase = {
  padding: '8px 8px',
  textAlign: 'left' as const,
  fontWeight: 700,
  fontSize: 10,
  color: C.textMuted,
  textTransform: 'uppercase' as const,
  whiteSpace: 'nowrap' as const,
};

export default function CobrosDetailTable<S extends { tarifa: number; dcto: number; min: number }>(props: Props<S>) {
  const { months } = props;
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid ' + C.border,
          background: C.bgAlt,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>{props.title}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm btn-ghost" onClick={props.onExpandAll}>
            {props.expandLabel}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={props.onCollapseAll}>
            {props.collapseLabel}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={props.onDownload}>
            Descargar
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1200 }}>
          <thead>
            <tr style={{ background: C.bgAlt, borderBottom: '2px solid ' + C.border }}>
              {['Seller', 'ID', 'KAM', 'Plan', 'Tarifa', 'Dcto', 'Min'].map((h) => (
                <th key={h} style={thBase}>
                  {h}
                </th>
              ))}
              {months.map((m) => (
                <th
                  key={m.key}
                  title={m.title}
                  style={{ ...thBase, padding: '8px 6px', textAlign: 'right', textTransform: 'none', background: m.isCurrent ? C.primaryBg : undefined }}
                >
                  {m.label}
                </th>
              ))}
              <th style={{ ...thBase, padding: '8px 10px', textAlign: 'right', textTransform: 'none', background: C.primaryBg }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {props.groups.flatMap((group) => {
              const expanded = props.isExpanded(group.key);
              const rows: ReactNode[] = [
                <tr
                  key={'grp-' + group.key}
                  style={{ background: C.bgAlt, cursor: 'pointer', borderBottom: '1px solid ' + C.border }}
                  onClick={() => props.onToggle(group.key)}
                >
                  <td colSpan={7} style={{ padding: '8px 8px', fontWeight: 700, fontSize: 12, color: C.text }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 16,
                          textAlign: 'center',
                          fontSize: 10,
                          color: C.textMuted,
                          transition: 'transform .2s',
                          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        }}
                      >
                        ▶
                      </span>
                      {group.key}
                      <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 500 }}>
                        {'(' + group.activeCount + ' ' + props.countNoun + ')'}
                      </span>
                    </span>
                  </td>
                  {group.monthTotals.map((mt, mi) => (
                    <td
                      key={mi}
                      style={{
                        padding: '8px 6px',
                        textAlign: 'right',
                        fontWeight: 700,
                        fontSize: 11,
                        color: props.groupColor,
                        background: months[mi].isCurrent ? C.primaryBg : undefined,
                        opacity: months[mi].status === 'forecast' ? FORECAST_CELL_OPACITY : undefined,
                      }}
                    >
                      {mt > 0 ? fmt(mt) : '-'}
                    </td>
                  ))}
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: props.groupColor, background: C.primaryBg, fontSize: 11 }}>
                    {fmt(group.total)}
                  </td>
                </tr>,
              ];
              if (expanded)
                group.rows.forEach((row) => {
                  const s = row.seller;
                  rows.push(
                    <tr key={row.id} className="row-hover" style={{ borderBottom: '1px solid ' + C.borderLight }}>
                      <td style={{ padding: '7px 8px 7px 28px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {row.sellerName}
                        {props.renderTags(row)}
                      </td>
                      <td style={{ padding: '7px 8px', color: C.textMuted, fontSize: 10 }}>{row.sid}</td>
                      <td style={{ padding: '7px 8px', color: C.textSec, fontSize: 10 }}>{row.kam}</td>
                      <td style={{ padding: '7px 8px' }}>{props.planPill}</td>
                      <td style={{ padding: '7px 8px', fontWeight: 600 }}>{s ? fmt(s.tarifa) : '-'}</td>
                      <td style={{ padding: '7px 8px', color: s && s.dcto > 0 ? C.purple : C.textMuted }}>{s && s.dcto > 0 ? s.dcto + 'm' : '-'}</td>
                      <td style={{ padding: '7px 8px' }}>{s ? s.min + 'm' : '-'}</td>
                      {months.map((m, mi) => {
                        const cell = row.cells[mi];
                        const editable = !!s && m.status !== 'closed';
                        const cc = !cell ? C.textMuted : cell.isCustom ? '#1D4ED8' : cell.isDiscount ? '#B45309' : C.primary;
                        const cb = !cell ? 'transparent' : cell.isCustom ? '#DBEAFE' : cell.isDiscount ? C.warningLight : C.primaryLight;
                        return (
                          <td
                            key={m.key}
                            className="month-cell"
                            style={{
                              padding: '7px 6px',
                              textAlign: 'right',
                              fontWeight: 600,
                              fontSize: 10,
                              whiteSpace: 'nowrap',
                              background: m.isCurrent ? C.primaryBg : undefined,
                              color: cc,
                              cursor: editable ? 'pointer' : 'default',
                              opacity: m.status === 'forecast' ? FORECAST_CELL_OPACITY : undefined,
                            }}
                            onClick={editable ? () => props.onEditCell(row, mi) : undefined}
                            title={editable ? 'Click para editar' : m.status === 'closed' ? 'Mes cerrado: no editable' : undefined}
                          >
                            {cell ? (
                              <span style={{ padding: '2px 5px', borderRadius: 4, background: cb, display: 'inline-block' }}>
                                {fmt(cell.amount)}
                                {cell.isCustom ? '•' : ''}
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                        );
                      })}
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: C.primaryDark, background: C.primaryBg }}>
                        {fmt(row.total)}
                      </td>
                    </tr>
                  );
                });
              return rows;
            })}
          </tbody>
        </table>
      </div>
      <div style={{ padding: '6px 16px', fontSize: 10, color: C.textMuted, borderTop: '1px solid ' + C.borderLight }}>
        {'• = cobro personalizado | Click en celda para editar (meses cerrados no se editan) | Click en gerencia para expandir/contraer'}
      </div>
    </div>
  );
}
