import {
  fetchProspects,
  fetchSellers,
  fetchCupos,
  upsertProspect,
  deleteProspectDB,
  updateProspectStatus,
  upsertSeller,
  deleteSellerDB,
  upsertCupo,
} from './api';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

/* ──────────────────────────────────────────────────────────────
   TYPES
────────────────────────────────────────────────────────────── */
type ProspectStage =
  | 'Prospectos'
  | 'Contactados'
  | 'Interesados'
  | 'No Interesado'
  | 'Cerrados';

type Prospect = {
  id: string;
  s: string;
  st: ProspectStage;
  t: string;
  c: string;
  n: string;
  m: string;
  tel: string;
  note: string;
};

type SellerStatus = 'Iniciado' | 'Pausa' | 'Fuga';
type SellerPlan = 'Full' | 'Premium';

type Seller = {
  sec: string;
  kam: string;
  seller: string;
  sid: string;
  cont: string;
  mail: string;
  status: SellerStatus;
  tipo: SellerPlan;
  tarifa: number;
  fContrato: string;
  fTermino: string;
  dcto: number;
  min: number;
};

type Cupo = {
  g: string;
  e: string;
  u: number;
  d: number;
};

type Modal = null | {
  type:
    | 'addProspect'
    | 'editProspect'
    | 'addSeller'
    | 'editSeller'
    | 'close'
    | 'editCupos';
  data?: any;
};

type Toast = null | { msg: string; ok: boolean };

/* ──────────────────────────────────────────────────────────────
   CONSTANTS
────────────────────────────────────────────────────────────── */
const STAGES: ProspectStage[] = [
  'Prospectos',
  'Contactados',
  'Interesados',
  'No Interesado',
  'Cerrados',
];

const ACTIVE_STAGES: ProspectStage[] = [
  'Prospectos',
  'Contactados',
  'Interesados',
];

const SC: Record<ProspectStage, string> = {
  Prospectos: '#6b7280',
  Contactados: '#3b82f6',
  Interesados: '#f59e0b',
  'No Interesado': '#ef4444',
  Cerrados: '#22c55e',
};

const CATS = [
  'Electro',
  'Muebles/Hogar',
  'Cat Dig',
  'Moda',
  'Belleza/Calzado',
] as const;

const CK: Record<(typeof CATS)[number], string> = {
  Electro: 'TBD - Electro',
  'Muebles/Hogar': 'TBD - Hogar',
  'Cat Dig': 'TRINI',
  Moda: 'Pacita',
  'Belleza/Calzado': 'Maca',
};

const SECS = [
  'TBD - Electro',
  'TBD - Hogar',
  'TRINI',
  'Pacita',
  'Maca',
  'PREMIUM',
] as const;

const fmt = (n: number) =>
  n >= 1e6
    ? `$${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
    ? `$${(n / 1e3).toFixed(0)}K`
    : `$${n}`;

const stC = (s: SellerStatus) =>
  s === 'Fuga'
    ? '#ef4444'
    : s === 'Pausa'
    ? '#f59e0b'
    : s === 'Iniciado'
    ? '#22c55e'
    : '#6b7280';

/* ──────────────────────────────────────────────────────────────
   MAPPERS (DB → UI)
────────────────────────────────────────────────────────────── */
const mapProspectRowToUI = (r: any): Prospect => ({
  id: r.id,
  s: r.seller,
  st: r.status,
  t: r.tipo,
  c: r.categoria,
  n: r.nombre ?? '',
  m: r.mail ?? '',
  tel: r.tel ?? '',
  note: r.note ?? '',
});

const mapSellerRowToUI = (r: any): Seller => ({
  sec: r.seccion,
  kam: r.kam ?? '-',
  seller: r.seller,
  sid: r.sid,
  cont: r.contacto ?? '',
  mail: r.mail ?? '',
  status: r.status,
  tipo: r.tipo,
  tarifa: Number(r.tarifa),
  fContrato: r.f_contrato ?? '',
  fTermino: r.f_termino ?? '',
  dcto: Number(r.dcto ?? 0),
  min: Number(r.min_meses ?? 0),
});

const mapCupoRowToUI = (r: any): Cupo => ({
  g: r.gerencia,
  e: r.encargado,
  u: Number(r.usados),
  d: Number(r.disponibles),
});

/* ──────────────────────────────────────────────────────────────
   APP
────────────────────────────────────────────────────────────── */
export default function App() {
  const [tab, setTab] = useState<'hunting' | 'sellers' | 'dashboard'>(
    'hunting'
  );

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [cupos, setCupos] = useState<Cupo[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);

  const [ready, setReady] = useState(false);

  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<Toast>(null);

  const [fCat, setFCat] = useState('Todos');
  const [fSt, setFSt] = useState('Todos');
  const [q, setQ] = useState('');

  const [selS, setSelS] = useState<Seller | null>(null);

  const [form, setForm] = useState<Record<string, any>>({});

  const show = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  /* ──────────────────────────────────────────────────────────────
     REFRESH (modo simple)
  ─────────────────────────────────────────────────────────────── */
  const refreshAll = async () => {
    const { data: pRows, error: pErr } = await fetchProspects();
    const { data: sRows, error: sErr } = await fetchSellers();
    const { data: cRows, error: cErr } = await fetchCupos();

    if (pErr) console.error('fetchProspects:', pErr);
    if (sErr) console.error('fetchSellers:', sErr);
    if (cErr) console.error('fetchCupos:', cErr);

    setProspects((pRows ?? []).map(mapProspectRowToUI));
    setSellers((sRows ?? []).map(mapSellerRowToUI));
    setCupos((cRows ?? []).map(mapCupoRowToUI));
  };

  useEffect(() => {
    (async () => {
      await refreshAll();
      setReady(true);
    })();
  }, []);

  /* ──────────────────────────────────────────────────────────────
     COMPUTED
  ─────────────────────────────────────────────────────────────── */
  const filt = useMemo(() => {
    return prospects.filter((p) => {
      if (fCat !== 'Todos' && p.c !== fCat) return false;
      if (fSt !== 'Todos' && p.st !== fSt) return false;
      if (q && !p.s.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [prospects, fCat, fSt, q]);

  const funnel = useMemo(() => {
    return STAGES.map((s) => ({
      name: s,
      count: prospects.filter((p) => p.st === s).length,
      fill: SC[s],
    }));
  }, [prospects]);

  const kpi = useMemo(() => {
    const act = sellers.filter((s) => s.status === 'Iniciado').length;
    const fug = sellers.filter((s) => s.status === 'Fuga').length;
    const pipe = prospects.filter((p) => ACTIVE_STAGES.includes(p.st)).length;
    const cerr = prospects.filter((p) => p.st === 'Cerrados').length;
    const noInt = prospects.filter((p) => p.st === 'No Interesado').length;
    const cupD = cupos.reduce((a, c) => a + c.d, 0);
    return { tot: sellers.length, act, fug, pipe, cerr, noInt, cupD };
  }, [sellers, prospects, cupos]);

  /* ──────────────────────────────────────────────────────────────
     ACTIONS (modo simple: DB → refetch → state)
  ─────────────────────────────────────────────────────────────── */

  const saveProspect = async (isNew: boolean) => {
    if (!form.id || !form.s || !form.c) {
      show('Completa ID, Seller y Categoría', false);
      return;
    }

    const row = {
      id: form.id,
      seller: form.s,
      status: isNew ? 'Prospectos' : form.st ?? 'Prospectos',
      tipo: form.t || 'Cartera',
      categoria: form.c,
      nombre: form.n || '',
      mail: form.m || '',
      tel: form.tel || '',
      note: form.note || '',
    };

    const { error } = await upsertProspect(row);
    if (error) {
      show(error.message, false);
      return;
    }

    await refreshAll();
    show(isNew ? 'Prospecto agregado' : 'Prospecto actualizado');
    setModal(null);
  };

  const deleteProspect = async (p: Prospect) => {
    if (!confirm(`Eliminar ${p.s}?`)) return;

    const { error } = await deleteProspectDB(p.id);
    if (error) {
      show(error.message, false);
      return;
    }

    await refreshAll();
    show(`${p.s} eliminado`);
  };

  const advance = async (p: Prospect, ns: ProspectStage) => {
    // Si va a cerrados, abrimos modal de cierre
    if (ns === 'Cerrados') {
      const cp = cupos.find((c) => c.g === p.c);
      if (cp && cp.d <= 0) {
        show(`Sin cupos en ${p.c}`, false);
        return;
      }
      setForm({
        plan: 'Full',
        tarifa: 990000,
        dcto: 2,
        min: 6,
        sec: (CK as any)[p.c] || 'TBD - Electro',
      });
      setModal({ type: 'close', data: p });
      return;
    }

    const { error } = await updateProspectStatus(p.id, ns);
    if (error) {
      show(error.message, false);
      return;
    }

    await refreshAll();
    show(`${p.s} → ${ns}`);
  };

  const confirmClose = async () => {
    const p: Prospect = modal?.data;

    if (!p) {
      show('Error: prospecto no encontrado', false);
      return;
    }

    // 1) prospect -> Cerrados
    const { error: e1 } = await updateProspectStatus(p.id, 'Cerrados');
    if (e1) {
      show(e1.message, false);
      return;
    }

    // 2) cupos (u + 1, d - 1)
    const cp = cupos.find((c) => c.g === p.c);
    if (!cp || cp.d <= 0) {
      show(`Sin cupos en ${p.c}`, false);
      return;
    }

    const { error: e2 } = await upsertCupo({
      gerencia: cp.g,
      encargado: cp.e,
      usados: cp.u + 1,
      disponibles: Math.max(0, cp.d - 1),
    });

    if (e2) {
      show(e2.message, false);
      return;
    }

    // 3) crear seller en tabla sellers
    const sellerRow = {
      sid: p.id,
      seller: p.s,
      seccion: form.sec || (CK as any)[p.c] || 'TBD - Electro',
      kam: (CK as any)[p.c] || '-',
      contacto: p.n || '',
      mail: p.m || '',
      status: 'Iniciado',
      tipo: form.plan || 'Full',
      tarifa: Number(form.tarifa) || 990000,
      f_contrato: new Date().toISOString().slice(0, 10),
      f_termino: null,
      dcto: Number(form.dcto) || 2,
      min_meses: Number(form.min) || 6,
    };

    const { error: e3 } = await upsertSeller(sellerRow);
    if (e3) {
      show(e3.message, false);
      return;
    }

    await refreshAll();
    show(`${p.s} cerrado y agregado a Cobros`);
    setModal(null);
  };

  const saveSeller = async () => {
    if (!form.seller || !form.sid) {
      show('Completa Seller y Seller ID', false);
      return;
    }

    const row = {
      sid: form.sid,
      seller: form.seller,
      seccion: form.sec,
      kam: form.kam || '-',
      contacto: form.cont || '',
      mail: form.mail || '',
      status: form.status || 'Iniciado',
      tipo: form.tipo || 'Full',
      tarifa: Number(form.tarifa) || 990000,
      f_contrato: form.fContrato || null,
      f_termino: form.fTermino || null,
      dcto: Number(form.dcto) || 0,
      min_meses: Number(form.min) || 6,
    };

    const { error } = await upsertSeller(row);
    if (error) {
      show(error.message, false);
      return;
    }

    await refreshAll();
    show(form._isNew ? 'Seller agregado a Cobros' : 'Seller actualizado');
    setModal(null);
  };

  const deleteSeller = async (s: Seller) => {
    if (!confirm(`Eliminar ${s.seller}?`)) return;

    const { error } = await deleteSellerDB(s.sid);
    if (error) {
      show(error.message, false);
      return;
    }

    await refreshAll();
    show(`${s.seller} eliminado`);
  };

  const saveCupos = async () => {
    for (let i = 0; i < cupos.length; i++) {
      const c = cupos[i];
      const usados = Number(form[`u${i}`] ?? c.u);
      const disponibles = Number(form[`d${i}`] ?? c.d);

      const { error } = await upsertCupo({
        gerencia: c.g,
        encargado: c.e,
        usados,
        disponibles,
      });

      if (error) {
        show(error.message, false);
        return;
      }
    }

    await refreshAll();
    show('Cupos actualizados');
    setModal(null);
  };

  /* ──────────────────────────────────────────────────────────────
     FORM FIELD HELPER
  ─────────────────────────────────────────────────────────────── */
  const F = ({
    label,
    k,
    type = 'text',
    opts,
    w,
  }: {
    label: string;
    k: string;
    type?: string;
    opts?: string[];
    w?: string;
  }) => (
    <div style={{ flex: w || '1 1 200px' }}>
      <label
        style={{
          fontSize: 10,
          color: '#64748b',
          display: 'block',
          marginBottom: 2,
        }}
      >
        {label}
      </label>

      {opts ? (
        <select
          value={form[k] ?? ''}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, [k]: e.target.value }))
          }
          style={{ width: '100%' }}
        >
          <option value="" disabled hidden>
            {label}
          </option>
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={form[k] ?? ''}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, [k]: e.target.value }))
          }
          style={{ width: '100%', boxSizing: 'border-box' }}
          placeholder={label}
        />
      )}
    </div>
  );

  if (!ready) {
    return (
      <div
        style={{
          background: '#08080f',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#50E050',
          fontSize: 18,
          fontFamily: 'monospace',
        }}
      >
        Cargando datos…
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#08080f',
        minHeight: '100vh',
        color: '#e2e8f0',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      <style>{`
        @keyframes fi { from {opacity:0; transform:translateY(6px)} to {opacity:1; transform:translateY(0)} }
        @keyframes si { from {opacity:0; transform:scale(.95)} to {opacity:1; transform:scale(1)} }
        .fi { animation: fi .25s ease-out }
        .si { animation: si .2s ease-out }
        .cd { background: linear-gradient(145deg,#12121f,#0e0e1a); border:1px solid #1e1e3a; border-radius:12px; padding:16px }
        .tb { padding:7px 14px; border-radius:8px; cursor:pointer; font-size:12px; font-weight:600; transition:all .2s; border:1px solid transparent; color:#94a3b8 }
        .tb:hover { background:#1a1a30 }
        .ta { background:#50E050!important; color:#08080f!important; border-color:#50E050!important }
        .kc { background: linear-gradient(145deg,#14142a,#0f0f1f); border:1px solid #1e1e3a; border-radius:12px; padding:12px 14px; flex:1; min-width:100px }
        select, input { background:#12121f; border:1px solid #2a2a4a; color:#e2e8f0; padding:7px 10px; border-radius:8px; font-size:12px; outline:none }
        select:focus, input:focus { border-color:#50E050 }
        .sr { display:grid; gap:6px; padding:10px 12px; border-bottom:1px solid #1a1a2e; align-items:center; transition:background .15s }
        .sr:hover { background:#14142a }
        ::-webkit-scrollbar { width:5px }
        ::-webkit-scrollbar-track { background:#0a0a14 }
        ::-webkit-scrollbar-thumb { background:#2a2a4a; border-radius:3px }
        .pl { padding:3px 10px; border-radius:16px; font-size:10px; font-weight:600; display:inline-block }
        .bg { height:8px; background:#1a1a2e; border-radius:4px; overflow:hidden; flex:1 }
        .bf { height:100%; border-radius:4px; transition:width .5s }
        .mo { position:fixed; inset:0; background:rgba(0,0,0,.75); display:flex; align-items:center; justify-content:center; z-index:100; padding:20px }
        .mc { background:#14142a; border:1px solid #2a2a4a; border-radius:16px; padding:24px; max-width:560px; width:100%; max-height:90vh; overflow-y:auto }
        .bt { padding:8px 18px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; border:none; transition:all .15s }
        .bt:hover { transform:translateY(-1px) }
        .bt:active { transform:scale(.98) }
        .to { position:fixed; top:20px; right:20px; padding:12px 20px; border-radius:10px; font-size:13px; font-weight:600; z-index:200; animation:si .2s ease-out }
        .add-btn { background:#50E050; color:#08080f; border:none; padding:6px 14px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer; transition:all .15s }
        .add-btn:hover { transform:translateY(-1px); box-shadow:0 4px 12px rgba(80,224,80,.3) }
        .del { color:#64748b; cursor:pointer; font-size:14px; transition:color .15s }
        .del:hover { color:#ef4444 }
        .edit { color:#64748b; cursor:pointer; font-size:12px; transition:color .15s }
        .edit:hover { color:#3b82f6 }
      `}</style>

      {toast && (
        <div
          className="to"
          style={{
            background: toast.ok ? '#14532d' : '#7f1d1d',
            color: toast.ok ? '#86efac' : '#fca5a5',
            border: `1px solid ${toast.ok ? '#166534' : '#991b1b'}`,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* MODALS */}
      {modal && (
        <div className="mo" onClick={() => setModal(null)}>
          <div className="mc si" onClick={(e) => e.stopPropagation()}>
            {(modal.type === 'addProspect' ||
              modal.type === 'editProspect') && (
              <>
                <h3
                  style={{ margin: '0 0 16px', color: '#50E050', fontSize: 16 }}
                >
                  {modal.type === 'addProspect'
                    ? 'Agregar Prospecto'
                    : 'Editar Prospecto'}
                </h3>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <F label="Seller ID" k="id" w="1 1 140px" />
                  <F label="Nombre Seller" k="s" />
                  <F label="Categoría" k="c" opts={Array.from(CATS)} />
                  <F label="Tipo" k="t" opts={['Cartera', 'Autogestionado']} />
                  <F label="Contacto" k="n" />
                  <F label="Email" k="m" />
                  <F label="Teléfono" k="tel" w="1 1 140px" />
                  <F label="Nota / Comentario" k="note" />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    className="bt"
                    style={{ background: '#2a2a4a', color: '#94a3b8' }}
                    onClick={() => setModal(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    className="bt"
                    style={{ background: '#50E050', color: '#08080f' }}
                    onClick={() => saveProspect(modal.type === 'addProspect')}
                  >
                    {modal.type === 'addProspect' ? 'Agregar' : 'Guardar'}
                  </button>
                </div>
              </>
            )}

            {modal.type === 'close' && (
              <>
                <h3
                  style={{ margin: '0 0 12px', color: '#50E050', fontSize: 16 }}
                >
                  Cerrar y Mover a Cobros
                </h3>

                <p
                  style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 14px' }}
                >
                  <strong style={{ color: '#e2e8f0' }}>{modal.data.s}</strong>{' '}
                  pasa a Cobros SE.
                </p>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <F label="Sección" k="sec" opts={Array.from(SECS)} />
                  <F label="Plan" k="plan" opts={['Full', 'Premium']} />
                  <F
                    label="Tarifa Neto"
                    k="tarifa"
                    type="number"
                    w="1 1 140px"
                  />
                  <F label="Meses Dcto" k="dcto" type="number" w="1 1 100px" />
                  <F label="Mínimo Meses" k="min" type="number" w="1 1 100px" />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    className="bt"
                    style={{ background: '#2a2a4a', color: '#94a3b8' }}
                    onClick={() => setModal(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    className="bt"
                    style={{ background: '#50E050', color: '#08080f' }}
                    onClick={confirmClose}
                  >
                    Confirmar Cierre
                  </button>
                </div>
              </>
            )}

            {(modal.type === 'addSeller' || modal.type === 'editSeller') && (
              <>
                <h3
                  style={{ margin: '0 0 16px', color: '#50E050', fontSize: 16 }}
                >
                  {modal.type === 'addSeller'
                    ? 'Agregar Seller a Cobros'
                    : 'Editar Seller'}
                </h3>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <F label="Seller" k="seller" />
                  <F label="Seller ID" k="sid" w="1 1 120px" />
                  <F label="Sección" k="sec" opts={Array.from(SECS)} />
                  <F label="KAM" k="kam" />
                  <F label="Contacto" k="cont" />
                  <F label="Email" k="mail" />
                  <F
                    label="Status"
                    k="status"
                    opts={['Iniciado', 'Pausa', 'Fuga']}
                  />
                  <F label="Tipo" k="tipo" opts={['Full', 'Premium']} />
                  <F
                    label="Tarifa Neto"
                    k="tarifa"
                    type="number"
                    w="1 1 120px"
                  />
                  <F label="F.Contratación" k="fContrato" type="date" />
                  <F label="F.Término" k="fTermino" type="date" />
                  <F label="Meses Dcto" k="dcto" type="number" w="1 1 80px" />
                  <F label="Mínimo Meses" k="min" type="number" w="1 1 80px" />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    className="bt"
                    style={{ background: '#2a2a4a', color: '#94a3b8' }}
                    onClick={() => setModal(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    className="bt"
                    style={{ background: '#50E050', color: '#08080f' }}
                    onClick={saveSeller}
                  >
                    {modal.type === 'addSeller' ? 'Agregar' : 'Guardar'}
                  </button>
                </div>
              </>
            )}

            {modal.type === 'editCupos' && (
              <>
                <h3
                  style={{ margin: '0 0 16px', color: '#50E050', fontSize: 16 }}
                >
                  Editar Cupos
                </h3>

                {cupos.map((c, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                      marginBottom: 10,
                    }}
                  >
                    <span
                      style={{
                        minWidth: 120,
                        fontSize: 12,
                        color: '#e2e8f0',
                        fontWeight: 600,
                      }}
                    >
                      {c.g}
                    </span>

                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: '#64748b' }}>
                        Usados
                      </label>
                      <input
                        type="number"
                        value={form[`u${i}`] ?? c.u}
                        onChange={(e) =>
                          setForm({ ...form, [`u${i}`]: e.target.value })
                        }
                        style={{ width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>

                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: '#64748b' }}>
                        Disponibles
                      </label>
                      <input
                        type="number"
                        value={form[`d${i}`] ?? c.d}
                        onChange={(e) =>
                          setForm({ ...form, [`d${i}`]: e.target.value })
                        }
                        style={{ width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                ))}

                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    justifyContent: 'flex-end',
                    marginTop: 16,
                  }}
                >
                  <button
                    className="bt"
                    style={{ background: '#2a2a4a', color: '#94a3b8' }}
                    onClick={() => setModal(null)}
                  >
                    Cancelar
                  </button>
                  <button
                    className="bt"
                    style={{ background: '#50E050', color: '#08080f' }}
                    onClick={saveCupos}
                  >
                    Guardar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* LAYOUT */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 800,
                color: '#50E050',
              }}
            >
              SELLERS ELITE
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
              Hunting + Cobros · Falabella Marketplace
            </p>
          </div>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {(
              [
                ['hunting', 'Hunting'],
                ['sellers', 'Cobros'],
                ['dashboard', 'Dashboard'],
              ] as const
            ).map(([k, l]) => (
              <div
                key={k}
                className={`tb ${tab === k ? 'ta' : ''}`}
                onClick={() => setTab(k)}
              >
                {l}
              </div>
            ))}
          </div>
        </div>

        {/* HUNTING */}
        {tab === 'hunting' && (
          <div
            className="fi"
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { l: 'Pipeline', v: kpi.pipe, c: '#a78bfa' },
                { l: 'Cerrados', v: kpi.cerr, c: '#22c55e' },
                { l: 'No Interesado', v: kpi.noInt, c: '#ef4444' },
                {
                  l: 'Cupos Disp.',
                  v: kpi.cupD,
                  c: kpi.cupD > 0 ? '#50E050' : '#ef4444',
                },
                { l: 'Sellers Cobros', v: kpi.tot, c: '#3b82f6' },
              ].map((k, i) => (
                <div
                  key={i}
                  className="kc"
                  style={{ borderTop: `3px solid ${k.c}` }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '.4px',
                      marginBottom: 2,
                    }}
                  >
                    {k.l}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: k.c }}>
                    {k.v}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 14,
              }}
            >
              <div className="cd">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 10,
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
                    Cupos por Gerencia
                  </h3>
                  <span
                    className="edit"
                    onClick={() => {
                      setForm({});
                      setModal({ type: 'editCupos' });
                    }}
                  >
                    editar
                  </span>
                </div>

                {cupos.map((c, i) => {
                  const tot = c.u + c.d;
                  const pct = tot > 0 ? (c.u / tot) * 100 : 0;
                  return (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 11,
                          marginBottom: 2,
                        }}
                      >
                        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>
                          {c.g}{' '}
                          <span style={{ color: '#475569', fontWeight: 400 }}>
                            ({c.e})
                          </span>
                        </span>
                        <span
                          style={{
                            color: c.d === 0 && c.u > 0 ? '#ef4444' : '#22c55e',
                            fontWeight: 600,
                            fontSize: 10,
                          }}
                        >
                          {c.u}/{tot} ({c.d} disp)
                        </span>
                      </div>
                      <div className="bg">
                        <div
                          className="bf"
                          style={{
                            width: `${pct}%`,
                            background:
                              c.d === 0 && c.u > 0
                                ? '#ef4444'
                                : pct > 80
                                ? '#f59e0b'
                                : '#50E050',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="cd">
                <h3
                  style={{ margin: '0 0 10px', fontSize: 13, color: '#94a3b8' }}
                >
                  Funnel
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={funnel} layout="vertical">
                    <XAxis
                      type="number"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      width={95}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#14142a',
                        border: '1px solid #2a2a4a',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {funnel.map((e, i) => (
                        <Cell key={i} fill={e.fill} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="cd" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                style={{
                  padding: '10px 12px',
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  borderBottom: '1px solid #1a1a2e',
                  alignItems: 'center',
                }}
              >
                <input
                  placeholder="Buscar..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  style={{ flex: '1 1 140px' }}
                />

                <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
                  <option>Todos</option>
                  {Array.from(CATS).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>

                <select value={fSt} onChange={(e) => setFSt(e.target.value)}>
                  <option>Todos</option>
                  {STAGES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>

                <button
                  className="add-btn"
                  onClick={() => {
                    setForm({ c: CATS[0], t: 'Cartera' });
                    setModal({ type: 'addProspect' });
                  }}
                >
                  + Agregar Prospecto
                </button>
              </div>

              <div
                className="sr"
                style={{
                  gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.5fr .4fr',
                  background: '#0e0e1a',
                  cursor: 'default',
                  fontSize: 10,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  letterSpacing: '.3px',
                  borderBottom: '2px solid #1e1e3a',
                }}
              >
                <div>Seller</div>
                <div>Categoría</div>
                <div>Status</div>
                <div>Contacto</div>
                <div>Acción</div>
                <div />
              </div>

              <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                {filt.map((p) => {
                  const si = ACTIVE_STAGES.indexOf(p.st);
                  const nextActive =
                    si >= 0 && si < ACTIVE_STAGES.length - 1
                      ? ACTIVE_STAGES[si + 1]
                      : null;

                  const canClose = p.st === 'Interesados';
                  const canNoInt =
                    p.st === 'Contactados' || p.st === 'Interesados';

                  const cp = cupos.find((c) => c.g === p.c);
                  const cupoOk = cp && cp.d > 0;

                  return (
                    <div
                      key={p.id}
                      className="sr"
                      style={{
                        gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.5fr .4fr',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>
                          {p.s}
                        </div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>
                          {p.id}
                          {p.note ? ` • ${p.note}` : ''}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 11 }}>{p.c}</div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>
                          {p.t}
                        </div>
                      </div>

                      <div>
                        <span
                          className="pl"
                          style={{
                            background: SC[p.st] + '22',
                            color: SC[p.st],
                          }}
                        >
                          {p.st}
                        </span>
                      </div>

                      <div style={{ fontSize: 10, color: '#94a3b8' }}>
                        {p.n || p.m || '-'}
                      </div>

                      <div
                        style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}
                      >
                        {nextActive && (
                          <button
                            className="bt"
                            style={{
                              padding: '3px 8px',
                              fontSize: 10,
                              background: '#3b82f6',
                              color: '#fff',
                            }}
                            onClick={() => advance(p, nextActive)}
                          >
                            {nextActive === 'Contactados'
                              ? 'Contactar'
                              : 'Interesado'}
                          </button>
                        )}

                        {canClose && (
                          <button
                            className="bt"
                            style={{
                              padding: '3px 8px',
                              fontSize: 10,
                              background: cupoOk ? '#22c55e' : '#374151',
                              color: cupoOk ? '#fff' : '#6b7280',
                              cursor: cupoOk ? 'pointer' : 'not-allowed',
                            }}
                            onClick={() => cupoOk && advance(p, 'Cerrados')}
                            title={!cupoOk ? 'Sin cupos' : ''}
                          >
                            Cerrar{!cupoOk ? ' (0)' : ''}
                          </button>
                        )}

                        {canNoInt && (
                          <button
                            className="bt"
                            style={{
                              padding: '3px 8px',
                              fontSize: 10,
                              background: '#7f1d1d',
                              color: '#fca5a5',
                            }}
                            onClick={() => advance(p, 'No Interesado')}
                          >
                            No Int.
                          </button>
                        )}

                        {p.st === 'No Interesado' && (
                          <button
                            className="bt"
                            style={{
                              padding: '3px 8px',
                              fontSize: 10,
                              background: '#1e1e3a',
                              color: '#94a3b8',
                            }}
                            onClick={() => advance(p, 'Prospectos')}
                          >
                            Reactivar
                          </button>
                        )}

                        {p.st === 'Cerrados' && (
                          <span
                            style={{
                              fontSize: 10,
                              color: '#22c55e',
                              fontWeight: 600,
                            }}
                          >
                            En Cobros
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        <span
                          className="edit"
                          onClick={() => {
                            setForm({ ...p, _origId: p.id });
                            setModal({ type: 'editProspect' });
                          }}
                        >
                          ✎
                        </span>
                        <span className="del" onClick={() => deleteProspect(p)}>
                          ×
                        </span>
                      </div>
                    </div>
                  );
                })}

                {filt.length === 0 && (
                  <div
                    style={{
                      padding: 20,
                      textAlign: 'center',
                      color: '#475569',
                      fontSize: 13,
                    }}
                  >
                    No hay prospectos con estos filtros
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SELLERS */}
        {tab === 'sellers' && (
          <div className="fi">
            <div className="cd" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                style={{
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: '1px solid #1a1a2e',
                }}
              >
                <span
                  style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}
                >
                  Sellers en Cobros ({sellers.length})
                </span>

                <button
                  className="add-btn"
                  onClick={() => {
                    setForm({
                      sec: SECS[0],
                      status: 'Iniciado',
                      tipo: 'Full',
                      tarifa: 990000,
                      min: 6,
                      dcto: 2,
                      _isNew: true,
                    });
                    setModal({ type: 'addSeller' });
                  }}
                >
                  + Agregar Seller
                </button>
              </div>

              <div
                className="sr"
                style={{
                  gridTemplateColumns:
                    '2fr 1.2fr .8fr .8fr .7fr .7fr .7fr .4fr',
                  background: '#0e0e1a',
                  cursor: 'default',
                  fontSize: 10,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  borderBottom: '2px solid #1e1e3a',
                }}
              >
                <div>Seller</div>
                <div>Sección</div>
                <div>Status</div>
                <div>Tipo</div>
                <div>Tarifa</div>
                <div>Dcto</div>
                <div>Min</div>
                <div />
              </div>

              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {sellers.map((s, i) => (
                  <div
                    key={i}
                    className="sr"
                    style={{
                      gridTemplateColumns:
                        '2fr 1.2fr .8fr .8fr .7fr .7fr .7fr .4fr',
                      cursor: 'pointer',
                    }}
                    onClick={() => setSelS(selS?.sid === s.sid ? null : s)}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>
                        {s.seller}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>
                        {s.sid} · {s.cont}
                      </div>
                    </div>

                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      {s.sec}
                    </div>

                    <div>
                      <span
                        className="pl"
                        style={{
                          background: stC(s.status) + '22',
                          color: stC(s.status),
                        }}
                      >
                        {s.status}
                      </span>
                    </div>

                    <div style={{ fontSize: 11 }}>{s.tipo}</div>
                    <div style={{ fontSize: 11, color: '#50E050' }}>
                      {fmt(s.tarifa)}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: s.dcto > 0 ? '#a78bfa' : '#475569',
                      }}
                    >
                      {s.dcto > 0 ? `${s.dcto}m` : '-'}
                    </div>
                    <div style={{ fontSize: 11 }}>{s.min}m</div>

                    <div
                      style={{ display: 'flex', gap: 6 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span
                        className="edit"
                        onClick={() => {
                          setForm({ ...s, _origSid: s.sid });
                          setModal({ type: 'editSeller' });
                        }}
                      >
                        ✎
                      </span>
                      <span className="del" onClick={() => deleteSeller(s)}>
                        ×
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selS && (
              <div className="cd fi" style={{ marginTop: 12 }}>
                <h3
                  style={{ margin: '0 0 4px', color: '#50E050', fontSize: 15 }}
                >
                  {selS.seller}
                </h3>
                <div
                  style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}
                >
                  {selS.sid} · {selS.cont} · {selS.mail} · Contratado:{' '}
                  {selS.fContrato || 'N/A'}
                  {selS.fTermino ? ` · Término: ${selS.fTermino}` : ''}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))',
                    gap: 6,
                    fontSize: 11,
                  }}
                >
                  <div>
                    <span style={{ color: '#64748b' }}>Sección:</span>{' '}
                    {selS.sec}
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>KAM:</span> {selS.kam}
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Plan:</span> {selS.tipo}
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Tarifa:</span>{' '}
                    <span style={{ color: '#50E050' }}>{fmt(selS.tarifa)}</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Dcto:</span>{' '}
                    <span style={{ color: '#a78bfa' }}>{selS.dcto}m</span>
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Mínimo:</span> {selS.min}
                    m
                  </div>
                  <div>
                    <span style={{ color: '#64748b' }}>Status:</span>{' '}
                    <span style={{ color: stC(selS.status) }}>
                      {selS.status}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* DASHBOARD */}
        {tab === 'dashboard' && (
          <div
            className="fi"
            style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { l: 'Activos', v: kpi.act, c: '#22c55e' },
                { l: 'Fugas', v: kpi.fug, c: '#ef4444' },
                { l: 'Pipeline', v: kpi.pipe, c: '#a78bfa' },
                { l: 'No Interesado', v: kpi.noInt, c: '#f59e0b' },
                { l: 'Cerrados', v: kpi.cerr, c: '#3b82f6' },
              ].map((k, i) => (
                <div
                  key={i}
                  className="kc"
                  style={{ borderTop: `3px solid ${k.c}` }}
                >
                  <div
                    style={{
                      fontSize: 9,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      letterSpacing: '.4px',
                      marginBottom: 2,
                    }}
                  >
                    {k.l}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: k.c }}>
                    {k.v}
                  </div>
                </div>
              ))}
            </div>

            <div className="cd">
              <h3
                style={{ margin: '0 0 10px', fontSize: 13, color: '#94a3b8' }}
              >
                Resumen del Funnel
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={funnel}>
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#14142a',
                      border: '1px solid #2a2a4a',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {funnel.map((e, i) => (
                      <Cell key={i} fill={e.fill} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="cd">
              <h3
                style={{ margin: '0 0 10px', fontSize: 13, color: '#94a3b8' }}
              >
                Sellers por Sección
              </h3>
              {Array.from(SECS).map((sec) => {
                const count = sellers.filter((s) => s.sec === sec).length;
                return count > 0 ? (
                  <div
                    key={sec}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{ fontSize: 12, color: '#e2e8f0', minWidth: 120 }}
                    >
                      {sec}
                    </span>
                    <div className="bg" style={{ maxWidth: 300 }}>
                      <div
                        className="bf"
                        style={{
                          width: `${(count / sellers.length) * 100}%`,
                          background: '#50E050',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        color: '#50E050',
                        fontWeight: 700,
                      }}
                    >
                      {count}
                    </span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
