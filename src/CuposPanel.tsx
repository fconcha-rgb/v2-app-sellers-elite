/* ════════════════════════════════════════════════════════════════════════════
   PANEL DE CUPOS — 3 PROPUESTAS PARA ELEGIR (rama de prueba)
   Muestra en la hoja Cobros los CUPOS REALES (con pareo multicuenta) junto a
   la CANTIDAD DE SELLERS de cada KAM. Las tres vistas son la misma data:
     A · Chips     — tarjetas compactas por KAM, agrupadas por gerencia
     B · Barras    — un card por gerencia con barras de ocupacion por KAM
     C · Tabla     — tabla densa con desglose F/P/B y multicuentas
   En TODAS: click en un KAM filtra la tabla de sellers de abajo (click de
   nuevo, o "Todos", limpia el filtro). Cuando elijas, dejamos solo esa vista
   y el selector A/B/C desaparece.
   ════════════════════════════════════════════════════════════════════════════ */
import { useMemo, useState } from 'react';
import { C } from './theme';

export type CupoRow = {
  id: string;
  gerencia: string;
  kam: string;
  total: number;
  usados: number;
  disp: number;
};

type SellerLite = { sid: string; kam: string; sec: string; status: string; tipo: string };

type Props = {
  rows: CupoRow[];
  sellers: SellerLite[];
  mcSids: Set<string>;
  selectedKam: string; // 'Todos' | nombre
  onSelectKam: (k: string) => void;
  variant: 'A' | 'B' | 'C';
  onVariant: (v: 'A' | 'B' | 'C') => void;
};

const ratioColor = (u: number, t: number) => {
  if (t <= 0) return C.textMuted;
  const r = u / t;
  if (r >= 1) return C.danger;
  if (r >= 0.85) return C.warning;
  return C.primary;
};

const MiniBar = ({ u, t, w }: { u: number; t: number; w?: number | string }) => (
  <div style={{ width: w ?? '100%', height: 5, background: C.bgDark, borderRadius: 3, overflow: 'hidden' }}>
    <div
      style={{
        width: (t > 0 ? Math.min(100, (u / t) * 100) : 0) + '%',
        height: '100%',
        background: ratioColor(u, t),
        transition: 'width .25s',
      }}
    />
  </div>
);

export default function CuposPanel({ rows, sellers, mcSids, selectedKam, onSelectKam, variant, onVariant }: Props) {
  const [open, setOpen] = useState(true);

  /* Conteo de sellers por (kam|gerencia): activos = sin Fuga (mismo criterio
     con el que un individual ocupa cupo). MC = cuentas multicuenta activas. */
  const stats = useMemo(() => {
    const m = new Map<string, { n: number; full: number; prem: number; bas: number; mc: number }>();
    sellers.forEach((s) => {
      if (s.status === 'Fuga') return;
      const k = s.kam + '|' + s.sec;
      const e = m.get(k) || { n: 0, full: 0, prem: 0, bas: 0, mc: 0 };
      e.n++;
      if (s.tipo === 'Full') e.full++;
      else if (s.tipo === 'Premium') e.prem++;
      else e.bas++;
      if (mcSids.has(s.sid)) e.mc++;
      m.set(k, e);
    });
    return m;
  }, [sellers, mcSids]);

  const st = (r: CupoRow) => stats.get(r.kam + '|' + r.gerencia) || { n: 0, full: 0, prem: 0, bas: 0, mc: 0 };

  const gerencias = useMemo(() => {
    const gs = Array.from(new Set(rows.map((r) => r.gerencia)));
    return gs.map((g) => ({ g, rows: rows.filter((r) => r.gerencia === g) }));
  }, [rows]);

  const glob = useMemo(() => {
    let u = 0, t = 0, n = 0, mcN = 0;
    rows.forEach((r) => { u += r.usados; t += r.total; });
    sellers.forEach((s) => { if (s.status !== 'Fuga') { n++; if (mcSids.has(s.sid)) mcN++; } });
    return { u, t, n, mcN };
  }, [rows, sellers, mcSids]);

  const toggleKam = (kam: string) => onSelectKam(selectedKam === kam ? 'Todos' : kam);

  if (rows.length === 0) return null;

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {/* ── Header del panel: titulo + resumen global + selector de vista ── */}
      <div
        style={{
          padding: '10px 14px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          background: C.bgAlt,
          borderBottom: open ? '1px solid ' + C.border : 'none',
        }}
      >
        <button
          onClick={() => setOpen(!open)}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: C.textMuted, padding: 2, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .2s', fontFamily: 'inherit' }}
        >
          ▶
        </button>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.4px' }}>
            Cupos reales por KAM
          </div>
          <div style={{ fontSize: 10, color: C.textMuted }}>
            individuales 1 = 1 cupo · multicuentas pareadas por KAM (2 = 1 cupo) · click en un KAM filtra la tabla
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: ratioColor(glob.u, glob.t), lineHeight: 1 }}>
              {glob.u + ' / ' + glob.t}
              <span style={{ fontSize: 10, fontWeight: 600, color: C.textMuted }}> cupos</span>
            </div>
            <div style={{ fontSize: 10, color: C.textMuted }}>
              {glob.n + ' sellers activos' + (glob.mcN > 0 ? ' · ' + glob.mcN + ' MC' : '')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 2, background: C.bgDark, padding: 2, borderRadius: 8 }}>
            {([['A', 'A · Chips'], ['B', 'B · Barras'], ['C', 'C · Tabla']] as ['A' | 'B' | 'C', string][]).map(([k, l]) => (
              <button
                key={k}
                onClick={() => onVariant(k)}
                style={{
                  padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                  background: variant === k ? '#0A0A0A' : 'transparent',
                  color: variant === k ? '#fff' : C.textSec,
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {open && variant === 'A' && (
        /* ═══ PROPUESTA A — CHIPS POR KAM ═══ */
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {gerencias.map(({ g, rows: rs }) => (
            <div key={g} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.5px', minWidth: 94 }}>
                {g}
              </div>
              {rs.map((r) => {
                const s = st(r);
                const sel = selectedKam === r.kam;
                return (
                  <button
                    key={r.id}
                    onClick={() => toggleKam(r.kam)}
                    title={s.n + ' sellers activos (' + s.full + ' Full · ' + s.prem + ' Premium · ' + s.bas + ' Basico)' + (s.mc > 0 ? ' · ' + s.mc + ' multicuenta' : '') + ' → ' + r.usados + '/' + r.total + ' cupos, ' + r.disp + ' disponibles'}
                    style={{
                      fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer',
                      padding: '7px 12px', borderRadius: 8, minWidth: 148,
                      background: sel ? '#0A0A0A' : C.bgCard,
                      border: '1px solid ' + (sel ? '#0A0A0A' : C.border),
                      boxShadow: sel ? 'none' : '0 1px 2px rgba(10,10,10,.04)',
                      transition: 'all .15s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: sel ? '#fff' : C.text }}>{r.kam}</span>
                      <span style={{ fontSize: 12, fontWeight: 800, color: sel ? C.brand : ratioColor(r.usados, r.total) }}>
                        {r.usados + '/' + r.total}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, margin: '2px 0 5px' }}>
                      <span style={{ fontSize: 10, color: sel ? 'rgba(255,255,255,.75)' : C.textMuted }}>
                        {s.n + ' sellers' + (s.mc > 0 ? ' · ' + s.mc + ' MC' : '')}
                      </span>
                      <span style={{ fontSize: 10, color: sel ? 'rgba(255,255,255,.75)' : C.textMuted }}>{r.disp + ' disp.'}</span>
                    </div>
                    <MiniBar u={r.usados} t={r.total} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {open && variant === 'B' && (
        /* ═══ PROPUESTA B — BARRAS POR GERENCIA ═══ */
        <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {gerencias.map(({ g, rows: rs }) => {
            const gu = rs.reduce((a, r) => a + r.usados, 0);
            const gt = rs.reduce((a, r) => a + r.total, 0);
            const gn = rs.reduce((a, r) => a + st(r).n, 0);
            return (
              <div key={g} style={{ border: '1px solid ' + C.borderLight, borderRadius: 8, padding: '10px 12px', background: C.bgCard }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.4px' }}>{g}</span>
                  <span style={{ fontSize: 10, color: C.textMuted }}>{gn + ' sellers · '}<b style={{ color: ratioColor(gu, gt) }}>{gu + '/' + gt}</b></span>
                </div>
                {rs.map((r) => {
                  const s = st(r);
                  const sel = selectedKam === r.kam;
                  return (
                    <div
                      key={r.id}
                      onClick={() => toggleKam(r.kam)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, cursor: 'pointer',
                        background: sel ? C.primaryBg : 'transparent',
                        outline: sel ? '1px solid ' + C.primary : 'none',
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: sel ? 800 : 600, color: C.text, minWidth: 96, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {r.kam}
                      </span>
                      <div style={{ flex: 1 }}>
                        <MiniBar u={r.usados} t={r.total} />
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 700, color: ratioColor(r.usados, r.total), minWidth: 34, textAlign: 'right' }}>
                        {r.usados + '/' + r.total}
                      </span>
                      <span style={{ fontSize: 10, color: C.textMuted, minWidth: 46, textAlign: 'right' }}>{s.n + ' sell.'}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {open && variant === 'C' && (
        /* ═══ PROPUESTA C — TABLA DENSA ═══ */
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid ' + C.border }}>
                {['Gerencia', 'KAM', 'Sellers activos', 'Multicuenta', 'Cupos', 'Disp.', 'Ocupación'].map((h, i) => (
                  <th key={h} style={{ padding: '7px 12px', textAlign: i >= 2 ? (i === 6 ? 'left' : 'right') : 'left', fontWeight: 700, fontSize: 10, color: C.textMuted, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gerencias.flatMap(({ g, rows: rs }) =>
                rs.map((r, i) => {
                  const s = st(r);
                  const sel = selectedKam === r.kam;
                  return (
                    <tr
                      key={r.id}
                      className="row-hover"
                      onClick={() => toggleKam(r.kam)}
                      style={{ borderBottom: '1px solid ' + C.borderLight, cursor: 'pointer', background: sel ? C.primaryBg : undefined }}
                    >
                      <td style={{ padding: '7px 12px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
                        {i === 0 ? g : ''}
                      </td>
                      <td style={{ padding: '7px 12px', fontWeight: sel ? 800 : 600 }}>{r.kam}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <b>{s.n}</b>
                        <span style={{ fontSize: 10, color: C.textMuted }}>
                          {'  (' + s.full + 'F · ' + s.prem + 'P · ' + s.bas + 'B)'}
                        </span>
                      </td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: 11, color: s.mc > 0 ? C.brandDark : C.textMuted, fontWeight: s.mc > 0 ? 700 : 400 }}>
                        {s.mc > 0 ? s.mc : '—'}
                      </td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800, color: ratioColor(r.usados, r.total) }}>
                        {r.usados + ' / ' + r.total}
                      </td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', color: r.disp === 0 ? C.danger : C.textSec, fontWeight: 700 }}>{r.disp}</td>
                      <td style={{ padding: '7px 12px', minWidth: 120 }}>
                        <MiniBar u={r.usados} t={r.total} />
                      </td>
                    </tr>
                  );
                })
              )}
              <tr style={{ background: C.primaryBg, borderTop: '2px solid ' + C.primary }}>
                <td colSpan={2} style={{ padding: '7px 12px', fontWeight: 800, color: C.primaryDark }}>TOTAL</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800 }}>{glob.n}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 700, color: C.brandDark }}>{glob.mcN || '—'}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800, color: ratioColor(glob.u, glob.t) }}>{glob.u + ' / ' + glob.t}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 800 }}>{Math.max(0, glob.t - glob.u)}</td>
                <td style={{ padding: '7px 12px' }}><MiniBar u={glob.u} t={glob.t} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
