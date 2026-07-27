/* ════════════════════════════════════════════════════════════════════════════
   PANEL DE CUPOS — version final (propuesta C elegida)
   Tabla densa en la hoja Cobros: cupos REALES por KAM (individuales 1 = 1 +
   multicuentas pareadas por KAM) junto a la dotacion de sellers de cada uno.
   Premium/Basico no llevan KAM ni ocupan cupo. Click en una fila filtra la
   tabla de sellers de abajo (click de nuevo, o "Todos", limpia el filtro).
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
};

const ratioColor = (u: number, t: number) => {
  if (t <= 0) return C.textMuted;
  const r = u / t;
  if (r >= 1) return C.danger;
  if (r >= 0.85) return C.warning;
  return C.primary;
};

const MiniBar = ({ u, t }: { u: number; t: number }) => (
  <div style={{ width: '100%', height: 5, background: C.bgDark, borderRadius: 3, overflow: 'hidden' }}>
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

export default function CuposPanel({ rows, sellers, mcSids, selectedKam, onSelectKam }: Props) {
  const [open, setOpen] = useState(true);

  /* Dotacion por (kam|gerencia): sellers sin Fuga, con desglose por plan y
     cuantos de ellos son multicuenta. */
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
            individuales 1 = 1 cupo · multicuentas pareadas por KAM (2 = 1) · Premium/Básico no ocupan cupo · click en un KAM filtra la tabla
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: ratioColor(glob.u, glob.t), lineHeight: 1 }}>
            {glob.u + ' / ' + glob.t}
            <span style={{ fontSize: 10, fontWeight: 600, color: C.textMuted }}> cupos</span>
          </div>
          <div style={{ fontSize: 10, color: C.textMuted }}>
            {glob.n + ' sellers activos' + (glob.mcN > 0 ? ' · ' + glob.mcN + ' MC' : '')}
          </div>
        </div>
      </div>

      {open && (
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
