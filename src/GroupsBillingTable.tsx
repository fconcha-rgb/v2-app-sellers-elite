/* ════════════════════════════════════════════════════════════════════════════
   DETALLE DE COBROS — GRUPOS MULTICUENTA (Dashboard)
   Replica el patron de las tablas "Detalle de Cobros Full/Premium": fila de
   grupo con totales mensuales, expandible a lineas por cuenta con su posicion,
   % y monto (cada cuenta factura desde su fecha_vinculacion).
   No se renderiza si no hay grupos activos.
   ════════════════════════════════════════════════════════════════════════════ */
import { useState, type ReactNode } from 'react';
import { C, fmt, fmtPct } from './theme';
import { downloadCSV } from './lib/csv';
import {
  MESES_CORTOS,
  getGroupMonthTotals,
  getGroupPricing,
  getMemberMonthAmount,
  getPctForPosition,
  getGroupOrdinals,
  type GroupJoined,
  type PricingConfig,
} from './lib/groupCalc';

const CUR_YEAR = new Date().getFullYear();
const CUR_MONTH = new Date().getMonth();

type Props = { joined: GroupJoined[]; cfg: PricingConfig };

export default function GroupsBillingTable({ joined, cfg }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (joined.length === 0) return null;

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    joined.forEach((j) => (all[j.group.id] = true));
    setExpanded(all);
  };

  const exportCSV = () => {
    const hdrs = ['Grupo', 'Cuenta', 'SID', 'KAM', 'Pos', '%', 'F.Vinculacion']
      .concat(MESES_CORTOS.slice())
      .concat(['Total']);
    const rws: string[][] = [];
    joined.forEach((j) => {
      const { ordered } = getGroupOrdinals(j.members, j.group.cuentaPrincipalSid);
      ordered.forEach((m, i) => {
        const pct = getPctForPosition(i, cfg);
        let yt = 0;
        const meses = MESES_CORTOS.map((_, mi) => {
          const a = getMemberMonthAmount(m.member.fechaVinculacion, pct, cfg, mi, CUR_YEAR);
          yt += a;
          return String(a);
        });
        rws.push(
          [j.group.nombre, m.seller.seller, m.seller.sid, m.seller.kam, String(i + 1), String(pct), m.member.fechaVinculacion]
            .concat(meses)
            .concat([String(yt)])
        );
      });
    });
    downloadCSV('detalle_cobros_grupos_' + CUR_YEAR + '.csv', hdrs, rws);
  };

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
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
          Detalle de Cobros - Grupos Multicuenta
        </h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm btn-ghost" onClick={expandAll}>
            Expandir Grupos
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setExpanded({})}>
            Contraer Grupos
          </button>
          <button className="btn btn-sm btn-ghost" onClick={exportCSV}>
            Descargar
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1200 }}>
          <thead>
            <tr style={{ background: C.bgAlt, borderBottom: '2px solid ' + C.border }}>
              {['Cuenta', 'ID', 'KAM', 'Pos', '%'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 8px',
                    textAlign: 'left',
                    fontWeight: 700,
                    fontSize: 10,
                    color: C.textMuted,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
              {MESES_CORTOS.map((m, mi) => (
                <th
                  key={m}
                  style={{
                    padding: '8px 6px',
                    textAlign: 'right',
                    fontWeight: 700,
                    fontSize: 10,
                    color: C.textMuted,
                    whiteSpace: 'nowrap',
                    background: mi === CUR_MONTH ? C.primaryBg : undefined,
                  }}
                >
                  {m}
                </th>
              ))}
              <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, fontSize: 10, color: C.textMuted, background: C.primaryBg }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {joined.flatMap(({ group: g, members: ms }) => {
              const isOpen = !!expanded[g.id];
              const monthTotals = getGroupMonthTotals(ms, g.cuentaPrincipalSid, cfg, CUR_YEAR);
              const yearTotal = monthTotals.reduce((a, b) => a + b, 0);
              const pricing = getGroupPricing(ms, g.cuentaPrincipalSid, cfg, CUR_MONTH, CUR_YEAR);
              const rows: ReactNode[] = [];

              rows.push(
                <tr
                  key={'grp-' + g.id}
                  style={{ background: C.bgAlt, cursor: 'pointer', borderBottom: '1px solid ' + C.border }}
                  onClick={() => setExpanded((p) => ({ ...p, [g.id]: !p[g.id] }))}
                >
                  <td colSpan={5} style={{ padding: '8px 8px', fontWeight: 700, fontSize: 12, color: C.text }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 16,
                          textAlign: 'center',
                          fontSize: 10,
                          color: C.textMuted,
                          transition: 'transform .2s',
                          transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                        }}
                      >
                        ▶
                      </span>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          background: C.brand,
                          borderRadius: 0,
                        }}
                      />
                      {g.nombre}
                      <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 500 }}>
                        {'(' + pricing.activas + ' activas)'}
                      </span>
                      {pricing.sucesionActiva && (
                        <span style={{ fontSize: 9, color: '#7A5C00', background: C.warningLight, fontWeight: 700, padding: '1px 6px', borderRadius: 4 }}>
                          ⚠ PRINCIPAL TEMPORAL
                        </span>
                      )}
                    </span>
                  </td>
                  {monthTotals.map((mt, mi) => (
                    <td
                      key={mi}
                      style={{
                        padding: '8px 6px',
                        textAlign: 'right',
                        fontWeight: 700,
                        fontSize: 11,
                        color: C.brandDark,
                        background: mi === CUR_MONTH ? C.primaryBg : undefined,
                      }}
                    >
                      {mt > 0 ? fmt(mt) : '-'}
                    </td>
                  ))}
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: C.brandDark, background: C.primaryBg, fontSize: 11 }}>
                    {fmt(yearTotal)}
                  </td>
                </tr>
              );

              if (isOpen) {
                pricing.lines.forEach((l) => {
                  const pct = l.pct;
                  let yt = 0;
                  rows.push(
                    <tr
                      key={'gm-' + g.id + '-' + l.sid}
                      className="row-hover"
                      style={{ borderBottom: '1px solid ' + C.borderLight, opacity: l.activa ? 1 : 0.6 }}
                    >
                      <td style={{ padding: '7px 8px 7px 28px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {l.seller}
                        {l.esPrincipalEfectiva && (
                          <span style={{ marginLeft: 4, fontSize: 9, color: C.brandDark, fontWeight: 800 }} title="Principal efectiva">
                            ★
                          </span>
                        )}
                        {l.status === 'Fuga' && (
                          <span style={{ marginLeft: 4, fontSize: 9, color: C.danger, fontWeight: 700 }}>FUGA</span>
                        )}
                        {l.status === 'Pausa' && (
                          <span style={{ marginLeft: 4, fontSize: 9, color: C.warning, fontWeight: 700 }}>PAUSA</span>
                        )}
                      </td>
                      <td style={{ padding: '7px 8px', color: C.textMuted, fontSize: 10 }}>{l.sid}</td>
                      <td style={{ padding: '7px 8px', color: C.textSec, fontSize: 10 }}>{l.kam}</td>
                      <td style={{ padding: '7px 8px', fontWeight: 700 }}>{l.posicion ? l.posicion + 'ª' : '—'}</td>
                      <td style={{ padding: '7px 8px', color: C.textSec }}>{pct != null ? fmtPct(pct) : '—'}</td>
                      {MESES_CORTOS.map((_, mi) => {
                        const a =
                          l.activa && pct != null
                            ? getMemberMonthAmount(l.fechaVinculacion, pct, cfg, mi, CUR_YEAR)
                            : 0;
                        yt += a;
                        return (
                          <td
                            key={mi}
                            style={{
                              padding: '7px 6px',
                              textAlign: 'right',
                              fontWeight: 600,
                              fontSize: 10,
                              whiteSpace: 'nowrap',
                              background: mi === CUR_MONTH ? C.primaryBg : undefined,
                              color: a > 0 ? C.text : C.textMuted,
                            }}
                          >
                            {a > 0 ? fmt(a) : '-'}
                          </td>
                        );
                      })}
                      <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: C.primaryDark, background: C.primaryBg }}>
                        {fmt(yt)}
                      </td>
                    </tr>
                  );
                });
              }
              return rows;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
