/* ════════════════════════════════════════════════════════════════════════════
   TAB GRUPOS — Gestion de multicuentas
   · Crear/editar/eliminar grupos; vincular/desvincular cuentas existentes.
   · Designar cuenta principal; asignar KAM y status por cuenta (escribe en
     sellers via updateSellerFields — misma fuente de verdad que el resto).
   · Escalera en vivo (posicion → % → monto), cupos por KAM y flag de
     "principal temporal" cuando aplica la sucesion automatica.
   Todo el calculo viene de src/lib/groupCalc.ts (funciones puras).
   ════════════════════════════════════════════════════════════════════════════ */
import { useMemo, useState, type ReactNode } from 'react';
import { C, fmt, fmtFull, fmtPct } from './theme';
import {
  insertGroup,
  updateGroup,
  deleteGroupDB,
  addGroupMember,
  updateGroupMember,
  removeGroupMember,
  updateSellerFields,
} from './api';
import {
  ACTIVE_SELLER_STATUS,
  MESES_CORTOS,
  getGroupPricing,
  getGroupCupos,
  type GroupRow,
  type GroupMemberRow,
  type MemberSeller,
  type PricingConfig,
  type SellerLike,
} from './lib/groupCalc';

const HOY = () => new Date().toISOString().slice(0, 10);
const CUR_YEAR = new Date().getFullYear();
const CUR_MONTH = new Date().getMonth();
const STATUS_OPTS = ['Iniciado', 'Pausa', 'Fuga'];

const stColor = (s: string) =>
  s === 'Fuga' ? C.danger : s === 'Pausa' ? C.warning : C.primary;

const MiniPill = (p: { color: string; children: ReactNode; title?: string }) => (
  <span
    title={p.title}
    style={{
      padding: '2px 9px',
      borderRadius: 20,
      fontSize: 10,
      fontWeight: 700,
      display: 'inline-block',
      background: p.color + '18',
      color: p.color,
      whiteSpace: 'nowrap',
    }}
  >
    {p.children}
  </span>
);

type Props = {
  sellers: SellerLike[];
  groups: GroupRow[];
  members: GroupMemberRow[];
  cfg: PricingConfig;
  kamOptions: string[];
  userEmail: string;
  show: (msg: string, ok?: boolean) => void;
  refreshAll: () => Promise<any>;
};

export default function GroupsTab(props: Props) {
  const { sellers, groups, members, cfg, kamOptions, userEmail, show, refreshAll } = props;

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<GroupRow | null>(null);
  const [gForm, setGForm] = useState({ nombre: '', rut: '' });
  const [addForm, setAddForm] = useState<Record<string, { sid: string; fecha: string; validadoPor: string }>>({});

  /* ── Join grupo → cuentas (con la fila de seller viva) ─────────────────── */
  const joined = useMemo(() => {
    const bySid = new Map(sellers.map((s) => [s.sid, s]));
    return groups.map((g) => ({
      group: g,
      members: members
        .filter((m) => m.groupId === g.id)
        .flatMap((m): MemberSeller[] => {
          const seller = bySid.get(m.sellerSid);
          return seller ? [{ member: m, seller }] : [];
        }),
    }));
  }, [groups, members, sellers]);

  const sidsEnGrupo = useMemo(() => new Set(members.map((m) => m.sellerSid)), [members]);
  const sellersSinGrupo = useMemo(
    () =>
      sellers
        .filter((s) => !sidsEnGrupo.has(s.sid))
        .slice()
        .sort((a, b) => a.seller.localeCompare(b.seller)),
    [sellers, sidsEnGrupo]
  );

  /* ── KPIs de la pestaña ────────────────────────────────────────────────── */
  const kpis = useMemo(() => {
    const activos = joined.filter((j) => j.group.estado === 'Activo');
    let cobroMes = 0;
    let cupos = 0;
    activos.forEach((j) => {
      cobroMes += getGroupPricing(j.members, j.group.cuentaPrincipalSid, cfg, CUR_MONTH, CUR_YEAR).totalMes;
      cupos += getGroupCupos(j.members, cfg.cupoDivisor).total;
    });
    return {
      grupos: activos.length,
      cuentas: activos.reduce((s, j) => s + j.members.length, 0),
      cobroMes,
      cupos,
    };
  }, [joined, cfg]);

  /* ── Helpers de accion (api → refresh → toast) ─────────────────────────── */
  const run = async (p: PromiseLike<any>, okMsg: string) => {
    const res: any = await p;
    if (res?.error) {
      show(res.error.message || 'Error', false);
      return false;
    }
    await refreshAll();
    show(okMsg);
    return true;
  };

  const saveGroup = async () => {
    const nombre = gForm.nombre.trim();
    if (!nombre) return show('Ingresa el nombre del grupo', false);
    if (editing) {
      const ok = await run(
        updateGroup(editing.id, { nombre_grupo: nombre, rut_principal: gForm.rut.trim() || null }),
        'Grupo actualizado'
      );
      if (ok) setEditing(null);
    } else {
      const ok = await run(
        insertGroup({ nombre_grupo: nombre, rut_principal: gForm.rut.trim() || null, estado: 'Activo' }),
        'Grupo "' + nombre + '" creado'
      );
      if (ok) setCreating(false);
    }
    setGForm({ nombre: '', rut: '' });
  };

  const linkMember = async (groupId: string) => {
    const f = addForm[groupId];
    if (!f?.sid) return show('Selecciona una cuenta para vincular', false);
    const ok = await run(
      addGroupMember({
        group_id: groupId,
        seller_sid: f.sid,
        fecha_vinculacion: f.fecha || HOY(),
        validado_por: f.validadoPor.trim() || null,
        fecha_validacion: f.validadoPor.trim() ? HOY() : null,
      }),
      'Cuenta vinculada'
    );
    if (ok) setAddForm((p) => ({ ...p, [groupId]: { sid: '', fecha: HOY(), validadoPor: userEmail } }));
  };

  const unlink = (groupId: string, l: { sid: string; seller: string }) => {
    if (!window.confirm('¿Desvincular "' + l.seller + '" del grupo? La escalera y los cupos se recalculan solos.'))
      return;
    run(removeGroupMember(groupId, l.sid), l.seller + ' desvinculado');
  };

  const setPrincipal = (g: GroupRow, sid: string) =>
    run(updateGroup(g.id, { cuenta_principal_sid: sid }), 'Cuenta principal designada');

  const changeKam = (sid: string, kam: string) =>
    run(updateSellerFields(sid, { kam }), 'KAM actualizado');

  const changeStatus = (sid: string, seller: string, status: string) => {
    if (status === 'Fuga') {
      if (!window.confirm('Marcar "' + seller + '" como Fuga? Sale de la escalera y libera cupo.')) return;
      const ft = window.prompt('Fecha de término (YYYY-MM-DD, opcional — Enter para omitir):', HOY());
      return run(
        updateSellerFields(sid, { status, f_termino: ft && ft.trim() ? ft.trim() : null }),
        seller + ' → Fuga'
      );
    }
    run(updateSellerFields(sid, { status }), seller + ' → ' + status);
  };

  const changeFecha = (groupId: string, sid: string, fecha: string) => {
    if (!fecha) return;
    run(updateGroupMember(groupId, sid, { fecha_vinculacion: fecha }), 'Fecha de vinculación actualizada');
  };

  const markValidado = (groupId: string, sid: string) =>
    run(
      updateGroupMember(groupId, sid, { validado_por: userEmail, fecha_validacion: HOY() }),
      'Vínculo validado'
    );

  const toggleEstado = (g: GroupRow) =>
    run(
      updateGroup(g.id, { estado: g.estado === 'Activo' ? 'Inactivo' : 'Activo' }),
      g.estado === 'Activo' ? 'Grupo inactivado (sale de cobros y cupos)' : 'Grupo reactivado'
    );

  const removeGroup = (g: GroupRow, n: number) => {
    if (
      !window.confirm(
        'Eliminar el grupo "' + g.nombre + '"' + (n > 0 ? ' y desvincular sus ' + n + ' cuentas' : '') +
          '? Las cuentas NO se eliminan, solo el vínculo.'
      )
    )
      return;
    run(deleteGroupDB(g.id), 'Grupo eliminado');
  };

  const mesLabel = MESES_CORTOS[CUR_MONTH] + ' ' + CUR_YEAR;

  /* ════════════════════════ RENDER ════════════════════════ */
  return (
    <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* KPIs */}
      <div className="kpi-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Grupos activos', value: String(kpis.grupos), color: C.brandDark },
          { label: 'Cuentas vinculadas', value: String(kpis.cuentas), color: C.tertiary },
          { label: 'Cobro grupos · ' + mesLabel, value: fmt(kpis.cobroMes), color: C.primary },
          { label: 'Cupos ocupados por grupos', value: String(kpis.cupos), color: C.purple },
        ].map((k) => (
          <div
            key={k.label}
            style={{
              background: C.bgCard,
              borderRadius: 8,
              padding: '16px 18px',
              flex: '1 1 150px',
              minWidth: 140,
              borderLeft: '4px solid ' + k.color,
              border: '1px solid ' + C.borderLight,
              borderLeftWidth: 4,
              borderLeftColor: k.color,
              boxShadow: '0 1px 3px rgba(10,10,10,.05)',
            }}
          >
            <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700, marginBottom: 6 }}>
              {k.label}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Barra de acciones + form crear/editar */}
      <div className="card" style={{ padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Grupos multicuenta</div>
          <div style={{ fontSize: 11, color: C.textMuted }}>
            Una membresía por grupo · escalera por posición sobre cuentas activas · posición derivada en tiempo real
          </div>
        </div>
        {!creating && !editing && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setGForm({ nombre: '', rut: '' });
              setCreating(true);
            }}
          >
            + Crear grupo
          </button>
        )}
        {(creating || editing) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              placeholder="Nombre del grupo"
              value={gForm.nombre}
              onChange={(e) => setGForm((p) => ({ ...p, nombre: e.target.value }))}
              style={{ minWidth: 180 }}
            />
            <input
              placeholder="RUT principal (opcional)"
              value={gForm.rut}
              onChange={(e) => setGForm((p) => ({ ...p, rut: e.target.value }))}
              style={{ minWidth: 150 }}
            />
            <button className="btn btn-primary btn-sm" onClick={saveGroup}>
              {editing ? 'Guardar' : 'Crear'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setCreating(false);
                setEditing(null);
                setGForm({ nombre: '', rut: '' });
              }}
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {joined.length === 0 && (
        <div className="card" style={{ padding: 28, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
          Aún no hay grupos. Crea el primero y vincula las cuentas del mismo dueño — la validación de RUT es un
          paso manual tuyo; aquí solo queda registrado quién validó y cuándo.
        </div>
      )}

      {/* ── Cards por grupo ─────────────────────────────────────────────── */}
      {joined.map(({ group: g, members: ms }) => {
        const pricing = getGroupPricing(ms, g.cuentaPrincipalSid, cfg, CUR_MONTH, CUR_YEAR);
        const cupos = getGroupCupos(ms, cfg.cupoDivisor);
        const isOpen = !!expanded[g.id];
        const inactivo = g.estado !== 'Activo';
        const principalTemporal = pricing.sucesionActiva
          ? pricing.lines.find((l) => l.esPrincipalEfectiva)
          : null;
        const designada = ms.find((m) => m.seller.sid === g.cuentaPrincipalSid)?.seller;
        const af = addForm[g.id] || { sid: '', fecha: HOY(), validadoPor: userEmail };

        return (
          <div key={g.id} className="card" style={{ overflow: 'hidden', opacity: inactivo ? 0.72 : 1 }}>
            {/* Header del grupo */}
            <div
              className="row-hover"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                alignItems: 'center',
                padding: '12px 16px',
                cursor: 'pointer',
                background: C.bgAlt,
                borderBottom: isOpen ? '1px solid ' + C.border : 'none',
                borderLeft: '4px solid ' + (inactivo ? C.textMuted : C.brand),
              }}
              onClick={() => setExpanded((p) => ({ ...p, [g.id]: !p[g.id] }))}
            >
              <span
                style={{
                  fontSize: 10,
                  color: C.textMuted,
                  transition: 'transform .2s',
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                }}
              >
                ▶
              </span>
              <div style={{ flex: '1 1 220px', minWidth: 180 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{g.nombre}</span>
                  {g.rutPrincipal && (
                    <span style={{ fontSize: 11, color: C.textMuted }}>RUT {g.rutPrincipal}</span>
                  )}
                  <MiniPill color={inactivo ? C.textMuted : C.primary}>{g.estado}</MiniPill>
                  <MiniPill color={C.brandDark}>
                    {pricing.activas + ' activa' + (pricing.activas === 1 ? '' : 's') + ' / ' + ms.length}
                  </MiniPill>
                </div>
                {principalTemporal && (
                  <div
                    style={{
                      marginTop: 6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: C.warningLight,
                      border: '1px solid ' + C.warning,
                      color: '#7A5C00',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 10px',
                      borderRadius: 6,
                    }}
                  >
                    ⚠ Principal temporal: {principalTemporal.seller}
                    <span style={{ fontWeight: 500 }}>
                      — la principal designada{designada ? ' (' + designada.seller + ')' : ''} está en{' '}
                      {designada?.status || 'Pausa/Fuga'}
                    </span>
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', fontWeight: 700 }}>
                  Cobro {mesLabel}
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: C.primaryDark }}>{fmtFull(pricing.totalMes)}</div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 70 }}>
                <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', fontWeight: 700 }}>Cupos</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: C.purple }}>{cupos.total}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <span
                  className="action-icon"
                  title="Editar nombre / RUT"
                  onClick={() => {
                    setCreating(false);
                    setEditing(g);
                    setGForm({ nombre: g.nombre, rut: g.rutPrincipal });
                  }}
                >
                  ✎
                </span>
                <span
                  className="action-icon"
                  title={inactivo ? 'Reactivar grupo' : 'Inactivar grupo (sale de cobros y cupos)'}
                  onClick={() => toggleEstado(g)}
                >
                  {inactivo ? '▶' : '⏸'}
                </span>
                <span className="action-icon del-icon" title="Eliminar grupo" onClick={() => removeGroup(g, ms.length)}>
                  ×
                </span>
              </div>
            </div>

            {/* Detalle expandido */}
            {isOpen && (
              <div style={{ padding: '0 0 12px' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
                    <thead>
                      <tr style={{ background: C.bgCard, borderBottom: '2px solid ' + C.border }}>
                        {['Pos', 'Cuenta', 'KAM', 'Status', '%', 'Monto ' + mesLabel, 'F. vinculación', 'Validación', 'Principal', ''].map(
                          (h) => (
                            <th
                              key={h}
                              style={{
                                padding: '8px 10px',
                                textAlign: h === '%' || h.startsWith('Monto') ? 'right' : 'left',
                                fontWeight: 700,
                                fontSize: 10,
                                color: C.textMuted,
                                textTransform: 'uppercase',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {pricing.lines.map((l) => (
                        <tr
                          key={l.sid}
                          className="row-hover"
                          style={{
                            borderBottom: '1px solid ' + C.borderLight,
                            opacity: l.activa ? 1 : 0.62,
                            background: l.esPrincipalEfectiva ? C.primaryBg : undefined,
                          }}
                        >
                          <td style={{ padding: '8px 10px', fontWeight: 800, color: l.posicion === 1 ? C.brandDark : C.textSec }}>
                            {l.posicion ? l.posicion + 'ª' : '—'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{l.seller}</div>
                            <div style={{ fontSize: 10, color: C.textMuted }}>{l.sid + ' · ' + l.tipo}</div>
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <select
                              value={l.kam}
                              onChange={(e) => changeKam(l.sid, e.target.value)}
                              style={{ padding: '4px 8px', fontSize: 11, minWidth: 130 }}
                            >
                              {!kamOptions.includes(l.kam) && <option value={l.kam}>{l.kam}</option>}
                              {kamOptions.map((k) => (
                                <option key={k} value={k}>
                                  {k}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <select
                              value={l.status}
                              onChange={(e) => changeStatus(l.sid, l.seller, e.target.value)}
                              style={{
                                padding: '4px 8px',
                                fontSize: 11,
                                fontWeight: 700,
                                color: stColor(l.status),
                                borderColor: stColor(l.status),
                              }}
                            >
                              {STATUS_OPTS.map((s) => (
                                <option key={s} value={s}>
                                  {s === ACTIVE_SELLER_STATUS ? 'Activo (Iniciado)' : s}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: C.textSec }}>
                            {l.pct != null ? fmtPct(l.pct) : '—'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: l.monto > 0 ? C.primaryDark : C.textMuted }}>
                            {l.activa ? fmtFull(l.monto) : '—'}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <input
                              type="date"
                              value={l.fechaVinculacion || ''}
                              onChange={(e) => changeFecha(g.id, l.sid, e.target.value)}
                              style={{ padding: '4px 6px', fontSize: 11 }}
                            />
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: 11 }}>
                            {l.validadoPor ? (
                              <span style={{ color: C.primaryDark, fontWeight: 600 }} title={'Validado el ' + (l.fechaValidacion || '—')}>
                                ✓ {l.validadoPor.split('@')[0]}
                              </span>
                            ) : (
                              <button className="btn btn-ghost btn-sm" onClick={() => markValidado(g.id, l.sid)}>
                                Marcar validado
                              </button>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            {l.esPrincipalDesignada ? (
                              <span title="Cuenta principal designada" style={{ color: C.brandDark, fontWeight: 800, fontSize: 14 }}>
                                ★
                              </span>
                            ) : (
                              <button
                                className="btn btn-ghost btn-sm"
                                title="Designar como principal (paga el 100%)"
                                onClick={() => setPrincipal(g, l.sid)}
                              >
                                ☆
                              </button>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                            <span className="action-icon del-icon" title="Desvincular del grupo" onClick={() => unlink(g.id, l)}>
                              ×
                            </span>
                          </td>
                        </tr>
                      ))}
                      {pricing.lines.length === 0 && (
                        <tr>
                          <td colSpan={10} style={{ padding: 16, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
                            Sin cuentas vinculadas todavía.
                          </td>
                        </tr>
                      )}
                      {pricing.lines.length > 0 && (
                        <tr style={{ background: C.primaryBg, borderTop: '2px solid ' + C.primary }}>
                          <td colSpan={5} style={{ padding: '8px 10px', fontWeight: 800, color: C.primaryDark }}>
                            Total grupo · escalera sobre {pricing.activas} activa{pricing.activas === 1 ? '' : 's'}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: C.primaryDark }}>
                            {fmtFull(pricing.totalMes)}
                          </td>
                          <td colSpan={4} />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Cupos por KAM */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '10px 16px 0' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                    Cupos por KAM (Full activas · {cfg.cupoDivisor} cuentas = 1 cupo)
                  </span>
                  {cupos.porKam.length === 0 && <span style={{ fontSize: 11, color: C.textMuted }}>—</span>}
                  {cupos.porKam.map((k) => (
                    <MiniPill key={k.kam} color={C.purple} title={k.cuentas + ' cuentas → ceil(' + k.cuentas + '/' + cfg.cupoDivisor + ')'}>
                      {k.kam + ': ' + k.cuentas + ' → ' + k.cupos + ' cupo' + (k.cupos === 1 ? '' : 's')}
                    </MiniPill>
                  ))}
                  {cupos.porKam.length > 0 && (
                    <MiniPill color={C.text}>{'Total: ' + cupos.total}</MiniPill>
                  )}
                </div>

                {/* Vincular cuenta */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 8,
                    alignItems: 'center',
                    margin: '12px 16px 0',
                    padding: '10px 12px',
                    background: C.bgAlt,
                    borderRadius: 8,
                    border: '1px dashed ' + C.border,
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.textSec }}>Vincular cuenta:</span>
                  <select
                    value={af.sid}
                    onChange={(e) => setAddForm((p) => ({ ...p, [g.id]: { ...af, sid: e.target.value } }))}
                    style={{ minWidth: 220, fontSize: 12 }}
                  >
                    <option value="">Selecciona un seller sin grupo…</option>
                    {sellersSinGrupo.map((s) => (
                      <option key={s.sid} value={s.sid}>
                        {s.seller + ' · ' + s.sid + ' · ' + s.sec + ' · ' + s.kam}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={af.fecha}
                    onChange={(e) => setAddForm((p) => ({ ...p, [g.id]: { ...af, fecha: e.target.value } }))}
                    title="Fecha de vinculación (desde aquí arranca su cobro)"
                    style={{ fontSize: 12 }}
                  />
                  <input
                    placeholder="Validado por (opcional)"
                    value={af.validadoPor}
                    onChange={(e) => setAddForm((p) => ({ ...p, [g.id]: { ...af, validadoPor: e.target.value } }))}
                    style={{ minWidth: 170, fontSize: 12 }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={() => linkMember(g.id)}>
                    Vincular
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
