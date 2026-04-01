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

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
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

type Modal =
  | null
  | {
      type:
        | 'addProspect'
        | 'editProspect'
        | 'addSeller'
        | 'editSeller'
        | 'close'
        | 'edit';
      data?: any;
    };

type Toast = null | { msg: string; ok: boolean };

/* ──────────────────────────────────────────────────────────────
CONSTANTS — UNIFIED CATEGORIES
Usado en: Prospect.categoría, Seller.sección, Cupos.gerencia
Máximo 12 cupos por categoría
────────────────────────────────────────────────────────────── */
const CATEGORIAS = [
  'Electro',
  'Muebles/Hogar',
  'Cat Dig',
  'Moda',
  'Belleza/Calzado',
] as const;

type Categoria = (typeof CATEGORIAS)[number];

const KAM_POR_CATEGORIA: Record<Categoria, string> = {
  Electro: 'TBD - Electro',
  'Muebles/Hogar': 'TBD - Hogar',
  'Cat Dig': 'TRINI',
  Moda: 'Pacita',
  'Belleza/Calzado': 'Maca',
};

const MAX_CUPOS = 12;

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

/* ──────────────────────────────────────────────────────────────
COLOR PALETTE
Fondo blanco, verde primario, gris secundario, azul pastel terciario
────────────────────────────────────────────────────────────── */
const C = {
  bg: '#FFFFFF',
  bgAlt: '#F7F8FA',
  bgCard: '#FFFFFF',
  bgDark: '#F1F3F5',
  border: '#E2E6EA',
  borderDark: '#D0D5DB',
  text: '#1A1D21',
  textSec: '#5F6B7A',
  textMuted: '#8B95A3',
  primary: '#16A34A', // verde
  primaryLight: '#DCFCE7',
  primaryDark: '#15803D',
  secondary: '#6B7280', // gris
  secondaryLight: '#F3F4F6',
  tertiary: '#93C5FD', // azul pastel
  tertiaryBg: '#EFF6FF',
  tertiaryDark: '#3B82F6',
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  purple: '#8B5CF6',
  purpleLight: '#EDE9FE',
};

const SC: Record<ProspectStage, string> = {
  Prospectos: C.secondary,
  Contactados: C.tertiaryDark,
  Interesados: C.warning,
  'No Interesado': C.danger,
  Cerrados: C.primary,
};

const fmt = (n: number) =>
  n >= 1e6
    ? `$${(n / 1e6).toFixed(1)}M`
    : n >= 1e3
      ? `$${(n / 1e3).toFixed(0)}K`
      : `$${n}`;

const fmtFull = (n: number) => '$' + n.toLocaleString('es-CL');

const stC = (s: SellerStatus) =>
  s === 'Fuga' ? C.danger : s === 'Pausa' ? C.warning : C.primary;

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
  const [tab, setTab] = useState< 'dashboard' | 'sellers' | 'hunting'  >('dashboard');
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

  // useRef for form to prevent re-renders losing focus
  const [form, setForm] = useState<Record<string, any>>({});
  const formRef = useRef(form);
  formRef.current = form;

  const updateForm = useCallback((key: string, value: any) => {
    setForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const show = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  /* REFRESH */
  const refreshAll = useCallback(async () => {
    const { data: pRows, error: pErr } = await fetchProspects();
    const { data: sRows, error: sErr } = await fetchSellers();
    const { data: cRows, error: cErr } = await fetchCupos();

    if (pErr) console.error('fetchProspects:', pErr);
    if (sErr) console.error('fetchSellers:', sErr);
    if (cErr) console.error('fetchCupos:', cErr);

    setProspects((pRows ?? []).map(mapProspectRowToUI));
    setSellers((sRows ?? []).map(mapSellerRowToUI));
    setCupos((cRows ?? []).map(mapCupoRowToUI));
  }, []);

  useEffect(() => {
    (async () => {
      await refreshAll();
      setReady(true);
    })();
  }, [refreshAll]);

  /* COMPUTED */
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
    const pausa = sellers.filter((s) => s.status === 'Pausa').length;
    const fug = sellers.filter((s) => s.status === 'Fuga').length;
    const pipe = prospects.filter((p) => ACTIVE_STAGES.includes(p.st)).length;
    const cerr = prospects.filter((p) => p.st === 'Cerrados').length;
    const noInt = prospects.filter((p) => p.st === 'No Interesado').length;
    const cupD = cuposCalc.reduce((a, c) => a + c.d, 0);

    // Revenue calculations
    const totalRevenue = sellers
      .filter(s => s.status === 'Iniciado')
      .reduce((sum, s) => sum + s.tarifa, 0);

    const avgTicket = act > 0 ? totalRevenue / act : 0;

    // Revenue by plan
    const revFull = sellers
      .filter(s => s.status === 'Iniciado' && s.tipo === 'Full')
      .reduce((sum, s) => sum + s.tarifa, 0);

    const revPremium = sellers
      .filter(s => s.status === 'Iniciado' && s.tipo === 'Premium')
      .reduce((sum, s) => sum + s.tarifa, 0);

    // Sellers in discount period
    const enDcto = sellers.filter(s => s.dcto > 0 && s.status === 'Iniciado').length;

    const dctoValue = sellers
      .filter(s => s.dcto > 0 && s.status === 'Iniciado')
      .reduce((sum, s) => sum + (s.tarifa * 0.5 * s.dcto), 0); // approximate discount value

    return {
      tot: sellers.length,
      act,
      pausa,
      fug,
      pipe,
      cerr,
      noInt,
      cupD,
      totalRevenue,
      avgTicket,
      revFull,
      revPremium,
      enDcto,
      dctoValue,
    };
  }, [sellers, prospects, cupos]);

  // Revenue by category for dashboard
  const revByCategory = useMemo(() => {
    return CATEGORIAS.map(cat => {
      const catSellers = sellers.filter(s => s.sec === cat && s.status === 'Iniciado');
      const rev = catSellers.reduce((sum, s) => sum + s.tarifa, 0);
      return { name: cat, revenue: rev, sellers: catSellers.length };
    }).filter(c => c.sellers > 0);
  }, [sellers]);

  // Plan distribution for pie chart
  const planDist = useMemo(() => {
    const full = sellers.filter(s => s.tipo === 'Full' && s.status === 'Iniciado').length;
    const premium = sellers.filter(s => s.tipo === 'Premium' && s.status === 'Iniciado').length;
    return [
      { name: 'Full', value: full, fill: C.primary },
      { name: 'Premium', value: premium, fill: C.purple },
    ].filter(d => d.value > 0);
  }, [sellers]);

  // Status distribution for pie chart
  const statusDist = useMemo(
    () =>
      [
        { name: 'Activo', value: kpi.act, fill: C.primary },
        { name: 'Pausa', value: kpi.pausa, fill: C.warning },
        { name: 'Fuga', value: kpi.fug, fill: C.danger },
      ].filter(d => d.value > 0),
    [kpi]
  );

  /* ──────────────────────────────────────────────────────────────
  ACTIONS
  ─────────────────────────────────────────────────────────────── */
  const saveProspect = async (isNew: boolean) => {
    if (!form.id || !form.s || !form.c) {
      show('Completa ID, Seller y Categoría', false);
      return;
    }

    const row = {
      id: form.id,
      seller: form.s,
      status: isNew ? 'Prospectos' : (form.st ?? 'Prospectos'),
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
    if (ns === 'Cerrados') {
      const cp = cuposCalc.find((c) => c.g === p.c);
      if (cp && cp.d <= 0) {
        show(`Sin cupos en ${p.c}`, false);
        return;
      }

      setForm({
        plan: 'Full',
        tarifa: 990000,
        dcto: 2,
        min: 6,
        sec: p.c,
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

  // Click on a closed prospect → open close modal to push to Cobros
  const handleClosedClick = (p: Prospect) => {
    const existing = sellers.find(s => s.sid === p.id);
    if (existing) {
      setTab('sellers');
      setSelS(existing);
      show(`${p.s} ya está en Cobros`, true);
      return;
    }

    setForm({
      plan: 'Full',
      tarifa: 990000,
      dcto: 2,
      min: 6,
      sec: p.c,
      sid: p.id,
      seller: p.s,
      cont: p.n,
      mail: p.m,
      kam: KAM_POR_CATEGORIA[p.c as Categoria] || '-',
    });

    setModal({ type: 'close', data: p });
  };

  const confirmClose = async () => {
    const p: Prospect = modal?.data;
    if (!p) {
      show('Error: prospecto no encontrado', false);
      return;
    }

    // 1) prospect -> Cerrados (if not already)
    if (p.st !== 'Cerrados') {
      const { error: e1 } = await updateProspectStatus(p.id, 'Cerrados');
      if (e1) {
        show(e1.message, false);
        return;
      }
    }

    // 2) cupos
    const cp = cuposCalc.find((c) => c.g === p.c);
    if (cp && cp.d > 0 && p.st !== 'Cerrados') {
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
    }

    // 3) crear seller
    const sellerRow = {
      sid: form.sid || p.id,
      seller: form.seller || p.s,
      seccion: form.sec || p.c,
      kam: form.kam || KAM_POR_CATEGORIA[p.c as Categoria] || '-',
      contacto: form.cont || p.n || '',
      mail: form.mail || p.m || '',
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
    for (let i = 0; i < cuposCalc.length; i++) {
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
  FORM FIELD HELPER — stable key-based onChange
  ─────────────────────────────────────────────────────────────── */
  const F = useCallback(
    ({ label, k, type = 'text', opts, w }: {
      label: string;
      k: string;
      type?: string;
      opts?: readonly string[] | string[];
      w?: string;
    }) => (
      <div style={{ flex: w || '1 1 200px' }}>
        <label
          style={{
            fontSize: 11,
            color: C.textMuted,
            display: 'block',
            marginBottom: 3,
            fontWeight: 500,
            letterSpacing: '0.3px',
          }}
        >
          {label}
        </label>

        {opts ? (
          <select
            value={form[k] ?? ''}
            onChange={(e) => updateForm(k, e.target.value)}
            style={{
              width: '100%',
              background: C.bgAlt,
              border: `1px solid ${C.border}`,
              color: C.text,
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 13,
            }}
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
            onChange={(e) => updateForm(k, e.target.value)}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: C.bgAlt,
              border: `1px solid ${C.border}`,
              color: C.text,
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 13,
            }}
            placeholder={label}
          />
        )}
      </div>
    ),
    [form, updateForm]
  );

  if (!ready) {
    return (
      <div
        style={{
          background: C.bg,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: C.primary,
          fontSize: 16,
          fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: `3px solid ${C.primaryLight}`,
              borderTop: `3px solid ${C.primary}`,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          Cargando datos...
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: C.bgAlt,
        minHeight: '100vh',
        color: C.text,
        fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        @keyframes fi { from {opacity:0; transform:translateY(6px)} to {opacity:1; transform:translateY(0)} }
        @keyframes si { from {opacity:0; transform:scale(.96)} to {opacity:1; transform:scale(1)} }
        @keyframes spin { to { transform: rotate(360deg) } }
        .fi { animation: fi .3s ease-out }
        .si { animation: si .2s ease-out }

        .cd {
          background: ${C.bgCard};
          border: 1px solid ${C.border};
          border-radius: 14px;
          padding: 18px;
          box-shadow: 0 1px 3px rgba(0,0,0,.04);
        }

        .tb {
          padding: 8px 16px; border-radius: 10px; cursor: pointer;
          font-size: 13px; font-weight: 600; transition: all .2s;
          border: 1px solid transparent; color: ${C.textSec};
          background: transparent;
        }
        .tb:hover { background: ${C.primaryLight}; color: ${C.primaryDark} }
        .ta {
          background: ${C.primary} !important;
          color: #fff !important;
          border-color: ${C.primary} !important;
          box-shadow: 0 2px 8px rgba(22,163,74,.25);
        }

        .kc {
          background: ${C.bgCard};
          border: 1px solid ${C.border};
          border-radius: 12px;
          padding: 14px 16px;
          flex: 1; min-width: 110px;
          box-shadow: 0 1px 3px rgba(0,0,0,.03);
        }

        select, input {
          background: ${C.bgAlt};
          border: 1px solid ${C.border};
          color: ${C.text};
          padding: 8px 10px;
          border-radius: 8px;
          font-size: 13px;
          outline: none;
          font-family: inherit;
          transition: border-color .2s;
        }
        select:focus, input:focus { border-color: ${C.primary}; box-shadow: 0 0 0 3px ${C.primaryLight} }

        .sr {
          display: grid; gap: 8px; padding: 10px 14px;
          border-bottom: 1px solid ${C.border};
          align-items: center; transition: background .15s;
        }
        .sr:hover { background: ${C.bgAlt} }

        ::-webkit-scrollbar { width: 6px }
        ::-webkit-scrollbar-track { background: ${C.bgAlt} }
        ::-webkit-scrollbar-thumb { background: ${C.borderDark}; border-radius: 3px }

        .pl {
          padding: 3px 10px; border-radius: 16px;
          font-size: 11px; font-weight: 600; display: inline-block;
        }

        .bg { height: 8px; background: ${C.bgDark}; border-radius: 4px; overflow: hidden; flex: 1 }
        .bf { height: 100%; border-radius: 4px; transition: width .5s }

        .mo {
          position: fixed; inset: 0;
          background: rgba(0,0,0,.4);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          z-index: 100; padding: 20px;
        }
        .mc {
          background: ${C.bgCard};
          border: 1px solid ${C.border};
          border-radius: 18px;
          padding: 28px;
          max-width: 580px; width: 100%;
          max-height: 90vh; overflow-y: auto;
          box-shadow: 0 20px 60px rgba(0,0,0,.12);
        }

        .bt {
          padding: 9px 20px; border-radius: 10px; font-size: 13px;
          font-weight: 600; cursor: pointer; border: none;
          transition: all .15s; font-family: inherit;
        }
        .bt:hover { transform: translateY(-1px) }
        .bt:active { transform: scale(.98) }

        .to {
          position: fixed; top: 20px; right: 20px;
          padding: 12px 22px; border-radius: 12px;
          font-size: 13px; font-weight: 600; z-index: 200;
          animation: si .2s ease-out;
          box-shadow: 0 4px 16px rgba(0,0,0,.1);
        }

        .add-btn {
          background: ${C.primary}; color: #fff;
          border: none; padding: 8px 16px; border-radius: 10px;
          font-size: 12px; font-weight: 700; cursor: pointer;
          transition: all .15s; font-family: inherit;
          box-shadow: 0 2px 8px rgba(22,163,74,.2);
        }
        .add-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(22,163,74,.3) }

        .del { color: ${C.textMuted}; cursor: pointer; font-size: 15px; transition: color .15s }
        .del:hover { color: ${C.danger} }
        .edit { color: ${C.textMuted}; cursor: pointer; font-size: 13px; transition: color .15s }
        .edit:hover { color: ${C.tertiaryDark} }

        .stat-card {
          background: ${C.bgCard};
          border: 1px solid ${C.border};
          border-radius: 12px;
          padding: 16px 18px;
          box-shadow: 0 1px 3px rgba(0,0,0,.03);
        }
      `}</style>

      {toast && (
        <div
          className="to"
          style={{
            background: toast.ok ? C.primaryLight : C.dangerLight,
            color: toast.ok ? C.primaryDark : C.danger,
            border: `1px solid ${toast.ok ? C.primary : C.danger}`,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* MODALS */}
      {modal && (
        <div className="mo" onClick={() => setModal(null)}>
          <div className="mc si" onClick={(e) => e.stopPropagation()}>
            {/* ADD/EDIT PROSPECT */}
            {(modal.type === 'addProspect' || modal.type === 'editProspect') && (
              <>
                <h3 style={{ margin: '0 0 18px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
                  {modal.type === 'addProspect' ? 'Agregar Prospecto' : 'Editar Prospecto'}
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                  <F label="Seller ID" k="id" w="1 1 140px" />
                  <F label="Nombre Seller" k="s" />
                  <F label="Categoría" k="c" opts={CATEGORIAS} />
                  <F label="Tipo" k="t" opts={['Cartera', 'Autogestionado']} />
                  <F label="Contacto" k="n" />
                  <F label="Email" k="m" />
                  <F label="Teléfono" k="tel" w="1 1 140px" />
                  <F label="Nota / Comentario" k="note" />
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="bt" style={{ background: C.secondaryLight, color: C.textSec }} onClick={() => setModal(null)}>
                    Cancelar
                  </button>
                  <button className="bt" style={{ background: C.primary, color: '#fff' }} onClick={() => saveProspect(modal.type === 'addProspect')}>
                    {modal.type === 'addProspect' ? 'Agregar' : 'Guardar'}
                  </button>
                </div>
              </>
            )}

            {/* CLOSE MODAL */}
            {modal.type === 'close' && (
              <>
                <h3 style={{ margin: '0 0 14px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
                  Cerrar y Mover a Cobros
                </h3>
                <p style={{ color: C.textSec, fontSize: 13, margin: '0 0 16px' }}>
                  <strong style={{ color: C.text }}>{modal.data.s}</strong> pasa a Cobros SE. Completa los datos de facturación:
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                  <F label="Seller ID" k="sid" w="1 1 120px" />
                  <F label="Seller" k="seller" />
                  <F label="Sección / Categoría" k="sec" opts={CATEGORIAS} />
                  <F label="KAM" k="kam" />
                  <F label="Contacto" k="cont" />
                  <F label="Email" k="mail" />
                  <F label="Plan" k="plan" opts={['Full', 'Premium']} />
                  <F label="Tarifa Neto" k="tarifa" type="number" w="1 1 140px" />
                  <F label="Meses Dcto" k="dcto" type="number" w="1 1 100px" />
                  <F label="Mínimo Meses" k="min" type="number" w="1 1 100px" />
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="bt" style={{ background: C.secondaryLight, color: C.textSec }} onClick={() => setModal(null)}>
                    Cancelar
                  </button>
                  <button className="bt" style={{ background: C.primary, color: '#fff' }} onClick={confirmClose}>
                    Confirmar Cierre
                  </button>
                </div>
              </>
            )}

            {/* ADD/EDIT SELLER */}
            {(modal.type === 'addSeller' || modal.type === 'editSeller') && (
              <>
                <h3 style={{ margin: '0 0 18px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
                  {modal.type === 'addSeller' ? 'Agregar Seller a Cobros' : 'Editar Seller'}
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                  <F label="Seller" k="seller" />
                  <F label="Seller ID" k="sid" w="1 1 120px" />
                  <F label="Sección" k="sec" opts={CATEGORIAS} />
                  <F label="KAM" k="kam" />
                  <F label="Contacto" k="cont" />
                  <F label="Email" k="mail" />
                  <F label="Status" k="status" opts={['Iniciado', 'Pausa', 'Fuga']} />
                  <F label="Tipo" k="tipo" opts={['Full', 'Premium']} />
                  <F label="Tarifa Neto" k="tarifa" type="number" w="1 1 120px" />
                  <F label="F.Contratación" k="fContrato" type="date" />
                  <F label="F.Término" k="fTermino" type="date" />
                  <F label="Meses Dcto" k="dcto" type="number" w="1 1 80px" />
                  <F label="Mínimo Meses" k="min" type="number" w="1 1 80px" />
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="bt" style={{ background: C.secondaryLight, color: C.textSec }} onClick={() => setModal(null)}>
                    Cancelar
                  </button>
                  <button className="bt" style={{ background: C.primary, color: '#fff' }} onClick={saveSeller}>
                    {modal.type === 'addSeller' ? 'Agregar' : 'Guardar'}
                  </button>
                </div>
              </>
            )}

            {/* EDIT CUPOS */}
            {modal.type === 'editCupos' && (
              <>
                <h3 style={{ margin: '0 0 18px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
                  Editar Cupos (máx {MAX_CUPOS} por categoría)
                </h3>

                {cuposCalc.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ minWidth: 130, fontSize: 13, color: C.text, fontWeight: 600 }}>{c.g}</span>

                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: C.textMuted }}>Usados</label>
                      <input
                        type="number"
                        value={form[`u${i}`] ?? c.u}
                        onChange={(e) => updateForm(`u${i}`, e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>

                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: C.textMuted }}>Disponibles</label>
                      <input
                        type="number"
                        value={form[`d${i}`] ?? c.d}
                        onChange={(e) => updateForm(`d${i}`, e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>
                ))}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                  <button className="bt" style={{ background: C.secondaryLight, color: C.textSec }} onClick={() => setModal(null)}>
                    Cancelar
                  </button>
                  <button className="bt" style={{ background: C.primary, color: '#fff' }} onClick={saveCupos}>
                    Guardar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* LAYOUT */}
      <div style={{ maxWidth: 1320, margin: '0 auto', padding: '20px 20px' }}>
        {/* HEADER */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 12,
            background: C.bgCard,
            padding: '14px 20px',
            borderRadius: 14,
            border: `1px solid ${C.border}`,
            boxShadow: '0 1px 4px rgba(0,0,0,.03)',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.primary, letterSpacing: '-0.5px' }}>
              SELLERS ELITE
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: C.textMuted }}>
              Hunting + Cobros · Falabella Marketplace
            </p>
          </div>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {([['hunting', 'Hunting'], ['sellers', 'Cobros'], ['dashboard', 'Dashboard']] as const).map(([k, l]) => (
              <div key={k} className={`tb ${tab === k ? 'ta' : ''}`} onClick={() => setTab(k)}>
                {l}
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════ HUNTING TAB ═══════════════ */}
        {tab === 'hunting' && (
          <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* KPIs */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { l: 'Pipeline', v: kpi.pipe, c: C.purple, bg: C.purpleLight },
                { l: 'Cerrados', v: kpi.cerr, c: C.primary, bg: C.primaryLight },
                { l: 'No Interesado', v: kpi.noInt, c: C.danger, bg: C.dangerLight },
                { l: 'Cupos Disp.', v: kpi.cupD, c: kpi.cupD > 0 ? C.primary : C.danger, bg: kpi.cupD > 0 ? C.primaryLight : C.dangerLight },
                { l: 'Sellers Cobros', v: kpi.tot, c: C.tertiaryDark, bg: C.tertiaryBg },
              ].map((k, i) => (
                <div key={i} className="kc" style={{ borderTop: `3px solid ${k.c}` }}>
                  <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>
                    {k.l}
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: k.c }}>{k.v}</div>
                </div>
              ))}
            </div>

            {/* Cupos + Funnel */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="cd">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, fontSize: 14, color: C.textSec, fontWeight: 600 }}>Cupos por Categoría</h3>
                  <span className="edit" onClick={() => { setForm({}); setModal({ type: 'editCupos' }); }}>
                    editar
                  </span>
                </div>

                {cuposCalc.map((c, i) => {
                  const tot = c.u + c.d;
                  const pct = tot > 0 ? (c.u / tot) * 100 : 0;

                  return (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: C.text, fontWeight: 600 }}>
                          {c.g}{' '}
                          <span style={{ color: C.textMuted, fontWeight: 400 }}>
                            ({c.e})
                          </span>
                        </span>
                        <span style={{ color: c.d === 0 && c.u > 0 ? C.danger : C.primary, fontWeight: 600, fontSize: 11 }}>
                          {c.u}/{tot} ({c.d} disp)
                        </span>
                      </div>

                      <div className="bg">
                        <div
                          className="bf"
                          style={{
                            width: `${pct}%`,
                            background: c.d === 0 && c.u > 0 ? C.danger : pct > 80 ? C.warning : C.primary,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="cd">
                <h3 style={{ margin: '0 0 12px', fontSize: 14, color: C.textSec, fontWeight: 600 }}>Funnel</h3>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={funnel} layout="vertical">
                    <XAxis type="number" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: C.textSec, fontSize: 11 }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {funnel.map((e, i) => <Cell key={i} fill={e.fill} fillOpacity={0.85} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* PROSPECT TABLE */}
            <div className="cd" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                style={{
                  padding: '12px 14px',
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  borderBottom: `1px solid ${C.border}`,
                  alignItems: 'center',
                  background: C.bgAlt,
                }}
              >
                <input
                  placeholder="Buscar seller..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  style={{ flex: '1 1 160px' }}
                />

                <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
                  <option>Todos</option>
                  {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
                </select>

                <select value={fSt} onChange={(e) => setFSt(e.target.value)}>
                  <option>Todos</option>
                  {STAGES.map(s => <option key={s}>{s}</option>)}
                </select>

                <button
                  className="add-btn"
                  onClick={() => {
                    setForm({ c: CATEGORIAS[0], t: 'Cartera' });
                    setModal({ type: 'addProspect' });
                  }}
                >
                  + Agregar Prospecto
                </button>
              </div>

              {/* Table header */}
              <div
                className="sr"
                style={{
                  gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.5fr .4fr',
                  background: C.bgAlt,
                  cursor: 'default',
                  fontSize: 11,
                  color: C.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '.4px',
                  borderBottom: `2px solid ${C.border}`,
                  fontWeight: 600,
                }}
              >
                <div>Seller</div><div>Categoría</div><div>Status</div>
                <div>Contacto</div><div>Acción</div><div />
              </div>

              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {filt.map((p) => {
                  const si = ACTIVE_STAGES.indexOf(p.st);
                  const nextActive =
                    si >= 0 && si < ACTIVE_STAGES.length - 1 ? ACTIVE_STAGES[si + 1] : null;

                  const canClose = p.st === 'Interesados';
                  const canNoInt = p.st === 'Contactados' || p.st === 'Interesados';

                  const cp = cuposCalc.find((c) => c.g === p.c);
                  const cupoOk = !!cp && cp.d > 0;

                  return (
                    <div key={p.id} className="sr" style={{ gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.5fr .4fr' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: C.text }}>{p.s}</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>
                          {p.id}{p.note ? ` · ${p.note}` : ''}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: 12 }}>{p.c}</div>
                        <div style={{ fontSize: 10, color: C.textMuted }}>{p.t}</div>
                      </div>

                      <div>
                        <span className="pl" style={{ background: SC[p.st] + '18', color: SC[p.st] }}>
                          {p.st}
                        </span>
                      </div>

                      <div style={{ fontSize: 11, color: C.textSec }}>{p.n || p.m || '-'}</div>

                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {nextActive && (
                          <button
                            className="bt"
                            style={{
                              padding: '4px 10px',
                              fontSize: 11,
                              background: C.tertiaryBg,
                              color: C.tertiaryDark,
                              border: `1px solid ${C.tertiary}`,
                            }}
                            onClick={() => advance(p, nextActive)}
                          >
                            {nextActive === 'Contactados' ? 'Contactar' : 'Interesado'}
                          </button>
                        )}

                        {canClose && (
                          <button
                            className="bt"
                            style={{
                              padding: '4px 10px',
                              fontSize: 11,
                              background: cupoOk ? C.primaryLight : C.secondaryLight,
                              color: cupoOk ? C.primaryDark : C.textMuted,
                              border: `1px solid ${cupoOk ? C.primary : C.border}`,
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
                              padding: '4px 10px',
                              fontSize: 11,
                              background: C.dangerLight,
                              color: C.danger,
                              border: '1px solid #fecaca',
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
                              padding: '4px 10px',
                              fontSize: 11,
                              background: C.secondaryLight,
                              color: C.textSec,
                              border: `1px solid ${C.border}`,
                            }}
                            onClick={() => advance(p, 'Prospectos')}
                          >
                            Reactivar
                          </button>
                        )}

                        {p.st === 'Cerrados' && (
                          <button
                            className="bt"
                            style={{
                              padding: '4px 10px',
                              fontSize: 11,
                              background: C.primaryLight,
                              color: C.primaryDark,
                              border: `1px solid ${C.primary}`,
                              cursor: 'pointer',
                            }}
                            onClick={() => handleClosedClick(p)}
                          >
                            → Cobros
                          </button>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        <span className="edit" onClick={() => { setForm({ ...p, _origId: p.id }); setModal({ type: 'editProspect' }); }}>
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
                  <div style={{ padding: 24, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                    No hay prospectos con estos filtros
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════ COBROS TAB ═══════════════ */}
        {tab === 'sellers' && (
          <div className="fi">
            {/* KPIs de cobro */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              {[
                { l: 'Total Sellers', v: kpi.tot, c: C.tertiaryDark, bg: C.tertiaryBg },
                { l: 'Activos', v: kpi.act, c: C.primary, bg: C.primaryLight },
                { l: 'En Pausa', v: kpi.pausa, c: C.warning, bg: C.warningLight },
                { l: 'Fugas', v: kpi.fug, c: C.danger, bg: C.dangerLight },
                { l: 'Revenue Mensual', v: fmt(kpi.totalRevenue), c: C.primary, bg: C.primaryLight },
                { l: 'Ticket Promedio', v: fmt(kpi.avgTicket), c: C.purple, bg: C.purpleLight },
              ].map((k, i) => (
                <div key={i} className="kc" style={{ borderTop: `3px solid ${k.c}` }}>
                  <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>
                    {k.l}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: k.c }}>{k.v}</div>
                </div>
              ))}
            </div>

            <div className="cd" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                style={{
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderBottom: `1px solid ${C.border}`,
                  background: C.bgAlt,
                }}
              >
                <span style={{ fontSize: 14, color: C.textSec, fontWeight: 600 }}>
                  Sellers en Cobros ({sellers.length})
                </span>

                <button
                  className="add-btn"
                  onClick={() => {
                    setForm({
                      sec: CATEGORIAS[0],
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
                  gridTemplateColumns: '2fr 1.2fr .8fr .8fr .7fr .7fr .7fr .4fr',
                  background: C.bgAlt,
                  cursor: 'default',
                  fontSize: 11,
                  color: C.textMuted,
                  textTransform: 'uppercase',
                  borderBottom: `2px solid ${C.border}`,
                  fontWeight: 600,
                }}
              >
                <div>Seller</div><div>Sección</div><div>Status</div>
                <div>Tipo</div><div>Tarifa</div><div>Dcto</div><div>Min</div><div />
              </div>

              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {sellers.map((s, i) => (
                  <div
                    key={i}
                    className="sr"
                    style={{
                      gridTemplateColumns: '2fr 1.2fr .8fr .8fr .7fr .7fr .7fr .4fr',
                      cursor: 'pointer',
                      background: selS?.sid === s.sid ? C.primaryLight : undefined,
                    }}
                    onClick={() => setSelS(selS?.sid === s.sid ? null : s)}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.seller}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>{s.sid} · {s.cont}</div>
                    </div>

                    <div style={{ fontSize: 12, color: C.textSec }}>{s.sec}</div>

                    <div>
                      <span className="pl" style={{ background: stC(s.status) + '18', color: stC(s.status) }}>
                        {s.status}
                      </span>
                    </div>

                    <div style={{ fontSize: 12 }}>{s.tipo}</div>
                    <div style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>{fmt(s.tarifa)}</div>
                    <div style={{ fontSize: 12, color: s.dcto > 0 ? C.purple : C.textMuted }}>
                      {s.dcto > 0 ? `${s.dcto}m` : '-'}
                    </div>
                    <div style={{ fontSize: 12 }}>{s.min}m</div>

                    <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                      <span className="edit" onClick={() => { setForm({ ...s, _origSid: s.sid }); setModal({ type: 'editSeller' }); }}>
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
              <div className="cd fi" style={{ marginTop: 14 }}>
                <h3 style={{ margin: '0 0 6px', color: C.primary, fontSize: 16, fontWeight: 700 }}>
                  {selS.seller}
                </h3>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 10 }}>
                  {selS.sid} · {selS.cont} · {selS.mail} · Contratado: {selS.fContrato || 'N/A'}
                  {selS.fTermino ? ` · Término: ${selS.fTermino}` : ''}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, fontSize: 12 }}>
                  {[
                    ['Sección', selS.sec],
                    ['KAM', selS.kam],
                    ['Plan', selS.tipo],
                    ['Tarifa', fmtFull(selS.tarifa), C.primary],
                    ['Dcto', `${selS.dcto}m`, C.purple],
                    ['Mínimo', `${selS.min}m`],
                    ['Status', selS.status, stC(selS.status)],
                  ].map(([label, val, clr], i) => (
                    <div key={i}>
                      <span style={{ color: C.textMuted }}>{label}:</span>{' '}
                      <span style={{ color: (clr as string) || C.text, fontWeight: 600 }}>{val as any}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ DASHBOARD TAB ═══════════════ */}
        {tab === 'dashboard' && (
          <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Row 1: Main KPIs */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { l: 'Revenue Mensual', v: fmt(kpi.totalRevenue), c: C.primary, bg: C.primaryLight },
                { l: 'Sellers Activos', v: kpi.act, c: C.primary, bg: C.primaryLight },
                { l: 'Ticket Promedio', v: fmt(kpi.avgTicket), c: C.purple, bg: C.purpleLight },
                { l: 'En Dcto', v: kpi.enDcto, c: C.warning, bg: C.warningLight },
                { l: 'Pipeline', v: kpi.pipe, c: C.tertiaryDark, bg: C.tertiaryBg },
                { l: 'Fugas', v: kpi.fug, c: C.danger, bg: C.dangerLight },
              ].map((k, i) => (
                <div key={i} className="kc" style={{ borderTop: `3px solid ${k.c}` }}>
                  <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>
                    {k.l}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: k.c }}>{k.v}</div>
                </div>
              ))}
            </div>

            {/* Row 2: Revenue breakdown + Plan/Status distribution */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              {/* Revenue by category */}
              <div className="cd">
                <h3 style={{ margin: '0 0 12px', fontSize: 14, color: C.textSec, fontWeight: 600 }}>Ingresos por Categoría</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={revByCategory}>
                    <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmt(v)} />
                    <Tooltip
                      contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }}
                      formatter={(v: any) => fmtFull(Number(v))}
                    />
                    <Bar dataKey="revenue" radius={[6, 6, 0, 0]} fill={C.primary} fillOpacity={0.8} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Plan distribution */}
              <div className="cd">
                <h3 style={{ margin: '0 0 12px', fontSize: 14, color: C.textSec, fontWeight: 600 }}>Distribución por Plan</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={planDist}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, value }: any) => `${name}: ${value}`}
                      labelLine={{ stroke: C.textMuted }}
                    >
                      {planDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 4 }}>
                  <div style={{ fontSize: 11 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.primary, marginRight: 4 }} />
                    Full: {fmt(kpi.revFull)}
                  </div>
                  <div style={{ fontSize: 11 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: C.purple, marginRight: 4 }} />
                    Premium: {fmt(kpi.revPremium)}
                  </div>
                </div>
              </div>

              {/* Status distribution */}
              <div className="cd">
                <h3 style={{ margin: '0 0 12px', fontSize: 14, color: C.textSec, fontWeight: 600 }}>Status Sellers</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={statusDist}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, value }: any) => `${name}: ${value}`}
                      labelLine={{ stroke: C.textMuted }}
                    >
                      {statusDist.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 4 }}>
                  {statusDist.map(d => (
                    <div key={d.name} style={{ fontSize: 11 }}>
                      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: d.fill, marginRight: 4 }} />
                      {d.name}: {d.value}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 3: Funnel + Sellers by section */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="cd">
                <h3 style={{ margin: '0 0 12px', fontSize: 14, color: C.textSec, fontWeight: 600 }}>Funnel de Prospección</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={funnel}>
                    <XAxis dataKey="name" tick={{ fill: C.textSec, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {funnel.map((e, i) => <Cell key={i} fill={e.fill} fillOpacity={0.85} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="cd">
                <h3 style={{ margin: '0 0 12px', fontSize: 14, color: C.textSec, fontWeight: 600 }}>Sellers por Categoría</h3>
                {CATEGORIAS.map((cat) => {
                  const count = sellers.filter((s) => s.sec === cat).length;
                  const activos = sellers.filter(s => s.sec === cat && s.status === 'Iniciado').length;
                  const rev = sellers
                    .filter(s => s.sec === cat && s.status === 'Iniciado')
                    .reduce((sum, s) => sum + s.tarifa, 0);

                  return (
                    <div key={cat} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: C.text, fontWeight: 600 }}>{cat}</span>
                        <span style={{ color: C.textMuted, fontSize: 11 }}>
                          {count} sellers · {activos} activos · {fmt(rev)}
                        </span>
                      </div>

                      <div className="bg" style={{ maxWidth: '100%' }}>
                        <div
                          className="bf"
                          style={{
                            width: `${sellers.length > 0 ? (count / sellers.length) * 100 : 0}%`,
                            background: C.primary,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Row 4: Revenue detail table */}
            <div className="cd" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.bgAlt }}>
                <h3 style={{ margin: 0, fontSize: 14, color: C.textSec, fontWeight: 600 }}>
                  Detalle de Cobros — Sellers Activos
                </h3>
              </div>

              <div
                className="sr"
                style={{
                  gridTemplateColumns: '2fr 1.2fr .8fr 1fr .7fr .7fr .8fr',
                  background: C.bgAlt,
                  cursor: 'default',
                  fontSize: 11,
                  color: C.textMuted,
                  textTransform: 'uppercase',
                  borderBottom: `2px solid ${C.border}`,
                  fontWeight: 600,
                }}
              >
                <div>Seller</div><div>Categoría</div><div>Plan</div>
                <div>Tarifa Neto</div><div>Dcto</div><div>Min</div><div>F. Contrato</div>
              </div>

              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {sellers.filter(s => s.status === 'Iniciado').map((s, i) => (
                  <div
                    key={i}
                    className="sr"
                    style={{
                      gridTemplateColumns: '2fr 1.2fr .8fr 1fr .7fr .7fr .8fr',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.seller}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>{s.sid}</div>
                    </div>

                    <div style={{ fontSize: 12 }}>{s.sec}</div>

                    <div>
                      <span
                        className="pl"
                        style={{
                          background: s.tipo === 'Premium' ? C.purpleLight : C.primaryLight,
                          color: s.tipo === 'Premium' ? C.purple : C.primaryDark,
                        }}
                      >
                        {s.tipo}
                      </span>
                    </div>

                    <div style={{ fontSize: 13, color: C.primary, fontWeight: 700 }}>{fmtFull(s.tarifa)}</div>

                    <div style={{ fontSize: 12, color: s.dcto > 0 ? C.purple : C.textMuted }}>
                      {s.dcto > 0 ? `${s.dcto}m` : '-'}
                    </div>

                    <div style={{ fontSize: 12 }}>{s.min}m</div>

                    <div style={{ fontSize: 12, color: C.textSec }}>{s.fContrato || '-'}</div>
                  </div>
                ))}

                {sellers.filter(s => s.status === 'Iniciado').length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
                    No hay sellers activos
                  </div>
                )}
              </div>

              {/* Total row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.2fr .8fr 1fr .7fr .7fr .8fr',
                  padding: '12px 14px',
                  background: C.primaryLight,
                  borderTop: `2px solid ${C.primary}`,
                  fontSize: 13,
                  fontWeight: 700,
                  color: C.primaryDark,
                }}
              >
                <div>TOTAL</div>
                <div>{sellers.filter(s => s.status === 'Iniciado').length} sellers</div>
                <div />
                <div>{fmtFull(kpi.totalRevenue)}</div>
                <div>{kpi.enDcto} en dcto</div>
                <div />
                <div />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}