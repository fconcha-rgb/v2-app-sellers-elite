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

import { useEffect, useMemo, useState, useCallback, memo, type ReactNode } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';

/* ──────────────────────────────────────────────────────────────
  TYPES
────────────────────────────────────────────────────────────── */
type ProspectStage = 'Prospectos' | 'Contactados' | 'Interesados' | 'No Interesado' | 'Cerrados';
type SellerStatus = 'Iniciado' | 'Pausa' | 'Fuga';
type SellerPlan = 'Full' | 'Premium' | 'Basico';
type ViewMode = 'monthly' | 'ytd';
type Tab = 'dashboard' | 'sellers' | 'hunting';
type SortDir = 'asc' | 'desc';
type SortConfig = { key: string; dir: SortDir };

const CATEGORIAS = ['Electro', 'Muebles/Hogar', 'Cat Dig', 'Moda', 'Belleza/Calzado'] as const;
type Categoria = (typeof CATEGORIAS)[number];

type Prospect = {
  id: string;
  s: string;
  st: ProspectStage;
  t: string;
  c: Categoria;
  n: string;
  m: string;
  tel: string;
  note: string;
};

type CustomDctos = Record<string, number>;

type Seller = {
  sec: Categoria;
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
  customDctos: CustomDctos;
};

type Cupo = { g: Categoria; e: string; u: number; d: number };

type Modal =
  | null
  | { type: 'addProspect' }
  | { type: 'editProspect' }
  | { type: 'close'; data: Prospect }
  | { type: 'addSeller' }
  | { type: 'editSeller' }
  | { type: 'editCupos' }
  | { type: 'editMonthCharge'; data: { seller: Seller; monthIdx: number; year: number } };

type Toast = null | { msg: string; ok: boolean };

/* ──────────────────────────────────────────────────────────────
  CONSTS
────────────────────────────────────────────────────────────── */
const KAM_POR_CATEGORIA: Record<Categoria, string> = {
  Electro: 'Rosario Fernandez',
  'Muebles/Hogar': 'TBD - Hogar',
  'Cat Dig': 'Trinidad Santa Maria',
  Moda: 'Maria Paz Fuentes',
  'Belleza/Calzado': 'Macarena Meneses',
};

const MAX_CUPOS = 12;
const DISCOUNT_RATE = 0.424412189118071;
const STAGES: ProspectStage[] = ['Prospectos', 'Contactados', 'Interesados', 'No Interesado', 'Cerrados'];
const ACTIVE_STAGES: ProspectStage[] = ['Prospectos', 'Contactados', 'Interesados'];
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const;

type MonthShort = (typeof MONTHS_SHORT)[number];

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth();
const PLAN_TYPES: SellerPlan[] = ['Full', 'Premium', 'Basico'];

const C = {
  bg: '#F8F9FB',
  bgCard: '#FFFFFF',
  bgAlt: '#F1F3F6',
  bgDark: '#E8ECF0',
  border: '#E5E8EC',
  borderLight: '#EEF0F3',
  text: '#1B1F24',
  textSec: '#5A6473',
  textMuted: '#8E96A3',
  primary: '#16A34A',
  primaryLight: '#DCFCE7',
  primaryDark: '#15803D',
  primaryBg: '#F0FDF4',
  secondary: '#64748B',
  secondaryLight: '#F1F5F9',
  tertiary: '#3B82F6',
  tertiaryLight: '#DBEAFE',
  tertiaryBg: '#EFF6FF',
  danger: '#EF4444',
  dangerLight: '#FEE2E2',
  warning: '#F59E0B',
  warningLight: '#FEF9C3',
  warningBg: '#FFFBEB',
  purple: '#7C3AED',
  purpleLight: '#EDE9FE',
  basico: '#0EA5E9',
  basicoLight: '#E0F2FE',
};

const SC: Record<ProspectStage, string> = {
  Prospectos: C.secondary,
  Contactados: C.tertiary,
  Interesados: C.warning,
  'No Interesado': C.danger,
  Cerrados: C.primary,
};

const PLAN_COLORS: Record<SellerPlan, string> = { Full: C.primary, Premium: C.purple, Basico: C.basico };
const PLAN_COLORS_LIGHT: Record<SellerPlan, string> = {
  Full: '#86EFAC',
  Premium: '#C4B5FD',
  Basico: '#7DD3FC',
};

const fmt = (n: number) => {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
};
const fmtFull = (n: number) => '$' + n.toLocaleString('es-CL');

const stC = (s: SellerStatus) => (s === 'Fuga' ? C.danger : s === 'Pausa' ? C.warning : C.primary);
const planC = (p: SellerPlan) => PLAN_COLORS[p] || C.secondary;
const mkKey = (year: number, mIdx: number) => year + '-' + String(mIdx + 1).padStart(2, '0');

type ChargeInfo = {
  amount: number;
  isDiscount: boolean;
  active: boolean;
  isCustom: boolean;
  isProrated: boolean;
};

const getMonthlyCharge = (seller: Seller, mIdx: number, year: number = CURRENT_YEAR): ChargeInfo => {
  const mk = mkKey(year, mIdx);
  const customAmt = seller.customDctos ? seller.customDctos[mk] : undefined;

  if (seller.status === 'Pausa')
    return { amount: 0, isDiscount: false, active: false, isCustom: false, isProrated: false };

  if (!seller.fContrato) {
    if (seller.status === 'Fuga')
      return { amount: 0, isDiscount: false, active: false, isCustom: false, isProrated: false };
    if (customAmt != null)
      return {
        amount: customAmt,
        isDiscount: customAmt < seller.tarifa,
        active: true,
        isCustom: true,
        isProrated: false,
      };
    const isD = seller.dcto > 0 && mIdx < seller.dcto;
    return {
      amount: isD ? Math.round(seller.tarifa * DISCOUNT_RATE) : seller.tarifa,
      isDiscount: isD,
      active: true,
      isCustom: false,
      isProrated: false,
    };
  }

  const cd = new Date(seller.fContrato);
  const cm = cd.getFullYear() * 12 + cd.getMonth();
  const tm = year * 12 + mIdx;
  if (tm < cm) return { amount: 0, isDiscount: false, active: false, isCustom: false, isProrated: false };

  if (seller.status === 'Fuga') {
    if (!seller.fTermino) return { amount: 0, isDiscount: false, active: false, isCustom: false, isProrated: false };
    const td = new Date(seller.fTermino);
    const terminoM = td.getFullYear() * 12 + td.getMonth();
    if (tm > terminoM) return { amount: 0, isDiscount: false, active: false, isCustom: false, isProrated: false };

    if (tm === terminoM) {
      const dim = new Date(year, mIdx + 1, 0).getDate();
      const ad = td.getDate();
      const pr = ad / dim;

      if (customAmt != null) {
        return {
          amount: Math.round(customAmt * pr),
          isDiscount: true,
          active: true,
          isCustom: true,
          isProrated: true,
        };
      }

      const ms = tm - cm;
      const origD = seller.dcto > 0 && ms < seller.dcto;
      const base = origD ? Math.round(seller.tarifa * DISCOUNT_RATE) : seller.tarifa;

      return { amount: Math.round(base * pr), isDiscount: true, active: true, isCustom: false, isProrated: true };
    }
  }

  if (customAmt != null)
    return { amount: customAmt, isDiscount: customAmt < seller.tarifa, active: true, isCustom: true, isProrated: false };

  const ms2 = tm - cm;
  const origD2 = seller.dcto > 0 && ms2 < seller.dcto;
  return {
    amount: origD2 ? Math.round(seller.tarifa * DISCOUNT_RATE) : seller.tarifa,
    isDiscount: origD2,
    active: true,
    isCustom: false,
    isProrated: false,
  };
};

/* ──────────────────────────────────────────────────────────────
  MAPPERS
────────────────────────────────────────────────────────────── */
const mapProspect = (r: any): Prospect => ({
  id: String(r.id ?? ''),
  s: String(r.seller ?? ''),
  st: (r.status as ProspectStage) ?? 'Prospectos',
  t: String(r.tipo ?? ''),
  c: (r.categoria as Categoria) ?? CATEGORIAS[0],
  n: String(r.nombre ?? ''),
  m: String(r.mail ?? ''),
  tel: String(r.tel ?? ''),
  note: String(r.note ?? ''),
});

const mapSeller = (r: any): Seller => {
  let cd: CustomDctos = {};
  if (r.custom_dctos) {
    try {
      cd = typeof r.custom_dctos === 'string' ? JSON.parse(r.custom_dctos) : r.custom_dctos;
    } catch {
      cd = {};
    }
  }
  return {
    sec: (r.seccion as Categoria) ?? CATEGORIAS[0],
    kam: String(r.kam ?? '-'),
    seller: String(r.seller ?? ''),
    sid: String(r.sid ?? ''),
    cont: String(r.contacto ?? ''),
    mail: String(r.mail ?? ''),
    status: (r.status as SellerStatus) ?? 'Iniciado',
    tipo: (r.tipo as SellerPlan) ?? 'Full',
    tarifa: Number(r.tarifa ?? 0),
    fContrato: String(r.f_contrato ?? ''),
    fTermino: String(r.f_termino ?? ''),
    dcto: Number(r.dcto ?? 0),
    min: Number(r.min_meses ?? 0),
    customDctos: cd,
  };
};

const mapCupo = (r: any): Cupo => ({
  g: (r.gerencia as Categoria) ?? CATEGORIAS[0],
  e: String(r.encargado ?? ''),
  u: Number(r.usados ?? 0),
  d: Number(r.disponibles ?? 0),
});

const sortData = <T,>(data: T[], config: SortConfig): T[] =>
  data.slice().sort((a: any, b: any) => {
    let va = a[config.key];
    let vb = b[config.key];
    if (va == null) va = '';
    if (vb == null) vb = '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (typeof va === 'number' && typeof vb === 'number') return config.dir === 'asc' ? va - vb : vb - va;
    if (va < vb) return config.dir === 'asc' ? -1 : 1;
    if (va > vb) return config.dir === 'asc' ? 1 : -1;
    return 0;
  });

/* ──────────────────────────────────────────────────────────────
  UI COMPONENTS
────────────────────────────────────────────────────────────── */
const FormField = memo(function FormField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  opts?: readonly string[] | string[];
  w?: string;
}) {
  return (
    <div style={{ flex: props.w || '1 1 200px' }}>
      <label
        style={{
          fontSize: 11,
          color: C.textMuted,
          display: 'block',
          marginBottom: 4,
          fontWeight: 600,
          letterSpacing: '0.3px',
          textTransform: 'uppercase',
        }}
      >
        {props.label}
      </label>

      {props.opts ? (
        <select
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          style={{
            width: '100%',
            background: '#fff',
            border: '1.5px solid ' + C.border,
            color: C.text,
            padding: '9px 12px',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          <option value="" disabled hidden>
            {props.label}
          </option>
          {props.opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={props.type || 'text'}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: '#fff',
            border: '1.5px solid ' + C.border,
            color: C.text,
            padding: '9px 12px',
            borderRadius: 8,
            fontSize: 13,
          }}
          placeholder={props.label}
        />
      )}
    </div>
  );
});

const Pill = (props: { color: string; children: ReactNode }) => (
  <span
    style={{
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 700,
      display: 'inline-block',
      background: props.color + '15',
      color: props.color,
    }}
  >
    {props.children}
  </span>
);

const KpiCard = (props: { label: string; value: string | number; color: string; sub?: ReactNode }) => (
  <div
    style={{
      background: C.bgCard,
      borderRadius: 12,
      padding: '16px 18px',
      flex: '1 1 140px',
      minWidth: 130,
      borderLeft: '4px solid ' + props.color,
      boxShadow: '0 1px 3px rgba(0,0,0,.05)',
      border: '1px solid ' + C.borderLight,
    }}
  >
    <div
      style={{
        fontSize: 10,
        color: C.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '.6px',
        fontWeight: 700,
        marginBottom: 6,
      }}
    >
      {props.label}
    </div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: props.color, lineHeight: 1 }}>{props.value}</div>
      {props.sub}
    </div>
  </div>
);

const SortHeader = (props: { label: string; sortKey: string; current: SortConfig; onSort: (k: string) => void }) => {
  const active = props.current.key === props.sortKey;
  return (
    <div
      style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 2 }}
      onClick={() => props.onSort(props.sortKey)}
    >
      {props.label}
      <span style={{ fontSize: 8, color: active ? C.primary : C.textMuted }}>
        {active ? (props.current.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </span>
    </div>
  );
};

const ViewToggle = (props: { mode: ViewMode; onChange: (m: ViewMode) => void }) => (
  <div style={{ display: 'flex', gap: 2, background: C.bgDark, padding: 2, borderRadius: 8 }}>
    {([
      ['monthly', 'Mes en curso'],
      ['ytd', 'Acumulado YTD'],
    ] as [ViewMode, string][]).map(([k, l]) => (
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
          background: props.mode === k ? C.primary : 'transparent',
          color: props.mode === k ? '#fff' : C.textSec,
          transition: 'all .15s',
        }}
      >
        {l}
      </button>
    ))}
  </div>
);

const CSS_STYLES =
  "@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');" +
  '@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}' +
  '@keyframes si{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}' +
  '@keyframes spin{to{transform:rotate(360deg)}}' +
  '*{box-sizing:border-box} .fi{animation:fi .3s ease-out}.si{animation:si .2s ease-out}' +
  'select,input{background:#fff;border:1.5px solid #E5E8EC;color:#1B1F24;padding:8px 12px;border-radius:8px;font-size:13px;outline:none;font-family:inherit;transition:border-color .2s}' +
  'select:focus,input:focus{border-color:#16A34A;box-shadow:0 0 0 3px #DCFCE7}' +
  '::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#E8ECF0;border-radius:3px}' +
  '.row-hover{transition:background .12s}.row-hover:hover{background:#F1F3F6}' +
  '.btn{padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .15s;font-family:inherit}' +
  '.btn:hover{transform:translateY(-1px)}.btn:active{transform:scale(.98)}' +
  '.btn-primary{background:#16A34A;color:#fff;box-shadow:0 2px 8px rgba(22,163,74,.2)}.btn-primary:hover{box-shadow:0 4px 14px rgba(22,163,74,.3)}' +
  '.btn-ghost{background:#F1F5F9;color:#5A6473}.btn-sm{padding:4px 10px;font-size:11px;border-radius:6px}' +
  '.card{background:#FFFFFF;border:1px solid #EEF0F3;border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.04)}' +
  '.action-icon{color:#8E96A3;cursor:pointer;transition:color .15s;font-size:14px;padding:2px 4px;border-radius:4px}.action-icon:hover{color:#16A34A}.del-icon:hover{color:#EF4444!important}' +
  '.month-cell{cursor:pointer;transition:background .15s;border-radius:4px}.month-cell:hover{filter:brightness(0.92)}';

/* ──────────────────────────────────────────────────────────────
  DASHBOARD TYPES
────────────────────────────────────────────────────────────── */
type MonthlyRow = { name: MonthShort; idx: number } & Record<SellerPlan, number> & { total: number };

type GroupedByCat = {
  cat: Categoria;
  sellers: Seller[];
  monthTotals: number[];
  yearTotal: number;
  planBreakdown: Record<SellerPlan, { count: number; sellers: Seller[] }>;
};

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [cupos, setCupos] = useState<Cupo[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);

  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<Toast>(null);

  const [fCat, setFCat] = useState<'Todos' | Categoria>('Todos');
  const [fSt, setFSt] = useState<'Todos' | ProspectStage>('Todos');
  const [q, setQ] = useState('');

  const [selS, setSelS] = useState<Seller | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const [huntSort, setHuntSort] = useState<SortConfig>({ key: 's', dir: 'asc' });
  const [sellSort, setSellSort] = useState<SortConfig>({ key: 'seller', dir: 'asc' });

  const [sCatF, setSCatF] = useState<'Todos' | Categoria>('Todos');
  const [sStatusF, setSStatusF] = useState<'Todos' | SellerStatus>('Todos');
  const [sPlanF, setSPlanF] = useState<'Todos' | SellerPlan>('Todos');
  const [sQ, setSQ] = useState('');

  const [dashView, setDashView] = useState<ViewMode>('monthly');

  // Collapsible table states: FULL y PREMIUM por separado
  const [expandedCatsFull, setExpandedCatsFull] = useState<Partial<Record<Categoria, boolean>>>({});
  const [expandedCatsPremium, setExpandedCatsPremium] = useState<Partial<Record<Categoria, boolean>>>({});

  const toggleCatFull = useCallback((cat: Categoria) => {
    setExpandedCatsFull((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  const toggleCatPremium = useCallback((cat: Categoria) => {
    setExpandedCatsPremium((prev) => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  const expandAllFull = useCallback(() => {
    const all: Partial<Record<Categoria, boolean>> = {};
    CATEGORIAS.forEach((c) => (all[c] = true));
    setExpandedCatsFull(all);
  }, []);

  const collapseAllFull = useCallback(() => setExpandedCatsFull({}), []);

  const expandAllPremium = useCallback(() => {
    const all: Partial<Record<Categoria, boolean>> = {};
    CATEGORIAS.forEach((c) => (all[c] = true));
    setExpandedCatsPremium(all);
  }, []);

  const collapseAllPremium = useCallback(() => setExpandedCatsPremium({}), []);

  // ✅ FIX CRÍTICO: updateForm debe usar [key], no "value"
  const updateForm = useCallback((key: string, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const show = useCallback((msg: string, ok: boolean = true) => {
    setToast({ msg, ok });
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const toggleSort = (setter: (v: SortConfig) => void, cur: SortConfig, key: string) =>
    setter({ key, dir: cur.key === key && cur.dir === 'asc' ? 'desc' : 'asc' });

  /* ──────────────────────────────────────────────────────────────
    REFRESH (SUPABASE REAL via ./api)
  ────────────────────────────────────────────────────────────── */
  const refreshAll = useCallback(async () => {
    const [p, s, c] = await Promise.all([fetchProspects(), fetchSellers(), fetchCupos()]);

    // Si tu ./api retorna {data, error}, esto mantiene el comportamiento anterior
    if ((p as any).error) show((p as any).error.message ?? 'Error cargando prospects', false);
    if ((s as any).error) show((s as any).error.message ?? 'Error cargando sellers', false);
    if ((c as any).error) show((c as any).error.message ?? 'Error cargando cupos', false);

    setProspects(((p as any).data || []).map(mapProspect));
    setSellers(((s as any).data || []).map(mapSeller));
    setCupos(((c as any).data || []).map(mapCupo));
  }, [show]);

  useEffect(() => {
    refreshAll().then(() => setReady(true));
  }, [refreshAll]);

  /* ──────────────────────────────────────────────────────────────
    COMPUTED
  ────────────────────────────────────────────────────────────── */
  const filt = useMemo(
    () =>
      sortData(
        prospects.filter((p) => {
          if (fCat !== 'Todos' && p.c !== fCat) return false;
          if (fSt !== 'Todos' && p.st !== fSt) return false;
          if (q && !p.s.toLowerCase().includes(q.toLowerCase())) return false;
          return true;
        }),
        huntSort
      ),
    [prospects, fCat, fSt, q, huntSort]
  );

  const funnel = useMemo(
    () => STAGES.map((s) => ({ name: s, count: prospects.filter((p) => p.st === s).length, fill: SC[s] })),
    [prospects]
  );

  const cuposCalc = useMemo(
    () =>
      CATEGORIAS.map((cat) => {
        const dbRow = cupos.find((c) => c.g === cat);
        const u = sellers.filter((s) => s.sec === cat && s.status !== 'Fuga').length;
        return { g: cat, e: dbRow?.e || KAM_POR_CATEGORIA[cat] || '-', u, d: Math.max(0, MAX_CUPOS - u) };
      }),
    [cupos, sellers]
  );

  const filteredSellers = useMemo(
    () =>
      sortData(
        sellers.filter((s) => {
          if (sCatF !== 'Todos' && s.sec !== sCatF) return false;
          if (sStatusF !== 'Todos' && s.status !== sStatusF) return false;
          if (sPlanF !== 'Todos' && s.tipo !== sPlanF) return false;
          if (
            sQ &&
            !s.seller.toLowerCase().includes(sQ.toLowerCase()) &&
            !s.sid.toLowerCase().includes(sQ.toLowerCase())
          )
            return false;
          return true;
        }),
        sellSort
      ),
    [sellers, sCatF, sStatusF, sPlanF, sQ, sellSort]
  );

  const activeSellers = useMemo(() => sellers.filter((s) => s.status === 'Iniciado'), [sellers]);
  const revenueSellers = useMemo(
    () => sellers.filter((s) => s.status === 'Iniciado' || (s.status === 'Fuga' && s.fTermino)),
    [sellers]
  );
  const byPlan = (arr: Seller[], plan: SellerPlan) => arr.filter((s) => s.tipo === plan);

  const monthlyBreakdown = useMemo<MonthlyRow[]>(
    () =>
      MONTHS_SHORT.map((name, mi) => {
        const r: MonthlyRow = { name, idx: mi, Full: 0, Premium: 0, Basico: 0, total: 0 };
        PLAN_TYPES.forEach((p) => {
          r[p] = byPlan(revenueSellers, p).reduce((sum, s) => sum + getMonthlyCharge(s, mi).amount, 0);
        });
        r.total = PLAN_TYPES.reduce((sum, p) => sum + (r[p] || 0), 0);
        return r;
      }),
    [revenueSellers]
  );

  const ytdRev = useMemo(
    () => monthlyBreakdown.slice(0, CURRENT_MONTH + 1).reduce((s, m) => s + m.total, 0),
    [monthlyBreakdown]
  );
  const projectedRev = useMemo(() => monthlyBreakdown.reduce((s, m) => s + m.total, 0), [monthlyBreakdown]);

  const kpi = useMemo(() => {
    const pausa = sellers.filter((s) => s.status === 'Pausa').length;
    const fug = sellers.filter((s) => s.status === 'Fuga').length;
    const pipe = prospects.filter((p) => ACTIVE_STAGES.includes(p.st)).length;
    const cerr = prospects.filter((p) => p.st === 'Cerrados').length;
    const noInt = prospects.filter((p) => p.st === 'No Interesado').length;
    const cupD = cuposCalc.reduce((a, c) => a + c.d, 0);
    const totalTarifa = activeSellers.reduce((s, sl) => s + sl.tarifa, 0);

    const planCounts: Record<SellerPlan, number> = { Full: 0, Premium: 0, Basico: 0 };
    const planRevs: Record<SellerPlan, number> = { Full: 0, Premium: 0, Basico: 0 };
    PLAN_TYPES.forEach((p) => {
      planCounts[p] = byPlan(activeSellers, p).length;
      planRevs[p] = byPlan(activeSellers, p).reduce((s, sl) => s + sl.tarifa, 0);
    });

    return {
      tot: sellers.length,
      act: activeSellers.length,
      planCounts,
      planRevs,
      pausa,
      fug,
      pipe,
      cerr,
      noInt,
      cupD,
      ytdRev,
      projectedRev,
      currentMonthRev: monthlyBreakdown[CURRENT_MONTH]?.total || 0,
      totalTarifa,
      avgTicket: activeSellers.length > 0 ? totalTarifa / activeSellers.length : 0,
      enDcto: activeSellers.filter((s) => s.dcto > 0).length,
    };
  }, [sellers, prospects, cuposCalc, activeSellers, ytdRev, projectedRev, monthlyBreakdown]);

  const revByCategory = useMemo(
    () =>
      CATEGORIAS.map((cat) => ({
        name: cat,
        revenue: activeSellers.filter((s) => s.sec === cat).reduce((sum, s) => sum + s.tarifa, 0),
      })).filter((c) => c.revenue > 0),
    [activeSellers]
  );

  const planRevDist = useMemo(
    () =>
      PLAN_TYPES.map((p) => ({ name: p, value: kpi.planRevs[p] || 0, fill: PLAN_COLORS[p] })).filter(
        (d) => d.value > 0
      ),
    [kpi.planRevs]
  );

  const statusDist = useMemo(
    () =>
      [
        { name: 'Activo', value: kpi.act, fill: C.primary },
        { name: 'Pausa', value: kpi.pausa, fill: C.warning },
        { name: 'Fuga', value: kpi.fug, fill: C.danger },
      ].filter((d) => d.value > 0),
    [kpi]
  );

  const histogramData = useMemo(() => {
    if (dashView === 'monthly') return monthlyBreakdown;
    let cumFull = 0,
      cumPrem = 0,
      cumBasico = 0;
    return monthlyBreakdown.map((m) => {
      cumFull += m.Full || 0;
      cumPrem += m.Premium || 0;
      cumBasico += m.Basico || 0;
      return { ...m, Full: cumFull, Premium: cumPrem, Basico: cumBasico, total: cumFull + cumPrem + cumBasico };
    });
  }, [monthlyBreakdown, dashView]);

  // ── Grouped data FULL (solo sellers Full)
  const groupedFullByCat = useMemo<GroupedByCat[]>(() => {
    return CATEGORIAS.map((cat) => {
      const catSellers = revenueSellers.filter((s) => s.sec === cat && s.tipo === 'Full');
      const monthTotals = MONTHS_SHORT.map((_, mi) => catSellers.reduce((sum, s) => sum + getMonthlyCharge(s, mi).amount, 0));
      const yearTotal = monthTotals.reduce((a, b) => a + b, 0);

      const planBreakdown: GroupedByCat['planBreakdown'] = {
        Full: { count: catSellers.length, sellers: catSellers },
        Premium: { count: 0, sellers: [] },
        Basico: { count: 0, sellers: [] },
      };

      return { cat, sellers: catSellers, monthTotals, yearTotal, planBreakdown };
    }).filter((g) => g.sellers.length > 0);
  }, [revenueSellers]);

  // ── Grouped data PREMIUM (solo sellers Premium)
  const groupedPremiumByCat = useMemo<GroupedByCat[]>(() => {
    return CATEGORIAS.map((cat) => {
      const catSellers = revenueSellers.filter((s) => s.sec === cat && s.tipo === 'Premium');
      const monthTotals = MONTHS_SHORT.map((_, mi) => catSellers.reduce((sum, s) => sum + getMonthlyCharge(s, mi).amount, 0));
      const yearTotal = monthTotals.reduce((a, b) => a + b, 0);

      const planBreakdown: GroupedByCat['planBreakdown'] = {
        Full: { count: 0, sellers: [] },
        Premium: { count: catSellers.length, sellers: catSellers },
        Basico: { count: 0, sellers: [] },
      };

      return { cat, sellers: catSellers, monthTotals, yearTotal, planBreakdown };
    }).filter((g) => g.sellers.length > 0);
  }, [revenueSellers]);

  /* ──────────────────────────────────────────────────────────────
    ACTIONS (SUPABASE via ./api + refreshAll)
  ────────────────────────────────────────────────────────────── */
  const saveProspect = (isNew: boolean) => {
    if (!form.id || !form.s || !form.c) {
      show('Completa ID, Seller y Categoria', false);
      return;
    }

    upsertProspect({
      id: form.id,
      seller: form.s,
      status: isNew ? 'Prospectos' : (form.st || 'Prospectos'),
      tipo: form.t || 'Cartera',
      categoria: form.c,
      nombre: form.n || '',
      mail: form.m || '',
      tel: form.tel || '',
      note: form.note || '',
    }).then((res: any) => {
      if (res.error) {
        show(res.error.message, false);
        return;
      }
      refreshAll().then(() => {
        show(isNew ? 'Prospecto agregado' : 'Prospecto actualizado');
        setModal(null);
      });
    });
  };

  const deleteProspect = (p: Prospect) => {
    if (!window.confirm('Eliminar ' + p.s + '?')) return;
    deleteProspectDB(p.id).then((res: any) => {
      if (res.error) {
        show(res.error.message, false);
        return;
      }
      refreshAll().then(() => show(p.s + ' eliminado'));
    });
  };

  const advance = (p: Prospect, ns: ProspectStage) => {
    if (ns === 'Cerrados') {
      const cp = cuposCalc.find((c) => c.g === p.c);
      if (cp && cp.d <= 0) {
        show('Sin cupos en ' + p.c, false);
        return;
      }
      setForm({ plan: 'Full', tarifa: 990000, dcto: 2, min: 6, sec: p.c });
      setModal({ type: 'close', data: p });
      return;
    }

    updateProspectStatus(p.id, ns).then((res: any) => {
      if (res.error) {
        show(res.error.message, false);
        return;
      }
      refreshAll().then(() => show(p.s + ' -> ' + ns));
    });
  };

  const reverseCerrado = (p: Prospect) => {
    if (!window.confirm(p.s + ': Volver a Interesados?')) return;
    const existing = sellers.find((s) => s.sid === p.id);
    const delP = existing ? deleteSellerDB(existing.sid) : Promise.resolve({ error: null });

    delP
      .then((res: any) => {
        if (res.error) {
          show(res.error.message, false);
          return { error: res.error };
        }
        return updateProspectStatus(p.id, 'Interesados');
      })
      .then((res: any) => {
        if (res && res.error) {
          show(res.error.message, false);
          return;
        }
        refreshAll().then(() => show(p.s + ' revertido'));
      });
  };

  const handleClosedClick = (p: Prospect) => {
    const existing = sellers.find((s) => s.sid === p.id);
    if (existing) {
      setTab('sellers');
      setSelS(existing);
      show(p.s + ' ya esta en Cobros');
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
      kam: KAM_POR_CATEGORIA[p.c] || '-',
    });
    setModal({ type: 'close', data: p });
  };

  const confirmClose = () => {
    if (!modal || modal.type !== 'close') {
      show('Error', false);
      return;
    }
    const p = modal.data;

    const doSeller = () => {
      const cp2 = cuposCalc.find((c) => c.g === p.c);
      const cupoP =
        cp2 && cp2.d > 0 && p.st !== 'Cerrados'
          ? upsertCupo({ gerencia: cp2.g, encargado: cp2.e, usados: cp2.u + 1, disponibles: Math.max(0, cp2.d - 1) })
          : Promise.resolve({ error: null });

      cupoP
        .then(() =>
          upsertSeller({
            sid: form.sid || p.id,
            seller: form.seller || p.s,
            seccion: form.sec || p.c,
            kam: form.kam || KAM_POR_CATEGORIA[p.c] || '-',
            contacto: form.cont || p.n || '',
            mail: form.mail || p.m || '',
            status: 'Iniciado',
            tipo: form.plan || 'Full',
            tarifa: Number(form.tarifa) || 990000,
            f_contrato: new Date().toISOString().slice(0, 10),
            f_termino: null,
            dcto: Number(form.dcto) || 2,
            min_meses: Number(form.min) || 6,
            custom_dctos: {},
          })
        )
        .then((res: any) => {
          if (res.error) {
            show(res.error.message, false);
            return;
          }
          refreshAll().then(() => {
            show(p.s + ' cerrado y en Cobros');
            setModal(null);
          });
        });
    };

    if (p.st !== 'Cerrados') {
      updateProspectStatus(p.id, 'Cerrados').then((res: any) => {
        if (res.error) {
          show(res.error.message, false);
          return;
        }
        doSeller();
      });
    } else {
      doSeller();
    }
  };

  const saveSeller = () => {
    if (!form.seller || !form.sid) {
      show('Completa Seller y Seller ID', false);
      return;
    }

    upsertSeller({
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
      custom_dctos: form.customDctos || {},
    }).then((res: any) => {
      if (res.error) {
        show(res.error.message, false);
        return;
      }
      refreshAll().then(() => {
        show(form._isNew ? 'Seller agregado' : 'Seller actualizado');
        setModal(null);
      });
    });
  };

  const deleteSeller = (s: Seller) => {
    if (!window.confirm('Eliminar ' + s.seller + '?')) return;
    deleteSellerDB(s.sid).then((res: any) => {
      if (res.error) {
        show(res.error.message, false);
        return;
      }
      refreshAll().then(() => show(s.seller + ' eliminado'));
    });
  };

  const saveCupos = () => {
    Promise.all(
      cuposCalc.map((c, i) =>
        upsertCupo({
          gerencia: c.g,
          encargado: c.e,
          usados: Number(form['u' + i] ?? c.u),
          disponibles: Number(form['d' + i] ?? c.d),
        })
      )
    ).then(() =>
      refreshAll().then(() => {
        show('Cupos actualizados');
        setModal(null);
      })
    );
  };

  const saveMonthCharge = () => {
    if (!modal || modal.type !== 'editMonthCharge') return;
    const s = modal.data.seller;
    const mk = mkKey(modal.data.year, modal.data.monthIdx);
    const newD = { ...(s.customDctos || {}) };

    if (form.removeCustom) {
      delete newD[mk];
    } else {
      const amt = Number(form.customAmount);
      if (Number.isNaN(amt) || amt < 0) {
        show('Monto invalido', false);
        return;
      }
      newD[mk] = amt;
    }

    upsertSeller({
      sid: s.sid,
      seller: s.seller,
      seccion: s.sec,
      kam: s.kam,
      contacto: s.cont,
      mail: s.mail,
      status: s.status,
      tipo: s.tipo,
      tarifa: s.tarifa,
      f_contrato: s.fContrato || null,
      f_termino: s.fTermino || null,
      dcto: s.dcto,
      min_meses: s.min,
      custom_dctos: newD,
    }).then((res: any) => {
      if (res.error) {
        show(res.error.message, false);
        return;
      }
      refreshAll().then(() => {
        show('Cobro actualizado');
        setModal(null);
      });
    });
  };

  const rf = (label: string, k: string, opts?: { type?: string; options?: readonly string[] | string[]; w?: string }) => (
    <FormField
      label={label}
      value={String(form[k] ?? '')}
      onChange={(v) => updateForm(k, v)}
      type={opts?.type}
      opts={opts?.options}
      w={opts?.w}
    />
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
          fontFamily: "'DM Sans', system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: 'center', color: C.primary }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: '3px solid ' + C.primaryLight,
              borderTop: '3px solid ' + C.primary,
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Cargando…</span>
        </div>
      </div>
    );
  }

  const StackedBarCell = (planKey: SellerPlan, isFuture: boolean) => {
    const baseColor = PLAN_COLORS[planKey] || C.secondary;
    const lightColor = PLAN_COLORS_LIGHT[planKey] || '#ccc';
    return isFuture ? lightColor : baseColor;
  };

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" }}>
      <style>{CSS_STYLES}</style>

      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            padding: '12px 22px',
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 200,
            animation: 'si .2s ease-out',
            boxShadow: '0 4px 16px rgba(0,0,0,.1)',
            background: toast.ok ? C.primaryLight : C.dangerLight,
            color: toast.ok ? C.primaryDark : C.danger,
            border: '1px solid ' + (toast.ok ? C.primary : C.danger),
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* MODALS */}
      {modal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.4)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}
          onClick={() => setModal(null)}
        >
          <div
            className="si"
            style={{
              background: C.bgCard,
              border: '1px solid ' + C.border,
              borderRadius: 18,
              padding: 28,
              maxWidth: 580,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,.12)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {(modal.type === 'addProspect' || modal.type === 'editProspect') && (
              <>
                <h3 style={{ margin: '0 0 18px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
                  {modal.type === 'addProspect' ? 'Agregar Prospecto' : 'Editar Prospecto'}
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                  {rf('Seller ID', 'id', { w: '1 1 140px' })}
                  {rf('Nombre Seller', 's')}
                  {rf('Categoria', 'c', { options: CATEGORIAS })}
                  {rf('Tipo', 't', { options: ['Cartera', 'Autogestionado'] })}
                  {rf('Contacto', 'n')}
                  {rf('Email', 'm')}
                  {rf('Telefono', 'tel', { w: '1 1 140px' })}
                  {rf('Nota', 'note')}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setModal(null)}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" onClick={() => saveProspect(modal.type === 'addProspect')}>
                    {modal.type === 'addProspect' ? 'Agregar' : 'Guardar'}
                  </button>
                </div>
              </>
            )}

            {modal.type === 'close' && (
              <>
                <h3 style={{ margin: '0 0 10px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
                  Cerrar y Mover a Cobros
                </h3>
                <p style={{ color: C.textSec, fontSize: 13, margin: '0 0 16px' }}>
                  <strong style={{ color: C.text }}>{modal.data.s}</strong> pasa a Cobros SE.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                  {rf('Seller ID', 'sid', { w: '1 1 120px' })}
                  {rf('Seller', 'seller')}
                  {rf('Seccion', 'sec', { options: CATEGORIAS })}
                  {rf('KAM', 'kam')}
                  {rf('Contacto', 'cont')}
                  {rf('Email', 'mail')}
                  {rf('Plan', 'plan', { options: PLAN_TYPES })}
                  {rf('Tarifa', 'tarifa', { type: 'number', w: '1 1 140px' })}
                  {rf('Meses Dcto', 'dcto', { type: 'number', w: '1 1 100px' })}
                  {rf('Min Meses', 'min', { type: 'number', w: '1 1 100px' })}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setModal(null)}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" onClick={confirmClose}>
                    Confirmar
                  </button>
                </div>
              </>
            )}

            {(modal.type === 'addSeller' || modal.type === 'editSeller') && (
              <>
                <h3 style={{ margin: '0 0 18px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
                  {modal.type === 'addSeller' ? 'Agregar Seller' : 'Editar Seller'}
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
                  {rf('Seller', 'seller')}
                  {rf('Seller ID', 'sid', { w: '1 1 120px' })}
                  {rf('Seccion', 'sec', { options: CATEGORIAS })}
                  {rf('KAM', 'kam')}
                  {rf('Contacto', 'cont')}
                  {rf('Email', 'mail')}
                  {rf('Status', 'status', { options: ['Iniciado', 'Pausa', 'Fuga'] })}
                  {rf('Tipo', 'tipo', { options: PLAN_TYPES })}
                  {rf('Tarifa', 'tarifa', { type: 'number', w: '1 1 120px' })}
                  {rf('F.Contrato', 'fContrato', { type: 'date' })}
                  {rf('F.Termino', 'fTermino', { type: 'date' })}
                  {rf('Meses Dcto', 'dcto', { type: 'number', w: '1 1 80px' })}
                  {rf('Min Meses', 'min', { type: 'number', w: '1 1 80px' })}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={() => setModal(null)}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" onClick={saveSeller}>
                    {modal.type === 'addSeller' ? 'Agregar' : 'Guardar'}
                  </button>
                </div>
              </>
            )}

            {modal.type === 'editCupos' && (
              <>
                <h3 style={{ margin: '0 0 18px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
                  {'Editar Cupos (max ' + MAX_CUPOS + ')'}
                </h3>
                {cuposCalc.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ minWidth: 130, fontSize: 13, fontWeight: 600 }}>{c.g}</span>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: C.textMuted }}>Usados</label>
                      <input
                        type="number"
                        value={form['u' + i] ?? c.u}
                        onChange={(e) => updateForm('u' + i, e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: C.textMuted }}>Disponibles</label>
                      <input
                        type="number"
                        value={form['d' + i] ?? c.d}
                        onChange={(e) => updateForm('d' + i, e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
                  <button className="btn btn-ghost" onClick={() => setModal(null)}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" onClick={saveCupos}>
                    Guardar
                  </button>
                </div>
              </>
            )}

            {modal.type === 'editMonthCharge' &&
              (() => {
                const s = modal.data.seller;
                const mi = modal.data.monthIdx;
                const ch = getMonthlyCharge(s, mi, modal.data.year);
                const mk = mkKey(modal.data.year, mi);
                const hasC = s.customDctos && s.customDctos[mk] != null;

                return (
                  <>
                    <h3 style={{ margin: '0 0 14px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
                      {'Editar Cobro - ' + MONTHS_SHORT[mi] + ' ' + modal.data.year}
                    </h3>

                    <div style={{ fontSize: 13, color: C.textSec, marginBottom: 16 }}>
                      <strong>{s.seller}</strong> {' (' + s.sid + ')'}
                      <div style={{ marginTop: 4 }}>{'Tarifa base: ' + fmtFull(s.tarifa)}</div>
                      <div>
                        {'Cobro actual: ' +
                          fmtFull(ch.amount) +
                          (ch.isDiscount ? ' (dcto)' : '') +
                          (ch.isProrated ? ' (prorrata)' : '') +
                          (ch.isCustom ? ' (custom)' : '')}
                      </div>
                    </div>

                    <div style={{ flex: '1 1 200px', marginBottom: 16 }}>
                      <label
                        style={{
                          fontSize: 11,
                          color: C.textMuted,
                          display: 'block',
                          marginBottom: 4,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                        }}
                      >
                        Monto a cobrar
                      </label>
                      <input
                        type="number"
                        value={form.customAmount || ''}
                        onChange={(e) => {
                          updateForm('customAmount', e.target.value);
                          updateForm('removeCustom', false);
                        }}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, fontSize: 13 }}
                        placeholder={String(s.tarifa)}
                      />
                    </div>

                    {hasC && (
                      <div style={{ marginBottom: 16 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.textSec, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={!!form.removeCustom}
                            onChange={(e) => updateForm('removeCustom', e.target.checked)}
                          />
                          Eliminar cobro personalizado
                        </label>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost" onClick={() => setModal(null)}>
                        Cancelar
                      </button>
                      <button className="btn btn-primary" onClick={saveMonthCharge}>
                        Guardar
                      </button>
                    </div>
                  </>
                );
              })()}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 1360, margin: '0 auto', padding: '16px 20px' }}>
        {/* HEADER */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 12,
            background: C.bgCard,
            padding: '12px 20px',
            borderRadius: 14,
            border: '1px solid ' + C.borderLight,
            boxShadow: '0 1px 4px rgba(0,0,0,.03)',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.primary, letterSpacing: '-0.5px' }}>
              SELLERS ELITE
            </h1>
            <p style={{ margin: '1px 0 0', fontSize: 11, color: C.textMuted }}>
              Hunting + Cobros - Falabella Marketplace
            </p>
          </div>

          <div style={{ display: 'flex', gap: 2, background: C.bgAlt, padding: 3, borderRadius: 10 }}>
            {([
              ['hunting', 'Hunting'],
              ['sellers', 'Cobros'],
              ['dashboard', 'Dashboard'],
            ] as [Tab, string][]).map((item) => (
              <button
                key={item[0]}
                onClick={() => setTab(item[0])}
                style={{
                  padding: '7px 16px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  fontFamily: 'inherit',
                  transition: 'all .2s',
                  background: tab === item[0] ? C.primary : 'transparent',
                  color: tab === item[0] ? '#fff' : C.textSec,
                  boxShadow: tab === item[0] ? '0 2px 8px rgba(22,163,74,.2)' : 'none',
                }}
              >
                {item[1]}
              </button>
            ))}
          </div>
        </div>

        {/* ═══ HUNTING ═══ */}
        {tab === 'hunting' && (
          <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <KpiCard label="Pipeline" value={kpi.pipe} color={C.purple} />
              <KpiCard label="Cerrados" value={kpi.cerr} color={C.primary} />
              <KpiCard label="No Interesado" value={kpi.noInt} color={C.danger} />
              <KpiCard label="Cupos Disp." value={kpi.cupD} color={kpi.cupD > 0 ? C.primary : C.danger} />
              <KpiCard label="Sellers Cobros" value={kpi.tot} color={C.tertiary} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="card" style={{ padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ margin: 0, fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                    Cupos por Categoria
                  </h3>
                  <span
                    className="action-icon"
                    style={{ fontSize: 12 }}
                    onClick={() => {
                      setForm({});
                      setModal({ type: 'editCupos' });
                    }}
                  >
                    editar
                  </span>
                </div>
                {cuposCalc.map((c, i) => {
                  const tot = c.u + c.d;
                  const pct = tot > 0 ? (c.u / tot) * 100 : 0;
                  return (
                    <div key={i} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>
                          {c.g} <span style={{ color: C.textMuted, fontWeight: 400 }}>{'(' + c.e + ')'}</span>
                        </span>
                        <span style={{ color: c.d === 0 ? C.danger : C.primary, fontWeight: 700, fontSize: 11 }}>
                          {c.u + '/' + tot + ' (' + c.d + ' disp)'}
                        </span>
                      </div>
                      <div style={{ height: 6, background: C.bgDark, borderRadius: 3, overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            borderRadius: 3,
                            transition: 'width .5s',
                            width: pct + '%',
                            background: c.d === 0 ? C.danger : pct > 80 ? C.warning : C.primary,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                  Funnel
                </h3>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={funnel} layout="vertical">
                    <XAxis type="number" tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fill: C.textSec, fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={100}
                    />
                    <Tooltip contentStyle={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {funnel.map((e, i) => (
                        <Cell key={i} fill={e.fill} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div
                style={{
                  padding: '10px 14px',
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  borderBottom: '1px solid ' + C.border,
                  alignItems: 'center',
                  background: C.bgAlt,
                }}
              >
                <input placeholder="Buscar seller..." value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: '1 1 160px' }} />
                <select value={fCat} onChange={(e) => setFCat(e.target.value as any)}>
                  <option>Todos</option>
                  {CATEGORIAS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select value={fSt} onChange={(e) => setFSt(e.target.value as any)}>
                  <option>Todos</option>
                  {STAGES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ padding: '7px 14px', fontSize: 12 }}
                  onClick={() => {
                    setForm({ c: CATEGORIAS[0], t: 'Cartera' });
                    setModal({ type: 'addProspect' });
                  }}
                >
                  + Agregar
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.5fr .4fr',
                  padding: '8px 14px',
                  background: C.bgAlt,
                  fontSize: 10,
                  color: C.textMuted,
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  borderBottom: '2px solid ' + C.border,
                }}
              >
                <SortHeader label="Seller" sortKey="s" current={huntSort} onSort={(k) => toggleSort(setHuntSort, huntSort, k)} />
                <SortHeader label="Categoria" sortKey="c" current={huntSort} onSort={(k) => toggleSort(setHuntSort, huntSort, k)} />
                <SortHeader label="Status" sortKey="st" current={huntSort} onSort={(k) => toggleSort(setHuntSort, huntSort, k)} />
                <div>Contacto</div>
                <div>Accion</div>
                <div />
              </div>

              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {filt.map((p) => {
                  const si = ACTIVE_STAGES.indexOf(p.st);
                  const nextA = si >= 0 && si < ACTIVE_STAGES.length - 1 ? ACTIVE_STAGES[si + 1] : undefined;
                  const canCl = p.st === 'Interesados';
                  const canNI = p.st === 'Contactados' || p.st === 'Interesados';
                  const cp = cuposCalc.find((c) => c.g === p.c);
                  const cupoOk = !!cp && cp.d > 0;

                  return (
                    <div
                      key={p.id}
                      className="row-hover"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.5fr .4fr',
                        padding: '10px 14px',
                        borderBottom: '1px solid ' + C.borderLight,
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{p.s}</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>{p.id}{p.note ? ' - ' + p.note : ''}</div>
                      </div>

                      <div>
                        <div style={{ fontSize: 12 }}>{p.c}</div>
                        <div style={{ fontSize: 10, color: C.textMuted }}>{p.t}</div>
                      </div>

                      <div>
                        <Pill color={SC[p.st]}>{p.st}</Pill>
                      </div>
                      <div style={{ fontSize: 11, color: C.textSec }}>{p.n || p.m || '-'}</div>

                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {nextA && (
                          <button
                            className="btn btn-sm"
                            style={{ background: C.tertiaryBg, color: C.tertiary, border: '1px solid ' + C.tertiaryLight }}
                            onClick={() => advance(p, nextA)}
                          >
                            {nextA === 'Contactados' ? 'Contactar' : 'Interesado'}
                          </button>
                        )}

                        {canCl && (
                          <button
                            className="btn btn-sm"
                            style={{
                              background: cupoOk ? C.primaryLight : C.secondaryLight,
                              color: cupoOk ? C.primaryDark : C.textMuted,
                              border: '1px solid ' + (cupoOk ? C.primary : C.border),
                              cursor: cupoOk ? 'pointer' : 'not-allowed',
                            }}
                            onClick={() => {
                              if (cupoOk) advance(p, 'Cerrados');
                            }}
                          >
                            {cupoOk ? 'Cerrar' : 'Cerrar (0)'}
                          </button>
                        )}

                        {canNI && (
                          <button
                            className="btn btn-sm"
                            style={{ background: C.dangerLight, color: C.danger, border: '1px solid #fecaca' }}
                            onClick={() => advance(p, 'No Interesado')}
                          >
                            No Int.
                          </button>
                        )}

                        {p.st === 'No Interesado' && (
                          <button
                            className="btn btn-sm"
                            style={{ background: C.secondaryLight, color: C.textSec, border: '1px solid ' + C.border }}
                            onClick={() => advance(p, 'Prospectos')}
                          >
                            Reactivar
                          </button>
                        )}

                        {p.st === 'Cerrados' && (
                          <>
                            <button
                              className="btn btn-sm"
                              style={{ background: C.primaryLight, color: C.primaryDark, border: '1px solid ' + C.primary }}
                              onClick={() => handleClosedClick(p)}
                            >
                              Cobros
                            </button>
                            <button
                              className="btn btn-sm"
                              style={{ background: C.warningLight, color: '#92400E', border: '1px solid ' + C.warning }}
                              onClick={() => reverseCerrado(p)}
                            >
                              Revertir
                            </button>
                          </>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        <span
                          className="action-icon"
                          onClick={() => {
                            setForm({ ...p, _origId: p.id });
                            setModal({ type: 'editProspect' });
                          }}
                        >
                          E
                        </span>
                        <span className="action-icon del-icon" onClick={() => deleteProspect(p)}>
                          X
                        </span>
                      </div>
                    </div>
                  );
                })}

                {filt.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>No hay prospectos</div>}
              </div>
            </div>
          </div>
        )}

        {/* ═══ COBROS ═══ */}
        {tab === 'sellers' && (
          <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: 1 }}>
              <KpiCard label="Total Sellers" value={kpi.tot} color={C.tertiary} />
              {PLAN_TYPES.map((p) => (
                <KpiCard key={p} label={p + ' Activos'} value={kpi.planCounts[p] || 0} color={planC(p)} />
              ))}
              <KpiCard label="En Pausa" value={kpi.pausa} color={C.warning} />
              <KpiCard label="Fugas" value={kpi.fug} color={C.danger} />
              <KpiCard label="Revenue YTD" value={fmt(kpi.ytdRev)} color={C.primary} />
              <KpiCard label={'Revenue Proyectado ' + CURRENT_YEAR} value={fmt(kpi.projectedRev)} color={C.purple} />
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', display: 'flex', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid ' + C.border, alignItems: 'center', background: C.bgAlt }}>
                <input placeholder="Buscar..." value={sQ} onChange={(e) => setSQ(e.target.value)} style={{ flex: '1 1 140px' }} />
                <select value={sCatF} onChange={(e) => setSCatF(e.target.value as any)}>
                  <option>Todos</option>
                  {CATEGORIAS.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select value={sStatusF} onChange={(e) => setSStatusF(e.target.value as any)}>
                  <option>Todos</option>
                  {(['Iniciado', 'Pausa', 'Fuga'] as SellerStatus[]).map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select value={sPlanF} onChange={(e) => setSPlanF(e.target.value as any)}>
                  <option>Todos</option>
                  {PLAN_TYPES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ padding: '7px 14px', fontSize: 12 }}
                  onClick={() => {
                    setForm({ sec: CATEGORIAS[0], status: 'Iniciado', tipo: 'Full', tarifa: 990000, min: 6, dcto: 2, _isNew: true, customDctos: {} });
                    setModal({ type: 'addSeller' });
                  }}
                >
                  + Agregar
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.2fr .8fr .8fr .7fr .7fr .7fr .4fr',
                  padding: '8px 14px',
                  background: C.bgAlt,
                  fontSize: 10,
                  color: C.textMuted,
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  borderBottom: '2px solid ' + C.border,
                }}
              >
                <SortHeader label="Seller" sortKey="seller" current={sellSort} onSort={(k) => toggleSort(setSellSort, sellSort, k)} />
                <SortHeader label="Seccion" sortKey="sec" current={sellSort} onSort={(k) => toggleSort(setSellSort, sellSort, k)} />
                <SortHeader label="Status" sortKey="status" current={sellSort} onSort={(k) => toggleSort(setSellSort, sellSort, k)} />
                <SortHeader label="Tipo" sortKey="tipo" current={sellSort} onSort={(k) => toggleSort(setSellSort, sellSort, k)} />
                <SortHeader label="Tarifa" sortKey="tarifa" current={sellSort} onSort={(k) => toggleSort(setSellSort, sellSort, k)} />
                <div>Dcto</div>
                <div>Min</div>
                <div />
              </div>

              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                {filteredSellers.map((s) => (
                  <div
                    key={s.sid}
                    className="row-hover"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 1.2fr .8fr .8fr .7fr .7fr .7fr .4fr',
                      padding: '10px 14px',
                      borderBottom: '1px solid ' + C.borderLight,
                      cursor: 'pointer',
                      alignItems: 'center',
                      background: selS?.sid === s.sid ? C.primaryLight : undefined,
                    }}
                    onClick={() => setSelS(selS?.sid === s.sid ? null : s)}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.seller}</div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>{s.sid + ' - ' + s.cont}</div>
                    </div>

                    <div style={{ fontSize: 12, color: C.textSec }}>{s.sec}</div>
                    <div>
                      <Pill color={stC(s.status)}>{s.status}</Pill>
                    </div>
                    <div style={{ fontSize: 12 }}>
                      <Pill color={planC(s.tipo)}>{s.tipo}</Pill>
                    </div>
                    <div style={{ fontSize: 12, color: C.primary, fontWeight: 700 }}>{fmt(s.tarifa)}</div>
                    <div style={{ fontSize: 12, color: s.dcto > 0 ? C.purple : C.textMuted }}>{s.dcto > 0 ? s.dcto + 'm' : '-'}</div>
                    <div style={{ fontSize: 12 }}>{s.min + 'm'}</div>

                    <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                      <span
                        className="action-icon"
                        onClick={() => {
                          setForm({ ...s, _origSid: s.sid });
                          setModal({ type: 'editSeller' });
                        }}
                      >
                        E
                      </span>
                      <span className="action-icon del-icon" onClick={() => deleteSeller(s)}>
                        X
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selS && (
              <div className="card fi" style={{ padding: 18 }}>
                <h3 style={{ margin: '0 0 6px', color: C.primary, fontSize: 16, fontWeight: 700 }}>{selS.seller}</h3>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
                  {selS.sid +
                    ' - ' +
                    selS.cont +
                    ' - ' +
                    selS.mail +
                    ' - ' +
                    (selS.fContrato || 'N/A') +
                    (selS.fTermino ? ' Termino: ' + selS.fTermino : '')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, fontSize: 12 }}>
                  {[
                    { l: 'Seccion', v: selS.sec },
                    { l: 'KAM', v: selS.kam },
                    { l: 'Plan', v: selS.tipo, c: planC(selS.tipo) },
                    { l: 'Tarifa', v: fmtFull(selS.tarifa), c: C.primary },
                    { l: 'Dcto', v: selS.dcto + 'm', c: C.purple },
                    { l: 'Min', v: selS.min + 'm' },
                    { l: 'Status', v: selS.status, c: stC(selS.status) },
                  ].map((it, i2) => (
                    <div key={i2}>
                      <span style={{ color: C.textMuted }}>{it.l}:</span> <span style={{ color: it.c || C.text, fontWeight: 600 }}>{it.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ DASHBOARD ═══ */}
        {tab === 'dashboard' && (
          <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: 1 }}>
              <KpiCard label="Revenue YTD" value={fmt(kpi.ytdRev)} color={C.primary} />
              <KpiCard label={'Revenue Proyectado ' + CURRENT_YEAR} value={fmt(kpi.projectedRev)} color={C.primaryDark} />
              <KpiCard
                label="Sellers Activos"
                value={kpi.act}
                color={C.tertiary}
                sub={
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {PLAN_TYPES.map((p) => (
                      <span key={p} style={{ fontSize: 11, color: planC(p), fontWeight: 700 }}>
                        {(kpi.planCounts[p] || 0) + ' ' + p}
                      </span>
                    ))}
                  </div>
                }
              />
              <KpiCard label="Pipeline" value={kpi.pipe} color={C.purple} />
            </div>

            {/* STACKED HISTOGRAM */}
            <div className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                  {dashView === 'monthly' ? 'Ingresos Mensuales por Servicio' : 'Ingresos Acumulados YTD por Servicio'}
                </h3>
                <ViewToggle mode={dashView} onChange={setDashView} />
              </div>

              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={histogramData}>
                  <XAxis dataKey="name" tick={{ fill: C.textSec, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: any) => fmt(Number(v))} />
                  <Tooltip
                    contentStyle={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10, fontSize: 12 }}
                    formatter={(v: any, name: any) => [fmtFull(Number(v)), String(name ?? '')]}
                  />
                  {PLAN_TYPES.map((plan) => (
                    <Bar key={plan} dataKey={plan} stackId="a" radius={plan === PLAN_TYPES[PLAN_TYPES.length - 1] ? [4, 4, 0, 0] : undefined}>
                      {histogramData.map((entry: any, idx: number) => (
                        <Cell key={idx} fill={StackedBarCell(plan, entry.idx > CURRENT_MONTH)} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 8 }}>
                {PLAN_TYPES.map((p) => (
                  <div key={p} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: PLAN_COLORS[p] }} />
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                  Ingresos por Categoria
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={revByCategory}>
                    <XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: any) => fmt(Number(v))} />
                    <Tooltip contentStyle={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10, fontSize: 12 }} formatter={(v: any) => fmtFull(Number(v))} />
                    <Bar dataKey="revenue" radius={[6, 6, 0, 0]} fill={C.primary} fillOpacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                  Ingresos por Plan
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={planRevDist}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={(d: any) => d.name + ': ' + fmt(d.value)}
                      labelLine={{ stroke: C.textMuted }}
                    >
                      {planRevDist.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10, fontSize: 12 }} formatter={(v: any) => fmtFull(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                  Status Sellers
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={statusDist}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={(d: any) => d.name + ': ' + d.value}
                      labelLine={{ stroke: C.textMuted }}
                    >
                      {statusDist.map((d, i) => (
                        <Cell key={i} fill={d.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Resumen */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid ' + C.border, background: C.bgAlt }}>
                <h3 style={{ margin: 0, fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                  {'Resumen Ingresos ' + CURRENT_YEAR}
                </h3>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: C.bgAlt, borderBottom: '2px solid ' + C.border }}>
                      <th style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 700, fontSize: 10, color: C.textMuted }}>Plan</th>
                      {MONTHS_SHORT.map((m) => (
                        <th key={m} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, fontSize: 10, color: C.textMuted }}>
                          {m}
                        </th>
                      ))}
                      <th style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, fontSize: 10, color: C.textMuted, background: C.primaryBg }}>
                        Total
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {PLAN_TYPES.map((plan) => {
                      const pc = PLAN_COLORS[plan];
                      return (
                        <tr key={plan} style={{ borderBottom: '1px solid ' + C.borderLight }}>
                          <td style={{ padding: '8px 14px', fontWeight: 600, color: pc }}>{plan}</td>
                          {monthlyBreakdown.map((m, i) => (
                            <td key={i} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 500 }}>
                              {(m[plan] || 0) > 0 ? fmt(m[plan]) : '-'}
                            </td>
                          ))}
                          <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: pc, background: C.primaryBg }}>
                            {fmt(monthlyBreakdown.reduce((s, m) => s + (m[plan] || 0), 0))}
                          </td>
                        </tr>
                      );
                    })}

                    <tr style={{ background: C.primaryBg, borderTop: '2px solid ' + C.primary }}>
                      <td style={{ padding: '8px 14px', fontWeight: 800, color: C.primaryDark }}>TOTAL</td>
                      {monthlyBreakdown.map((m, i) => (
                        <td key={i} style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: C.primaryDark }}>
                          {m.total > 0 ? fmt(m.total) : '-'}
                        </td>
                      ))}
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 800, color: C.primaryDark, fontSize: 13 }}>
                        {fmtFull(projectedRev)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* DETALLE DE COBROS - FULL */}
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
                <h3 style={{ margin: 0, fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                  Detalle de Cobros - Full
                </h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-ghost" onClick={expandAllFull}>
                    Expandir Full
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={collapseAllFull}>
                    Contraer Full
                  </button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1200 }}>
                  <thead>
                    <tr style={{ background: C.bgAlt, borderBottom: '2px solid ' + C.border }}>
                      {['Seller', 'ID', 'KAM', 'Plan', 'Tarifa', 'Dcto', 'Min'].map((h) => (
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
                      {MONTHS_SHORT.map((m, mi) => (
                        <th
                          key={m}
                          style={{
                            padding: '8px 6px',
                            textAlign: 'right',
                            fontWeight: 700,
                            fontSize: 10,
                            color: C.textMuted,
                            whiteSpace: 'nowrap',
                            background: mi === CURRENT_MONTH ? C.primaryBg : undefined,
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
                    {groupedFullByCat.flatMap((group) => {
                      const isExpanded = !!expandedCatsFull[group.cat];
                      const catColor = C.primary;
                      const rows: ReactNode[] = [];

                      rows.push(
                        <tr
                          key={'cat-full-' + group.cat}
                          style={{ background: C.bgAlt, cursor: 'pointer', borderBottom: '1px solid ' + C.border }}
                          onClick={() => toggleCatFull(group.cat)}
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
                                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                }}
                              >
                                ▶
                              </span>
                              {group.cat}
                              <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 500 }}>{'(' + group.sellers.length + ' Full)'}</span>
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
                                color: catColor,
                                background: mi === CURRENT_MONTH ? C.primaryBg : undefined,
                              }}
                            >
                              {mt > 0 ? fmt(mt) : '-'}
                            </td>
                          ))}
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: catColor, background: C.primaryBg, fontSize: 11 }}>
                            {fmt(group.yearTotal)}
                          </td>
                        </tr>
                      );

                      if (isExpanded) {
                        const ps = group.planBreakdown.Full.sellers;
                        const pc = PLAN_COLORS.Full;

                        ps.forEach((s) => {
                          let yt = 0;
                          rows.push(
                            <tr key={'full-' + s.sid} className="row-hover" style={{ borderBottom: '1px solid ' + C.borderLight }}>
                              <td style={{ padding: '7px 8px 7px 28px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {s.seller}
                                {s.status === 'Fuga' && (
                                  <span style={{ marginLeft: 4, fontSize: 9, color: C.danger, fontWeight: 700 }}>FUGA</span>
                                )}
                              </td>
                              <td style={{ padding: '7px 8px', color: C.textMuted, fontSize: 10 }}>{s.sid}</td>
                              <td style={{ padding: '7px 8px', color: C.textSec, fontSize: 10 }}>{s.kam}</td>
                              <td style={{ padding: '7px 8px' }}>
                                <Pill color={pc}>Full</Pill>
                              </td>
                              <td style={{ padding: '7px 8px', fontWeight: 600 }}>{fmt(s.tarifa)}</td>
                              <td style={{ padding: '7px 8px', color: s.dcto > 0 ? C.purple : C.textMuted }}>{s.dcto > 0 ? s.dcto + 'm' : '-'}</td>
                              <td style={{ padding: '7px 8px' }}>{s.min + 'm'}</td>

                              {MONTHS_SHORT.map((_, mi) => {
                                const ch = getMonthlyCharge(s, mi);
                                yt += ch.amount;
                                const cc = !ch.active ? C.textMuted : ch.isCustom ? '#1D4ED8' : ch.isDiscount ? '#B45309' : C.primary;
                                const cb = !ch.active ? 'transparent' : ch.isCustom ? '#DBEAFE' : ch.isDiscount ? C.warningLight : C.primaryLight;
                                return (
                                  <td
                                    key={mi}
                                    className="month-cell"
                                    style={{
                                      padding: '7px 6px',
                                      textAlign: 'right',
                                      fontWeight: 600,
                                      fontSize: 10,
                                      whiteSpace: 'nowrap',
                                      background: mi === CURRENT_MONTH ? C.primaryBg : undefined,
                                      color: cc,
                                      cursor: 'pointer',
                                    }}
                                    onClick={() => {
                                      setForm({ customAmount: ch.amount > 0 ? String(ch.amount) : '', removeCustom: false });
                                      setModal({ type: 'editMonthCharge', data: { seller: s, monthIdx: mi, year: CURRENT_YEAR } });
                                    }}
                                    title="Click para editar"
                                  >
                                    {ch.active ? (
                                      <span style={{ padding: '2px 5px', borderRadius: 4, background: cb, display: 'inline-block' }}>
                                        {fmt(ch.amount)}
                                        {ch.isProrated ? '*' : ''}
                                        {ch.isCustom ? '•' : ''}
                                      </span>
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                );
                              })}

                              <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: C.primaryDark, background: C.primaryBg }}>{fmt(yt)}</td>
                            </tr>
                          );
                        });
                      }

                      return rows;
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ padding: '6px 16px', fontSize: 10, color: C.textMuted, borderTop: '1px solid ' + C.borderLight }}>
                {'* = prorrateado | • = cobro personalizado | Click en celda para editar | Click en gerencia para expandir/contraer'}
              </div>
            </div>

            {/* DETALLE DE COBROS - PREMIUM */}
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
                <h3 style={{ margin: 0, fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                  Detalle de Cobros - Premium
                </h3>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-sm btn-ghost" onClick={expandAllPremium}>
                    Expandir Premium
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={collapseAllPremium}>
                    Contraer Premium
                  </button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1200 }}>
                  <thead>
                    <tr style={{ background: C.bgAlt, borderBottom: '2px solid ' + C.border }}>
                      {['Seller', 'ID', 'KAM', 'Plan', 'Tarifa', 'Dcto', 'Min'].map((h) => (
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
                      {MONTHS_SHORT.map((m, mi) => (
                        <th
                          key={m}
                          style={{
                            padding: '8px 6px',
                            textAlign: 'right',
                            fontWeight: 700,
                            fontSize: 10,
                            color: C.textMuted,
                            whiteSpace: 'nowrap',
                            background: mi === CURRENT_MONTH ? C.primaryBg : undefined,
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
                    {groupedPremiumByCat.flatMap((group) => {
                      const isExpanded = !!expandedCatsPremium[group.cat];
                      const rows: ReactNode[] = [];

                      rows.push(
                        <tr
                          key={'cat-prem-' + group.cat}
                          style={{ background: C.bgAlt, cursor: 'pointer', borderBottom: '1px solid ' + C.border }}
                          onClick={() => toggleCatPremium(group.cat)}
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
                                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                }}
                              >
                                ▶
                              </span>
                              {group.cat}
                              <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 500 }}>{'(' + group.sellers.length + ' Premium)'}</span>
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
                                color: C.purple,
                                background: mi === CURRENT_MONTH ? C.primaryBg : undefined,
                              }}
                            >
                              {mt > 0 ? fmt(mt) : '-'}
                            </td>
                          ))}
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: C.purple, background: C.primaryBg, fontSize: 11 }}>
                            {fmt(group.yearTotal)}
                          </td>
                        </tr>
                      );

                      if (isExpanded) {
                        const ps = group.planBreakdown.Premium.sellers;
                        const pc = PLAN_COLORS.Premium;

                        ps.forEach((s) => {
                          let yt = 0;
                          rows.push(
                            <tr key={'prem-' + s.sid} className="row-hover" style={{ borderBottom: '1px solid ' + C.borderLight }}>
                              <td style={{ padding: '7px 8px 7px 28px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {s.seller}
                                {s.status === 'Fuga' && (
                                  <span style={{ marginLeft: 4, fontSize: 9, color: C.danger, fontWeight: 700 }}>FUGA</span>
                                )}
                              </td>
                              <td style={{ padding: '7px 8px', color: C.textMuted, fontSize: 10 }}>{s.sid}</td>
                              <td style={{ padding: '7px 8px', color: C.textSec, fontSize: 10 }}>{s.kam}</td>
                              <td style={{ padding: '7px 8px' }}>
                                <Pill color={pc}>Premium</Pill>
                              </td>
                              <td style={{ padding: '7px 8px', fontWeight: 600 }}>{fmt(s.tarifa)}</td>
                              <td style={{ padding: '7px 8px', color: s.dcto > 0 ? C.purple : C.textMuted }}>{s.dcto > 0 ? s.dcto + 'm' : '-'}</td>
                              <td style={{ padding: '7px 8px' }}>{s.min + 'm'}</td>

                              {MONTHS_SHORT.map((_, mi) => {
                                const ch = getMonthlyCharge(s, mi);
                                yt += ch.amount;
                                const cc = !ch.active ? C.textMuted : ch.isCustom ? '#1D4ED8' : ch.isDiscount ? '#B45309' : C.primary;
                                const cb = !ch.active ? 'transparent' : ch.isCustom ? '#DBEAFE' : ch.isDiscount ? C.warningLight : C.primaryLight;
                                return (
                                  <td
                                    key={mi}
                                    className="month-cell"
                                    style={{
                                      padding: '7px 6px',
                                      textAlign: 'right',
                                      fontWeight: 600,
                                      fontSize: 10,
                                      whiteSpace: 'nowrap',
                                      background: mi === CURRENT_MONTH ? C.primaryBg : undefined,
                                      color: cc,
                                      cursor: 'pointer',
                                    }}
                                    onClick={() => {
                                      setForm({ customAmount: ch.amount > 0 ? String(ch.amount) : '', removeCustom: false });
                                      setModal({ type: 'editMonthCharge', data: { seller: s, monthIdx: mi, year: CURRENT_YEAR } });
                                    }}
                                    title="Click para editar"
                                  >
                                    {ch.active ? (
                                      <span style={{ padding: '2px 5px', borderRadius: 4, background: cb, display: 'inline-block' }}>
                                        {fmt(ch.amount)}
                                        {ch.isProrated ? '*' : ''}
                                        {ch.isCustom ? '•' : ''}
                                      </span>
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                );
                              })}

                              <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: C.primaryDark, background: C.primaryBg }}>{fmt(yt)}</td>
                            </tr>
                          );
                        });
                      }

                      return rows;
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ padding: '6px 16px', fontSize: 10, color: C.textMuted, borderTop: '1px solid ' + C.borderLight }}>
                {'* = prorrateado | • = cobro personalizado | Click en celda para editar | Click en gerencia para expandir/contraer'}
              </div>
            </div>

            {/* Funnel + Categories */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>Funnel</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={funnel}>
                    <XAxis dataKey="name" tick={{ fill: C.textSec, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: C.textMuted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {funnel.map((e, i) => (
                        <Cell key={i} fill={e.fill} fillOpacity={0.85} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: 18 }}>
                <h3 style={{ margin: '0 0 12px', fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
                  Sellers por Gerencia
                </h3>

                {CATEGORIAS.map((cat) => {
                  const count = sellers.filter((s) => s.sec === cat).length;
                  const act = sellers.filter((s) => s.sec === cat && s.status === 'Iniciado').length;
                  const rev = sellers.filter((s) => s.sec === cat && s.status === 'Iniciado').reduce((sum, s) => sum + s.tarifa, 0);

                  return (
                    <div key={cat} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{cat}</span>
                        <span style={{ color: C.textMuted, fontSize: 11 }}>{count + ' sellers - ' + act + ' activos - ' + fmt(rev)}</span>
                      </div>
                      <div style={{ height: 6, background: C.bgDark, borderRadius: 3, overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            borderRadius: 3,
                            transition: 'width .5s',
                            width: (sellers.length > 0 ? (count / sellers.length) * 100 : 0) + '%',
                            background: C.primary,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}