/* ════════════════════════════════════════════════════════════════════════════
   ADMIN › MULTICUENTAS
   Administra las condiciones comerciales de cada holding ya creado.

   Regla de negocio: al crear un holding se CONGELAN las condiciones vigentes
   (snapshot en sellers.pricing_override de la cuenta principal). Cambiar la
   escalera general en "Reglas generales" NO afecta a los holdings congelados
   — que es justamente lo que se acordo con cada seller.
   Desde aqui se puede: editar las condiciones de un holding puntual,
   actualizarlo a las reglas vigentes, o soltarlo para que siga las generales.
   ════════════════════════════════════════════════════════════════════════════ */
import { useMemo, useState } from 'react';
import { C, fmtFull } from './theme';
import { updateSellerFields } from './api';
import {
  getPctForPosition,
  toPricingOverride,
  type McResult,
  type PricingConfig,
} from './lib/multicuenta';

type Props = {
  mc: McResult;
  globalCfg: PricingConfig;
  userEmail: string;
  show: (msg: string, ok?: boolean) => void;
  refreshAll: () => Promise<any>;
};

const CUR_MONTH = new Date().getMonth();
const CUR_YEAR = new Date().getFullYear();

const escaleraTxt = (c: PricingConfig) =>
  c.pctPos.map((p) => p + '%').join(' · ') + ' · ' + c.pctPos6Plus + '%';

export default function HoldingsAdmin({ mc, globalCfg, userEmail, show, refreshAll }: Props) {
  const [openSid, setOpenSid] = useState<string>('');
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  const holdings = useMemo(
    () =>
      mc.principales.map((p) => {
        const cfg = mc.cfgOf.get(p.sid) || globalCfg;
        const cluster = mc.clusterOf.get(p.sid) || [];
        const activas = cluster.filter((m) => m.status === 'Iniciado');
        let cobroMes = 0;
        activas.forEach((_, i) => {
          cobroMes += Math.round((cfg.tarifaBase * getPctForPosition(i, cfg)) / 100);
        });
        return { p, cfg, cluster, activas: activas.length, cobroMes, congelado: mc.congelados.has(p.sid) };
      }),
    [mc, globalCfg]
  );

  const draftOf = (sid: string, cfg: PricingConfig) =>
    draft[sid] || [...cfg.pctPos.map(String), String(cfg.pctPos6Plus), String(cfg.tarifaBase), String(cfg.cupoDivisor)];

  const setDraftVal = (sid: string, cfg: PricingConfig, idx: number, v: string) =>
    setDraft((d) => {
      const arr = [...draftOf(sid, cfg)];
      arr[idx] = v;
      return { ...d, [sid]: arr };
    });

  const run = async (p: PromiseLike<any>, msg: string) => {
    setBusy(true);
    const res: any = await p;
    setBusy(false);
    if (res?.error) return show(res.error.message || 'Error', false);
    await refreshAll();
    show(msg);
  };

  const guardar = (sid: string, nombre: string, cfg: PricingConfig) => {
    const a = draftOf(sid, cfg).map(Number);
    if (a.slice(0, 6).some((n) => isNaN(n) || n < 0 || n > 100)) return show('Los % deben estar entre 0 y 100', false);
    if (isNaN(a[6]) || a[6] < 0) return show('Tarifa base inválida', false);
    if (isNaN(a[7]) || a[7] < 1) return show('El divisor de cupos debe ser 1 o mayor', false);
    const nueva: PricingConfig = {
      tarifaBase: a[6],
      pctPos: [a[0], a[1], a[2], a[3], a[4]] as PricingConfig['pctPos'],
      pctPos6Plus: a[5],
      cupoDivisor: a[7],
      updatedAt: '',
      updatedBy: '',
    };
    run(
      updateSellerFields(sid, { pricing_override: toPricingOverride(nueva, userEmail) }),
      'Condiciones de "' + nombre + '" actualizadas'
    );
    setDraft((d) => { const n = { ...d }; delete n[sid]; return n; });
  };

  const actualizarAVigentes = (sid: string, nombre: string) => {
    if (!window.confirm('Aplicar las reglas generales vigentes a "' + nombre + '"? Sus condiciones actuales se reemplazan.')) return;
    run(
      updateSellerFields(sid, { pricing_override: toPricingOverride(globalCfg, userEmail) }),
      '"' + nombre + '" quedó con las condiciones vigentes'
    );
    setDraft((d) => { const n = { ...d }; delete n[sid]; return n; });
  };

  const seguirGenerales = (sid: string, nombre: string) => {
    if (!window.confirm('"' + nombre + '" pasará a seguir las reglas generales. Cada cambio futuro en Admin lo va a afectar. ¿Continuar?')) return;
    run(updateSellerFields(sid, { pricing_override: null }), '"' + nombre + '" ahora sigue las reglas generales');
    setDraft((d) => { const n = { ...d }; delete n[sid]; return n; });
  };

  const congelar = (sid: string, nombre: string) => {
    run(
      updateSellerFields(sid, { pricing_override: toPricingOverride(globalCfg, userEmail) }),
      'Condiciones de "' + nombre + '" congeladas'
    );
  };

  const th = { padding: '8px 12px', fontWeight: 700 as const, fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const, whiteSpace: 'nowrap' as const };
  const POS_LBL = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª+'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: '12px 16px', borderLeft: '4px solid ' + C.brand }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Condiciones por holding</div>
        <p style={{ margin: '3px 0 0', fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
          Cada holding guarda las condiciones que se pactaron cuando se creó. Cambiar la escalera en
          <b> Reglas generales</b> no altera a los holdings congelados: solo aplica a los nuevos y a los que
          hayas dejado siguiendo las reglas generales.
        </p>
      </div>

      {holdings.length === 0 && (
        <div className="card" style={{ padding: 28, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
          Todavía no hay holdings. Se crean marcando <b>Multicuenta</b> al agregar un seller en Cobros.
        </div>
      )}

      {holdings.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 860 }}>
              <thead>
                <tr style={{ background: C.bgAlt, borderBottom: '2px solid ' + C.border }}>
                  <th style={{ ...th, textAlign: 'left' }}>Holding (cuenta principal)</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cuentas</th>
                  <th style={{ ...th, textAlign: 'left' }}>Condiciones</th>
                  <th style={{ ...th, textAlign: 'right' }}>Tarifa base</th>
                  <th style={{ ...th, textAlign: 'left' }}>Escalera</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cobro del mes</th>
                  <th style={{ ...th }} />
                </tr>
              </thead>
              <tbody>
                {holdings.flatMap((h) => {
                  const abierto = openSid === h.p.sid;
                  const d = draftOf(h.p.sid, h.cfg);
                  const rows = [
                    <tr
                      key={h.p.sid}
                      className="row-hover"
                      style={{ borderBottom: '1px solid ' + C.borderLight, cursor: 'pointer', background: abierto ? C.primaryBg : undefined }}
                      onClick={() => setOpenSid(abierto ? '' : h.p.sid)}
                    >
                      <td style={{ padding: '9px 12px' }}>
                        <div style={{ fontWeight: 700 }}>{h.p.seller}</div>
                        <div style={{ fontSize: 10, color: C.textMuted }}>{h.p.sid + ' · ' + h.p.sec + ' · ' + h.p.kam}</div>
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>
                        {h.activas}
                        <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 500 }}>{' / ' + h.cluster.length}</span>
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        {h.congelado ? (
                          <span title={'Congeladas el ' + (h.cfg.updatedAt || '—') + (h.cfg.updatedBy ? ' por ' + h.cfg.updatedBy : '')}
                            style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 9.5, fontWeight: 800, background: C.brandDark + '18', color: C.brandDark, whiteSpace: 'nowrap' }}>
                            {'🔒 Pactadas' + (h.cfg.updatedAt ? ' · ' + h.cfg.updatedAt : '')}
                          </span>
                        ) : (
                          <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 20, fontSize: 9.5, fontWeight: 800, background: C.tertiary + '18', color: C.tertiary, whiteSpace: 'nowrap' }}>
                            Reglas generales
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtFull(h.cfg.tarifaBase)}</td>
                      <td style={{ padding: '9px 12px', fontSize: 10.5, color: C.textSec, whiteSpace: 'nowrap' }}>{escaleraTxt(h.cfg)}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 800, color: C.primaryDark }}>{fmtFull(h.cobroMes)}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap' }}>
                        {abierto ? 'cerrar ▲' : 'editar ▼'}
                      </td>
                    </tr>,
                  ];

                  if (abierto) {
                    rows.push(
                      <tr key={h.p.sid + '-edit'} style={{ borderBottom: '2px solid ' + C.border, background: C.bgAlt }}>
                        <td colSpan={7} style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
                            <div style={{ flex: '0 0 150px' }}>
                              <label style={{ fontSize: 9.5, color: C.textMuted, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                                Tarifa base
                              </label>
                              <input type="number" min={0} value={d[6]} onChange={(e) => setDraftVal(h.p.sid, h.cfg, 6, e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
                            </div>
                            {POS_LBL.map((lbl, i) => (
                              <div key={lbl} style={{ flex: '0 0 74px' }}>
                                <label style={{ fontSize: 9.5, color: C.textMuted, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                                  {lbl}
                                </label>
                                <input type="number" min={0} max={100} value={d[i]} onChange={(e) => setDraftVal(h.p.sid, h.cfg, i, e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
                                <div style={{ fontSize: 9.5, color: C.textMuted, marginTop: 3, textAlign: 'center' }}>
                                  {fmtFull(Math.round((Number(d[6]) || 0) * (Number(d[i]) || 0) / 100))}
                                </div>
                              </div>
                            ))}
                            <div style={{ flex: '0 0 100px' }}>
                              <label style={{ fontSize: 9.5, color: C.textMuted, fontWeight: 700, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
                                Cts./cupo
                              </label>
                              <input type="number" min={1} value={d[7]} onChange={(e) => setDraftVal(h.p.sid, h.cfg, 7, e.target.value)} style={{ width: '100%', boxSizing: 'border-box' }} />
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'center' }}>
                            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => guardar(h.p.sid, h.p.seller, h.cfg)}>
                              Guardar condiciones
                            </button>
                            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => actualizarAVigentes(h.p.sid, h.p.seller)}>
                              Igualar a reglas vigentes
                            </button>
                            {h.congelado ? (
                              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => seguirGenerales(h.p.sid, h.p.seller)}>
                                Seguir reglas generales
                              </button>
                            ) : (
                              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => congelar(h.p.sid, h.p.seller)}>
                                🔒 Congelar condiciones actuales
                              </button>
                            )}
                            <span style={{ fontSize: 10, color: C.textMuted, flex: '1 1 200px' }}>
                              {h.congelado
                                ? 'Este holding no se ve afectado por cambios en las reglas generales.'
                                : 'Atención: hoy sigue las reglas generales, así que cualquier cambio en Admin lo afecta.'}
                            </span>
                          </div>

                          {/* Cuentas del holding con su posicion y monto */}
                          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {h.cluster.map((m) => {
                              const info = mc.bySid.get(m.sid);
                              const activa = m.status === 'Iniciado';
                              return (
                                <span
                                  key={m.sid}
                                  title={m.sid + ' · ' + m.kam + ' · ' + m.status}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '3px 10px',
                                    borderRadius: 20,
                                    fontSize: 10.5,
                                    background: activa ? C.bgCard : 'transparent',
                                    border: '1px solid ' + (activa ? C.border : C.borderLight),
                                    color: activa ? C.text : C.textMuted,
                                  }}
                                >
                                  <b>{info && info.pos ? info.pos + 'ª' : '—'}</b>
                                  {m.seller}
                                  <span style={{ color: C.textMuted }}>
                                    {info && info.pct != null
                                      ? info.pct + '% · ' + fmtFull(Math.round((h.cfg.tarifaBase * info.pct) / 100))
                                      : m.status}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '8px 14px', fontSize: 10, color: C.textMuted, borderTop: '1px solid ' + C.borderLight }}>
            {'Cobro del mes = suma de la escalera sobre las cuentas activas · ' +
              new Date(CUR_YEAR, CUR_MONTH).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })}
          </div>
        </div>
      )}
    </div>
  );
}
