import {
fetchProspects,
fetchSellers,
upsertProspect,
deleteProspectDB,
updateProspectStatus,
upsertSeller,
deleteSellerDB,
fetchKamsCupos,
upsertKamCupo,
deleteKamCupo,
fetchPricingConfig,
supabase,
} from './api';
import { AuthGate, useAuth } from './Auth';
import { notifySellerEvent, triggerMonthlyBillingReport } from './lib/notifications';
import { useEffect, useMemo, useState, useCallback, memo, type ReactNode } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, LabelList } from 'recharts';
import { C, CSS_STYLES, FONT_FAMILY, fmt, fmtFull } from './theme';
import { downloadCSV } from './lib/csv';
import {
computeMulticuenta,
getMulticuentaCharge,
getPctForPosition,
mapPricingConfig,
DEFAULT_PRICING,
type PricingConfig,
} from './lib/multicuenta';
import AdminTab from './AdminTab';
/* ──────────────────────────────────────────────────────────────
TYPES
────────────────────────────────────────────────────────────── */
type ProspectStage = 'Prospectos' | 'Contactados' | 'Interesados' | 'No Interesado' | 'Cerrados';
type SellerStatus = 'Iniciado' | 'Pausa' | 'Fuga';
type SellerPlan = 'Full' | 'Premium' | 'Basico';
type ViewMode = 'monthly' | 'ytd';
type Tab = 'dashboard' | 'sellers' | 'admin' | 'hunting';
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
esMulticuenta: boolean;
principalSid: string;
};
// Nuevo modelo: 1 fila por (gerencia, KAM) con su cupo total propio.
// Los "usados" se calculan dinamicamente desde la tabla sellers.
type KamCupo = { id: string; gerencia: Categoria; kam: string; cupoTotal: number };
type Modal =
| null
| { type: 'addProspect' }
| { type: 'editProspect' }
| { type: 'close'; data: Prospect }
| { type: 'addSeller' }
| { type: 'editSeller' }
| { type: 'editCupos' }
| { type: 'manageKams' }
| { type: 'editMonthCharge'; data: { seller: Seller; monthIdx: number; year: number } };
type Toast = null | { msg: string; ok: boolean };
/* ──────────────────────────────────────────────────────────────
CONSTS
────────────────────────────────────────────────────────────── */

// Acceso al tab Admin y al boton "Forzar envio": SOLO estos correos.
// Para dar acceso a alguien mas, agrega su email a esta lista.
const ADMIN_EMAILS = [
  'fconcha@falabella.cl',
].map(e => e.toLowerCase());

const KAM_POR_CATEGORIA: Record<Categoria, string> = {
Electro: 'Rosario Fernandez',
'Muebles/Hogar': 'Francisca Dinen',
'Cat Dig': 'Trinidad Santa Maria',
Moda: 'Maria Paz Fuentes',
'Belleza/Calzado': 'Macarena Meneses',
};
const DISCOUNT_RATE = 0.424412189118071;
const STAGES: ProspectStage[] = ['Prospectos', 'Contactados', 'Interesados', 'No Interesado', 'Cerrados'];
const ACTIVE_STAGES: ProspectStage[] = ['Prospectos', 'Contactados', 'Interesados'];
const MONTHS_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'] as const;
type MonthShort = (typeof MONTHS_SHORT)[number];
const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth();
const PLAN_TYPES: SellerPlan[] = ['Full', 'Premium', 'Basico'];

// Paleta C: ahora importada desde ./theme (tokens Falabella DS consolidados).
const SC: Record<ProspectStage, string> = {
Prospectos: C.secondary,
Contactados: C.tertiary,
Interesados: C.warning,
'No Interesado': C.danger,
Cerrados: C.primary,
};
const PLAN_COLORS: Record<SellerPlan, string> = { Full: C.primary, Premium: C.purple, Basico: C.basico };
const PLAN_COLORS_LIGHT: Record<SellerPlan, string> = {
Full: '#C6E9AD',
Premium: '#CBD4EC',
Basico: '#EDCDD2',
};
// fmt / fmtFull: importados desde ./theme (formato es-CL: miles con punto, coma decimal).
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
const anchorDay = cd.getDate();
const cycleStart = new Date(year, mIdx, anchorDay);
if (td < cycleStart) {
return { amount: 0, isDiscount: false, active: false, isCustom: false, isProrated: false };

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
esMulticuenta: !!r.es_multicuenta,
principalSid: r.principal_sid ? String(r.principal_sid) : '',
};
};
const mapKamCupo = (r: any): KamCupo => ({
id: String(r.id ?? ''),
gerencia: (r.gerencia as Categoria) ?? CATEGORIAS[0],
kam: String(r.kam_nombre ?? ''),
cupoTotal: Number(r.cupo_total ?? 12),
});
const sortData = <T,>(data: T[], config: SortConfig): T[] =>
data.slice().sort((a: any, b: any) => {
var va = a[config.key];
var vb = b[config.key];
if (va == null) va = '';
if (vb == null) vb = '';
if (va === '' && vb !== '') return 1;
if (vb === '' && va !== '') return -1;
if (va === '' && vb === '') return 0;
var isDate = typeof va === 'string' && va.length >= 10 && va[4] === '-' && va[7] === '-';
if (isDate) {
return config.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
}
if (typeof va === 'number' && typeof vb === 'number') return config.dir === 'asc' ? va - vb : vb - va;
if (typeof va === 'string') va = va.toLowerCase();
if (typeof vb === 'string') vb = vb.toLowerCase();
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
hasError?: boolean;
}) {

const borderColor = props.hasError ? C.danger : C.border;
const labelColor = props.hasError ? C.danger : C.textMuted;
return (
<div style={{ flex: props.w || '1 1 200px' }}>
<label
style={{
fontSize: 11,
color: labelColor,
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
border: '1.5px solid ' + borderColor,
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
border: '1.5px solid ' + borderColor,
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
// CSS_STYLES: importado desde ./theme (piel Falabella DS, misma estructura responsive).
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
// downloadCSV: importado desde ./lib/csv.
function AppInner() {
const { user, signOut } = useAuth();
const isAdminUser = ADMIN_EMAILS.includes((user?.email || '').toLowerCase());
const [tab, setTab] = useState<Tab>('dashboard');
const [prospects, setProspects] = useState<Prospect[]>([]);
const [kamsCupos, setKamsCupos] = useState<KamCupo[]>([]);
const [sellers, setSellers] = useState<Seller[]>([]);
const [pricingCfg, setPricingCfg] = useState<PricingConfig>(DEFAULT_PRICING);
const [expandedGerencias, setExpandedGerencias] = useState<Partial<Record<Categoria, boolean>>>({});
const [ready, setReady] = useState(false);
const [modal, setModal] = useState<Modal>(null);
const [toast, setToast] = useState<Toast>(null);
const [fCat, setFCat] = useState<'Todos' | Categoria>('Todos');
const [fSt, setFSt] = useState<'Todos' | ProspectStage>('Todos');
const [q, setQ] = useState('');
const [selS, setSelS] = useState<Seller | null>(null);
const [form, setForm] = useState<Record<string, any>>({});
const [formErrors, setFormErrors] = useState<string[]>([]);
const [huntSort, setHuntSort] = useState<SortConfig>({ key: 's', dir: 'asc' });
const [sellSort, setSellSort] = useState<SortConfig>({ key: 'seller', dir: 'asc' });
const [sCatF, setSCatF] = useState<'Todos' | Categoria>('Todos');
const [sStatusF, setSStatusF] = useState<'Todos' | SellerStatus>('Todos');
const [sPlanF, setSPlanF] = useState<'Todos' | SellerPlan>('Todos');
const [sQ, setSQ] = useState('');
const [dashView, setDashView] = useState<ViewMode>('monthly');
useEffect(() => {
// Auth deshabilitado - acceso abierto
}, []);
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
// FIX CRÍTICO: updateForm debe usar [key], no "value"
const updateForm = useCallback((key: string, value: any) => {
setForm((prev) => ({ ...prev, [key]: value }));
setFormErrors((prev) => prev.filter((k) => k !== key));
}, []);
// Valida los campos obligatorios para crear/editar un seller.
// Retorna la lista de keys faltantes (vacia = todo OK).
// 'tarifa' acepta 0 (cortesias). 'min' es opcional (default 6).
const validateRequiredSellerFields = useCallback((f: Record<string, any>): { keys: string[]; labels: string[] } => {
const checks: Array<{ key: string; label: string; ok: (v: any) => boolean }> = [
{ key: 'sid', label: 'Seller ID', ok: (v) => String(v ?? '').trim() !== '' },
{ key: 'seller', label: 'Seller', ok: (v) => String(v ?? '').trim() !== '' },
{ key: 'sec', label: 'Seccion', ok: (v) => String(v ?? '').trim() !== '' },
{ key: 'kam', label: 'KAM', ok: (v) => String(v ?? '').trim() !== '' },
{ key: 'cont', label: 'Contacto', ok: (v) => String(v ?? '').trim() !== '' },
{ key: 'mail', label: 'Email', ok: (v) => String(v ?? '').trim() !== '' },
// Para addSeller/editSeller la key es 'tipo'; para close es 'plan'. Acepta cualquiera.
{ key: f.tipo !== undefined ? 'tipo' : 'plan', label: 'Plan', ok: (v) => String(v ?? '').trim() !== '' },
// Tarifa: acepta 0 pero no '' ni null ni undefined
{ key: 'tarifa', label: 'Tarifa', ok: (v) => v !== '' && v !== null && v !== undefined && !isNaN(Number(v)) },
{ key: 'fContrato', label: 'F. Contrato', ok: (v) => String(v ?? '').trim() !== '' },
// Meses Dcto: acepta 0
{ key: 'dcto', label: 'Meses Dcto', ok: (v) => v !== '' && v !== null && v !== undefined && !isNaN(Number(v)) },
];
const missing = checks.filter((c) => !c.ok(f[c.key]));
return { keys: missing.map((m) => m.key), labels: missing.map((m) => m.label) };
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
const [p, s, kc, pc] = await Promise.all([
fetchProspects(),
fetchSellers(),
fetchKamsCupos(),
fetchPricingConfig(),
]);
// Si tu ./api retorna {data, error}, esto mantiene el comportamiento anterior
if ((p as any).error) show((p as any).error.message ?? 'Error cargando prospects', false);
if ((s as any).error) show((s as any).error.message ?? 'Error cargando sellers', false);
if ((kc as any).error) show((kc as any).error.message ?? 'Error cargando kams_cupos', false);
// Multicuenta: si la migracion aun no corre, degradar sin romper la app.
if ((pc as any).error) console.warn('[multicuenta] pricing_config:', (pc as any).error.message);
setProspects(((p as any).data || []).map(mapProspect));
setSellers(((s as any).data || []).map(mapSeller));
setKamsCupos(((kc as any).data || []).map(mapKamCupo));
setPricingCfg((pc as any).data ? mapPricingConfig((pc as any).data) : DEFAULT_PRICING);
}, [show]);
useEffect(() => {
refreshAll().then(() => setReady(true));
const channel = supabase
.channel('db-changes')
.on('postgres_changes', { event: '*', schema: 'public', table: 'sellers' }, () => {
refreshAll();
})
.on('postgres_changes', { event: '*', schema: 'public', table: 'prospects' }, () => {
refreshAll();
})
.on('postgres_changes', { event: '*', schema: 'public', table: 'kams_cupos' }, () => {
refreshAll();
})
.on('postgres_changes', { event: '*', schema: 'public', table: 'pricing_config' }, () => {
refreshAll();
})
.subscribe();
return () => { supabase.removeChannel(channel); };
}, [refreshAll]);
// Limpiar errores de form cada vez que se abre/cierra un modal
useEffect(() => {
setFormErrors([]);
}, [modal]);
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
() => {
var hoy = new Date().toISOString().slice(0, 10);
// Filtrar prospectos y sellers segun la categoria activa (fCat)
var prospectsByCat = fCat === 'Todos' ? prospects : prospects.filter((p) => p.c === fCat);
var sellersByCat = fCat === 'Todos' ? sellers : sellers.filter((s) => s.sec === fCat);
var base: { name: string; count: number; fill: string }[] = STAGES.filter((s) => s !== 'Cerrados').map((s) => ({ name: s as string, count: prospectsByCat.filter((p) => p.st === s).length, fill: SC[s] }));
base.push({ name: 'Cerrados', count: sellersByCat.filter((s) => s.status === 'Iniciado' && s.tipo === 'Full' && s.fContrato > hoy).length, fill: C.tertiary });
base.push({ name: 'Activos', count: sellersByCat.filter((s) => s.status === 'Iniciado' && s.tipo === 'Full' && s.fContrato <= hoy).length, fill: C.primary });
return base;
},
[prospects, sellers, fCat]
);
/* ──────────────────────────────────────────────────────────────
MULTICUENTA — clusters derivados de la tabla sellers.
La posicion (1ª, 2ª, 3ª…) se calcula aqui en cada render: NUNCA se guarda.
────────────────────────────────────────────────────────────── */
const mc = useMemo(() => computeMulticuenta(sellers, pricingCfg), [sellers, pricingCfg]);
// Cobro unificado: cuentas multicuenta facturan tarifa_base × % de su
// posicion (con la misma ventana de f_contrato); el resto, como siempre.
const chargeFor = (s: Seller, mi: number, year: number = CURRENT_YEAR): ChargeInfo => {
const info = mc.bySid.get(s.sid);
if (!info) return getMonthlyCharge(s, mi, year);
return getMulticuentaCharge(s, info.pct, pricingCfg, mi, year);
};
// Principales disponibles para asociar una secundaria en el formulario.
const principalesDisponibles = mc.principales;
// Nueva logica de cupos multi-KAM:
// - kamsCuposCalc: detalle por (gerencia, kam) con usados/disponibles
// - cuposCalc: agregado por gerencia (suma de cupos de todos los KAMs)
//
// "Usados" se calculan dinamicamente desde sellers: un seller cuenta para SU kam,
// no para una cuota global de la gerencia.
const kamsCuposCalc = useMemo(() => {
return kamsCupos.map((kc) => {
// Sellers individuales: 1 cuenta = 1 cupo, criterio original.
const individuales = sellers.filter(
(s) => s.sec === kc.gerencia && s.kam === kc.kam && s.tipo === 'Full' && s.status !== 'Fuga' && !mc.mcSids.has(s.sid)
).length;
// Cuentas multicuenta: pareo ceil(activas del KAM / divisor) POR cluster.
// Pausa/Fuga liberan cupo automaticamente (solo cuentan las activas).
const deMulticuenta = mc.cuposKamGer.get(kc.kam + '|' + kc.gerencia) || 0;
const u = individuales + deMulticuenta;
return {
id: kc.id,
gerencia: kc.gerencia,
kam: kc.kam,
total: kc.cupoTotal,
usados: u,
disp: Math.max(0, kc.cupoTotal - u),
};
});
}, [kamsCupos, sellers, mc]);
// Agregado por gerencia (compatibilidad + visualizacion colapsada)
const cuposCalc = useMemo(() => {
return CATEGORIAS.map((cat) => {

const rowsCat = kamsCuposCalc.filter((r) => r.gerencia === cat);
const total = rowsCat.reduce((a, r) => a + r.total, 0);
const usados = rowsCat.reduce((a, r) => a + r.usados, 0);
const disp = Math.max(0, total - usados);
// "e" mantiene retrocompatibilidad: nombres de KAMs concatenados (display only).
const kamsLabel = rowsCat.length > 0 ? rowsCat.map((r) => r.kam).join(', ') : (KAM_POR_CATEGORIA[cat] || '-');
return { g: cat, e: kamsLabel, u: usados, d: disp, total, kams: rowsCat };
});
}, [kamsCuposCalc]);
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
() => sellers.filter((s) => s.status === 'Iniciado' || s.status === 'Pausa' || (s.status === 'Fuga' && s.fTermino)),
[sellers]
);
const revenueSellersForTotals = useMemo(
() => sellers.filter((s) => s.status === 'Iniciado' || s.status === 'Pausa'),
[sellers]
);
const byPlan = (arr: Seller[], plan: SellerPlan) => arr.filter((s) => s.tipo === plan);
const monthlyBreakdown = useMemo<MonthlyRow[]>(
() =>
MONTHS_SHORT.map((name, mi) => {
const r: MonthlyRow = { name, idx: mi, Full: 0, Premium: 0, Basico: 0, total: 0 };
PLAN_TYPES.forEach((p) => {
r[p] = byPlan(revenueSellersForTotals, p).reduce((sum, s) => sum + chargeFor(s, mi).amount, 0);
});
r.total = PLAN_TYPES.reduce((sum, p) => sum + (r[p] || 0), 0);
return r;

}),
[revenueSellersForTotals, mc, pricingCfg]
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
var hoy = new Date().toISOString().slice(0, 10);
const cerr = sellers.filter((s) => s.status === 'Iniciado' && s.tipo === 'Full' && s.fContrato > hoy).length;
const actReal = sellers.filter((s) => s.status === 'Iniciado' && s.tipo === 'Full' && s.fContrato <= hoy).length;
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
tot: sellers.filter((s) => s.status === 'Iniciado' || s.status === 'Pausa').length,
act: activeSellers.length,
actFull: actReal,
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
revenue: revenueSellersForTotals.filter((s) => s.sec === cat).reduce((sum, s) => sum + chargeFor(s, CURRENT_MONTH).amount, 0),
})).filter((c) => c.revenue > 0),
[revenueSellersForTotals]
);
const planRevDist = useMemo(
() =>
PLAN_TYPES.map((p) => ({
name: p,
value: byPlan(revenueSellers, p).reduce((sum, s) => sum + chargeFor(s, CURRENT_MONTH).amount, 0),
fill: PLAN_COLORS[p],
})).filter((d) => d.value > 0),
[revenueSellers]
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
const activeCat = catSellers.filter((s) => s.status !== 'Fuga');
const monthTotals = MONTHS_SHORT.map((_, mi) => activeCat.reduce((sum, s) => sum + chargeFor(s, mi).amount, 0));
const yearTotal = monthTotals.reduce((a, b) => a + b, 0);
const planBreakdown: GroupedByCat['planBreakdown'] = {

Full: { count: catSellers.length, sellers: catSellers },
Premium: { count: 0, sellers: [] },
Basico: { count: 0, sellers: [] },
};
return { cat, sellers: catSellers, monthTotals, yearTotal, planBreakdown };
}).filter((g) => g.sellers.length > 0);
}, [revenueSellers, mc, pricingCfg]);
// ── Grouped data PREMIUM (solo sellers Premium)
const groupedPremiumByCat = useMemo<GroupedByCat[]>(() => {
const allPremium = revenueSellers.filter((s) => s.tipo === 'Premium');
if (allPremium.length === 0) return [];
const activePremium = allPremium.filter((s) => s.status !== 'Fuga');
const monthTotals = MONTHS_SHORT.map((_, mi) => activePremium.reduce((sum, s) => sum + chargeFor(s, mi).amount, 0));
const yearTotal = monthTotals.reduce((a, b) => a + b, 0);
return [{
cat: 'Electro' as Categoria, // placeholder, no se usa visualmente
sellers: allPremium,
monthTotals,
yearTotal,
planBreakdown: {
Full: { count: 0, sellers: [] },
Premium: { count: allPremium.length, sellers: allPremium },
Basico: { count: 0, sellers: [] },
},
}];
}, [revenueSellers, mc, pricingCfg]);
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
// Verificar que al menos UN KAM de esa gerencia tenga cupo disponible.
const algunKamConCupo = kamsCuposCalc.some((r) => r.gerencia === p.c && r.disp > 0);
if (!algunKamConCupo) {
show('Sin cupos en ' + p.c + ' (ningun KAM disponible)', false);
return;
}
setForm({ plan: 'Full', tarifa: 990000, dcto: 2, min: 6, sec: p.c, kam: '' });
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
kam: '', // se elegira manualmente en el modal
});
setModal({ type: 'close', data: p });
};
const confirmClose = () => {
if (!modal || modal.type !== 'close') {
show('Error', false);
return;
}
// Validar campos obligatorios
const validation = validateRequiredSellerFields(form);
if (validation.keys.length > 0) {
setFormErrors(validation.keys);
show('Faltan campos obligatorios: ' + validation.labels.join(', '), false);
return;

}
const p = modal.data;
const doSeller = () => {
// Validar cupo del KAM elegido (no de la gerencia agregada).
const seccion = (form.sec || p.c) as Categoria;
const kamElegido = String(form.kam || '').trim();
if (!kamElegido) {
show('Debes seleccionar un KAM', false);
return;
}
const kamRow = kamsCuposCalc.find((r) => r.gerencia === seccion && r.kam === kamElegido);
if (!kamRow) {
show('El KAM "' + kamElegido + '" no esta asignado a ' + seccion, false);
return;
}
if (kamRow.disp <= 0 && p.st !== 'Cerrados') {
show('Sin cupos para ' + kamElegido + ' en ' + seccion, false);
return;
}
// Ya no usamos upsertCupo: los usados son derivados de la tabla sellers.
upsertSeller({
sid: form.sid || p.id,
seller: form.seller || p.s,
seccion: seccion,
kam: kamElegido,
contacto: form.cont || p.n || '',
mail: form.mail || p.m || '',
status: 'Iniciado',
tipo: form.plan || 'Full',
tarifa: Number(form.tarifa) || 0,
f_contrato: form.fContrato,
f_termino: null,
dcto: Number(form.dcto) || 2,
min_meses: Number(form.min) || 6,
custom_dctos: {},
})
.then((res: any) => {
if (res.error) {
show(res.error.message, false);
return;
}
// === NOTIFICACION TEAMS: nuevo seller en Cobros ===
notifySellerEvent({
event: 'created',
seller: {
sid: form.sid || p.id,
seller: form.seller || p.s,

mail: form.mail || p.m || '',
contacto: form.cont || p.n || '',
seccion: form.sec || p.c,
tipo: form.plan || 'Full',
kam: kamElegido,
},
eventDate: form.fContrato,
kamEmail: user?.email || '',
});
// ============================================
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
// Validar campos obligatorios
const validation = validateRequiredSellerFields(form);
if (validation.keys.length > 0) {
setFormErrors(validation.keys);
show('Faltan campos obligatorios: ' + validation.labels.join(', '), false);
return;
}
// === Detectar el tipo de evento ANTES de guardar ===
const prevSeller = sellers.find((s) => s.sid === form.sid);
const newStatus = form.status || 'Iniciado';
const prevStatus = prevSeller?.status;
let event: 'created' | 'fuga' | 'pausa' | 'reactivacion' | null = null;
if (form._isNew) {
event = 'created';
} else if (prevStatus && prevStatus !== newStatus) {
if (newStatus === 'Fuga') event = 'fuga';
else if (newStatus === 'Pausa') event = 'pausa';

else if (newStatus === 'Iniciado' && prevStatus === 'Pausa') event = 'reactivacion';
}
// ===================================================
// ─ Multicuenta: coherencia del vinculo antes de guardar ─
const seraPrincipal = !!form.esMulticuenta && !form.principalSid;
const dependientes = sellers.filter((x) => x.principalSid && x.principalSid === (form._origSid || form.sid));
if (dependientes.length > 0 && !seraPrincipal) {
show('Esta cuenta es principal de ' + dependientes.length + ' secundaria(s). Reasignalas antes de cambiarla.', false);
return;
}
if (form.esMulticuenta && form.principalSid) {
if (form.principalSid === form.sid) {
show('Una cuenta no puede asociarse a si misma', false);
return;
}
const pr = sellers.find((x) => x.sid === form.principalSid);
if (!pr || !pr.esMulticuenta || pr.principalSid) {
show('La cuenta principal seleccionada no es valida (debe ser una principal multicuenta)', false);
return;
}
}
upsertSeller({
sid: form.sid,
seller: form.seller,
seccion: form.sec,
kam: form.kam || '-',
contacto: form.cont || '',
mail: form.mail || '',
status: newStatus,
tipo: form.tipo || 'Full',
tarifa: Number(form.tarifa) || 0,
f_contrato: form.fContrato || null,
f_termino: form.fTermino || null,
dcto: Number(form.dcto) || 0,
min_meses: Number(form.min) || 6,
custom_dctos: form.customDctos || {},
es_multicuenta: !!form.esMulticuenta,
principal_sid: form.esMulticuenta && form.principalSid ? form.principalSid : null,
}).then((res: any) => {
if (res.error) {
show(res.error.message, false);
return;
}
// === NOTIFICACION TEAMS: disparar mensaje segun el evento detectado ===
if (event) {
// Determinar fecha del evento segun el tipo:
// - created: f_contrato (fecha de inicio del servicio)
// - fuga: f_termino del seller
// - pausa/reactivacion: hoy (es la fecha en que se hace el cambio)
const today = new Date().toISOString().slice(0, 10);
let eventDate: string;
if (event === 'created') {
eventDate = form.fContrato || today;
} else if (event === 'fuga') {
eventDate = form.fTermino || today;
} else {
eventDate = today;
}
notifySellerEvent({
event,
seller: {
sid: form.sid,
seller: form.seller,
mail: form.mail || '',
contacto: form.cont || '',
seccion: form.sec,

tipo: form.tipo || 'Full',
kam: form.kam || '-',
},
eventDate,
kamEmail: user?.email || '',
});
}
// ================================================================
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
// Cada fila de kamsCuposCalc se actualiza con el nuevo cupo_total ingresado.
Promise.all(
kamsCuposCalc.map((k) =>
upsertKamCupo({
id: k.id,
gerencia: k.gerencia,
kam_nombre: k.kam,
cupo_total: Number(form['t_' + k.id] ?? k.total),
})
)
).then(() =>
refreshAll().then(() => {
show('Cupos actualizados');
setModal(null);
})
);
};
const addKam = (gerencia: Categoria, kamNombre: string) => {
const nombre = kamNombre.trim();
if (!nombre) {

show('Ingresa el nombre del KAM', false);
return;
}
// Check duplicado
const yaExiste = kamsCupos.some((k) => k.gerencia === gerencia && k.kam.toLowerCase() === nombre.toLowerCase());
if (yaExiste) {
show('Ese KAM ya esta en ' + gerencia, false);
return;
}
upsertKamCupo({ gerencia, kam_nombre: nombre, cupo_total: 12 }).then((res: any) => {
if (res.error) {
show(res.error.message, false);
return;
}
refreshAll().then(() => show('KAM ' + nombre + ' agregado a ' + gerencia));
});
};
const removeKam = (kc: { id: string; gerencia: string; kam: string }) => {
// Validar que no tenga sellers activos
const sellersDelKam = sellers.filter(
(s) => s.sec === kc.gerencia && s.kam === kc.kam && s.status !== 'Fuga' && s.tipo === 'Full'
).length;
if (sellersDelKam > 0) {
show(
'No se puede quitar a ' + kc.kam + ': tiene ' + sellersDelKam + ' seller(s) Full activo(s). Reasignalos primero.',
false
);
return;
}
if (!window.confirm('Quitar a ' + kc.kam + ' de ' + kc.gerencia + '?')) return;
deleteKamCupo(kc.id).then((res: any) => {
if (res.error) {
show(res.error.message, false);
return;
}
refreshAll().then(() => show(kc.kam + ' removido de ' + kc.gerencia));
});
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
hasError={formErrors.includes(k)}
/>
);
console.log('Premium sellers in revenueSellers:', revenueSellers.filter(s => s.tipo === 'Premium'));
console.log('groupedPremiumByCat:', groupedPremiumByCat);

console.log('Premium sellers detail:', revenueSellers.filter(s => s.tipo === 'Premium').map(s => ({ seller: s.seller, sec: s.sec })));
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
<span style={{ fontSize: 14, fontWeight: 600 }}>Cargando...</span>
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
<div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: FONT_FAMILY }}>
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
{rf('KAM', 'kam', { options: kamsCuposCalc.filter((r) => r.gerencia === (form.sec || modal.data.c)).map((r) => r.kam) })}
{rf('Contacto', 'cont')}
{rf('Email', 'mail')}
{rf('Plan', 'plan', { options: PLAN_TYPES })}
{rf('Tarifa', 'tarifa', { type: 'number', w: '1 1 140px' })}
{rf('F. Contrato', 'fContrato', { type: 'date', w: '1 1 140px' })}
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
{rf('KAM', 'kam', { options: kamsCuposCalc.filter((r) => r.gerencia === form.sec).map((r) => r.kam) })}
{rf('Contacto', 'cont')}
{rf('Email', 'mail')}
{rf('Status', 'status', { options: ['Iniciado', 'Pausa', 'Fuga'] })}
{rf('Tipo', 'tipo', { options: PLAN_TYPES })}
{rf('Tarifa', 'tarifa', { type: 'number', w: '1 1 120px' })}
{rf('F.Contrato', 'fContrato', { type: 'date' })}
{rf('F.Termino', 'fTermino', { type: 'date' })}
{rf('Meses Dcto', 'dcto', { type: 'number', w: '1 1 80px' })}
{rf('Min Meses', 'min', { type: 'number', w: '1 1 80px' })}
{/* ── MULTICUENTA: el KAM solo marca el check y elige rol; % y cupos los deriva la plataforma ── */}
<div style={{ flex: '1 1 100%', padding: '10px 12px', background: C.bgAlt, borderRadius: 8, border: '1px dashed ' + C.border, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
<label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: C.text, cursor: 'pointer' }}>
<input
type="checkbox"
checked={!!form.esMulticuenta}
onChange={(e) => {
updateForm('esMulticuenta', e.target.checked);
if (!e.target.checked) updateForm('principalSid', '');
}}
style={{ width: 16, height: 16, accentColor: C.brandDark }}
/>
Multicuenta
</label>
{form.esMulticuenta && (
<div style={{ flex: '1 1 260px' }}>
<label style={{ fontSize: 10, color: C.textMuted, display: 'block', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase' }}>Rol dentro del holding</label>
<select
value={form.principalSid || ''}
onChange={(e) => updateForm('principalSid', e.target.value)}
style={{ width: '100%' }}
>
<option value="">★ Es la cuenta PRINCIPAL (100%)</option>
{principalesDisponibles
.filter((p) => p.sid !== form.sid)
.map((p) => (
<option key={p.sid} value={p.sid}>
{'Asociar a: ' + p.seller + ' (' + p.sid + ')'}
</option>
))}
</select>
</div>
)}
{form.esMulticuenta && (() => {
if (!form.principalSid) {
return (
<span style={{ fontSize: 11, color: C.textSec }}>
{'Cobrará el 100% de la tarifa base (' + fmtFull(Math.round(pricingCfg.tarifaBase)) + '/mes).'}
</span>
);
}
const info = mc.bySid.get(form.principalSid);
const n = info ? info.activas : 1;
const yaEsMiembro = mc.bySid.has(form.sid);
const posEst = yaEsMiembro && mc.bySid.get(form.sid)?.pos ? mc.bySid.get(form.sid)!.pos! : n + 1;
const pctEst = getPctForPosition(posEst - 1, pricingCfg);
return (
<span style={{ fontSize: 11, color: C.textSec }}>
{'Posición estimada: ' + posEst + 'ª → ' + pctEst + '% = ' + fmtFull(Math.round((pricingCfg.tarifaBase * pctEst) / 100)) + '/mes (se recalcula sola por F.Contrato y estados). El cupo se parea automáticamente con el KAM elegido.'}
</span>
);
})()}
</div>
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
<h3 style={{ margin: '0 0 8px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
Editar Cupos por KAM
</h3>
<p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 16px' }}>
Los "usados" se calculan automaticamente. Solo edita el cupo total de cada KAM.

</p>
{CATEGORIAS.map((cat) => {
const kamsCat = kamsCuposCalc.filter((r) => r.gerencia === cat);
if (kamsCat.length === 0) return null;
return (
<div key={cat} style={{ marginBottom: 18 }}>
<div style={{ fontSize: 12, fontWeight: 700, color: C.textSec, marginBottom: 6, textTransform: 'uppercase' }}>{cat}</div>
{kamsCat.map((k) => (
<div key={k.id} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, paddingLeft: 8 }}>
<span style={{ minWidth: 180, fontSize: 13 }}>{k.kam}</span>
<span style={{ fontSize: 11, color: C.textMuted, minWidth: 70 }}>{'Usados: ' + k.usados}</span>
<div style={{ flex: 1 }}>
<label style={{ fontSize: 10, color: C.textMuted }}>Cupo total</label>
<input
type="number"
min={0}
value={form['t_' + k.id] ?? k.total}
onChange={(e) => updateForm('t_' + k.id, e.target.value)}
style={{ width: '100%' }}
/>
</div>
</div>
))}
</div>
);
})}
{kamsCuposCalc.length === 0 && (
<p style={{ fontSize: 13, color: C.textMuted, textAlign: 'center', padding: '20px 0' }}>
No hay KAMs configurados. Primero agrega KAMs en "gestionar KAMs".
</p>
)}
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
{modal.type === 'manageKams' && (
<>
<h3 style={{ margin: '0 0 8px', color: C.primary, fontSize: 17, fontWeight: 700 }}>
Gestionar KAMs por Categoria
</h3>
<p style={{ fontSize: 12, color: C.textMuted, margin: '0 0 16px' }}>

Agrega o quita KAMs por categoria. Al agregar, se asignan 12 cupos por defecto (editable luego en "editar cupos").
</p>
{CATEGORIAS.map((cat) => {
const kamsCat = kamsCuposCalc.filter((r) => r.gerencia === cat);
const inputKey = 'newKam_' + cat;
return (
<div key={cat} style={{ marginBottom: 18, paddingBottom: 12, borderBottom: '1px solid ' + C.borderLight }}>
<div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>{cat}</div>
{kamsCat.length === 0 && (
<div style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic', marginBottom: 8, paddingLeft: 8 }}>
Sin KAMs asignados.
</div>
)}
{kamsCat.map((k) => (
<div key={k.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', fontSize: 12 }}>
<span>
{k.kam} <span style={{ color: C.textMuted }}>{'(' + k.usados + '/' + k.total + ')'}</span>
</span>
<button
className="btn btn-ghost"
style={{ fontSize: 11, padding: '2px 8px', color: C.danger }}
onClick={() => removeKam({ id: k.id, gerencia: k.gerencia, kam: k.kam })}
>
quitar
</button>
</div>
))}
<div style={{ display: 'flex', gap: 8, marginTop: 8, paddingLeft: 8 }}>
<input
type="text"
placeholder="Nombre nuevo KAM..."
value={form[inputKey] ?? ''}
onChange={(e) => updateForm(inputKey, e.target.value)}
style={{ flex: 1, fontSize: 12 }}
/>
<button
className="btn btn-primary btn-sm"
style={{ fontSize: 11, padding: '4px 10px' }}
onClick={() => {
addKam(cat, String(form[inputKey] ?? ''));
updateForm(inputKey, '');
}}
>
+ agregar
</button>
</div>
</div>

);
})}
<div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
<button className="btn btn-primary" onClick={() => setModal(null)}>
Cerrar
</button>
</div>
</>
)}
{modal.type === 'editMonthCharge' &&
(() => {
const s = modal.data.seller;
const mi = modal.data.monthIdx;
const ch = chargeFor(s, mi, modal.data.year);
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
className="header-wrap"
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
<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
<div className="fb-banderola" style={{ width: 34, height: 50, fontSize: 30, flexShrink: 0 }}>f</div>
<div>
<h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text, letterSpacing: '-0.3px', lineHeight: 1.15 }}>
{/* === Boton admin: forzar envio reporte cobros === */}
{isAdminUser && (
<button
className="btn btn-ghost"
style={{ fontSize: 11, padding: '4px 10px' }}
onClick={async () => {
const monthStr = window.prompt(
'Que mes generar? Formato: YYYY-MM (ej: 2026-05). Vacio = mes actual',
''
);
let year: number | undefined;
let month: number | undefined;
if (monthStr && monthStr.trim()) {
const parts = monthStr.trim().split('-');
if (parts.length === 2) {
year = parseInt(parts[0]);
month = parseInt(parts[1]);
if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
show('Formato invalido. Usa YYYY-MM', false);
return;

}
}
}
if (!window.confirm(
'Enviar reporte de cobros' + (year && month ? ' para ' + year + '-' + String(month).padStart(2,'0') : ' del mes actual') + '?'
)) return;
show('Generando reporte...');
const res = await triggerMonthlyBillingReport({ year, month });
if (res.ok) {
const d = res.details as any;
show('Reporte enviado: ' + (d?.sellersFacturados || 0) + ' sellers facturados');
} else {
show('Error: ' + (res.error || 'desconocido'), false);
}
}}title="Genera y envia el reporte de cobros del mes actual al canal de Teams"
>
Forzar envio cobros
</button>
)}
{/* ================================================ */}
  
  sellers elite
</h1>
<p style={{ margin: '2px 0 0', fontSize: 11, color: C.textMuted }}>
programa de membresía · falabella marketplace
</p>
</div>
</div>
<div className="tab-nav" style={{ display: 'flex', gap: 2, background: C.bgAlt, padding: 3, borderRadius: 10 }}>
{(([
['dashboard', 'Dashboard'],
['sellers', 'Cobros'],
['hunting', 'Hunting Full'],
] as [Tab, string][]).concat(isAdminUser ? ([['admin', 'Admin']] as [Tab, string][]) : [])).map((item) => (
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
{/* USER + LOGOUT */}
<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
<div

style={{
display: 'flex',
alignItems: 'center',
gap: 8,
padding: '5px 10px 5px 5px',
borderRadius: 999,
background: C.bgAlt,
border: '1px solid ' + C.borderLight,
maxWidth: 220,
}}
title={user?.email || ''}
>
<div
style={{
width: 26,
height: 26,
borderRadius: '50%',
background: C.primary,
color: '#fff',
display: 'flex',
alignItems: 'center',
justifyContent: 'center',
fontSize: 12,
fontWeight: 800,
flexShrink: 0,
}}
>
{(user?.email || '?').charAt(0).toUpperCase()}
</div>
<span
style={{
fontSize: 12,
color: C.textSec,
fontWeight: 600,
overflow: 'hidden',
textOverflow: 'ellipsis',
whiteSpace: 'nowrap',
}}
>
{user?.email || ''}
</span>
</div>
<button
className="btn btn-ghost btn-sm"
onClick={() => {
if (window.confirm('¿Cerrar sesión?')) signOut();

}}
title="Cerrar sesión"
style={{
display: 'flex',
alignItems: 'center',
gap: 4,
fontWeight: 600,
}}
>
⎋ Salir
</button>
</div>
</div>
{/* ═══ HUNTING ═══ */}
{tab === 'hunting' && (
<div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
<div className="kpi-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
<KpiCard label="Pipeline" value={kpi.pipe} color={C.purple} />
<KpiCard label="No Interesado" value={kpi.noInt} color={C.danger} />
<KpiCard label="Activos" value={kpi.actFull} color={C.primary} />
<KpiCard label="Cerrados" value={kpi.cerr} color={C.tertiary} />
<KpiCard label="Cupos Disp." value={kpi.cupD} color={kpi.cupD > 0 ? C.primary : C.danger} />
<KpiCard label="Cupos Total" value={cuposCalc.reduce((a, c) => a + c.total, 0)} color={C.secondary} />
</div>
<div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
<div className="card" style={{ padding: 18 }}>
<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
<h3 style={{ margin: 0, fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
Cupos por Categoria
</h3>
<div style={{ display: 'flex', gap: 12 }}>
<span
className="action-icon"
style={{ fontSize: 12 }}
onClick={() => {
setForm({});
setModal({ type: 'manageKams' });
}}
title="Agregar o quitar KAMs por categoria"
>
gestionar KAMs
</span>
<span
className="action-icon"
style={{ fontSize: 12 }}
onClick={() => {

setForm({});
setModal({ type: 'editCupos' });
}}
title="Editar el cupo total de cada KAM"
>
editar cupos
</span>
</div>
</div>
{cuposCalc.map((c, i) => {
const tot = c.total;
const pct = tot > 0 ? (c.u / tot) * 100 : 0;
const expanded = !!expandedGerencias[c.g];
return (
<div key={i} style={{ marginBottom: 10 }}>
<div
style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, cursor: 'pointer' }}
onClick={() => setExpandedGerencias((prev) => ({ ...prev, [c.g]: !prev[c.g] }))}
>
<span style={{ fontWeight: 600 }}>
<span style={{ display: 'inline-block', width: 12, color: C.textMuted, fontSize: 10 }}>{expanded ? '▼' : '▶'}</span>
{c.g} <span style={{ color: C.textMuted, fontWeight: 400 }}>{'(' + c.kams.length + ' KAM' + (c.kams.length !== 1 ? 's' : '') + ')'}</span>
</span>
<span style={{
color: pct >= 83 ? C.primary : pct >= 66 ? C.warning : C.danger,
fontWeight: 700,
fontSize: 11
}}>
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
background: pct >= 83 ? C.primary : pct >= 66 ? C.warning : C.danger,
}}
/>
</div>
{expanded && (
<div style={{ marginTop: 8, paddingLeft: 14, borderLeft: '2px solid ' + C.borderLight }}>
{c.kams.length === 0 ? (
<div style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic', padding: '4px 0' }}>
Sin KAMs asignados. Click en "gestionar KAMs" para agregar.

</div>
) : (
c.kams.map((k) => {
const kPct = k.total > 0 ? (k.usados / k.total) * 100 : 0;
return (
<div key={k.id} style={{ marginBottom: 6 }}>
<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
<span style={{ color: C.textSec }}>{k.kam}</span>
<span style={{ color: kPct >= 83 ? C.primary : kPct >= 66 ? C.warning : C.danger, fontWeight: 600, fontSize: 10 }}>
{k.usados + '/' + k.total + ' (' + k.disp + ' disp)'}
</span>
</div>
<div style={{ height: 4, background: C.bgDark, borderRadius: 2, overflow: 'hidden' }}>
<div
style={{
height: '100%',
borderRadius: 2,
width: kPct + '%',
background: kPct >= 83 ? C.primary : kPct >= 66 ? C.warning : C.danger,
}}
/>
</div>
</div>
);
})
)}
</div>
)}
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
<Bar
dataKey="count"
radius={[0, 6, 6, 0]}
onClick={(data: any) => {
// Solo las primeras 5 barras (ProspectStage) filtran el listado.
// La barra "Activos" es informativa, no filtra.
var name = data && data.name;
if (!name || name === 'Activos') return;
// Toggle: si ya esta seleccionada, deselecciona (vuelve a Todos).
setFSt(fSt === name ? 'Todos' : (name as ProspectStage));
}}
style={{ cursor: 'pointer' }}
>
{funnel.map((e, i) => {
var isClickable = e.name !== 'Activos';
var isSelected = fSt !== 'Todos' && e.name === fSt;
var isFaded = fSt !== 'Todos' && e.name !== fSt && isClickable;
return (
<Cell
key={i}
fill={e.fill}
fillOpacity={isSelected ? 1 : isFaded ? 0.35 : 0.85}
stroke={isSelected ? C.text : 'none'}
strokeWidth={isSelected ? 2 : 0}
cursor={isClickable ? 'pointer' : 'default'}
/>
);
})}
</Bar>
</BarChart>
</ResponsiveContainer>
</div>
</div>
<div className="card" style={{ overflow: 'hidden' }}>
<div
className="filter-bar"
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
<button className="btn btn-ghost btn-sm" onClick={() => {
downloadCSV('hunting_' + new Date().toISOString().slice(0, 10) + '.csv',
['ID', 'Seller', 'Categoria', 'Tipo', 'Status', 'Contacto', 'Email', 'Tel', 'Nota'],
filt.map(function(p) { return [p.id, p.s, p.c, p.t, p.st, p.n, p.m, p.tel, p.note]; })
);
}}>Descargar</button>
</div>
<div
className="hunt-head"
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
className="row-hover hunt-row"
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

<div className="filter-bar" style={{ padding: '10px 14px', display: 'flex', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid ' + C.border, alignItems: 'center', background: C.bgAlt }}>
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
setForm({ sec: CATEGORIAS[0], status: 'Iniciado', tipo: 'Full', tarifa: 990000, min: 6, dcto: 2, _isNew: true, customDctos: {}, esMulticuenta: false, principalSid: '' });
setModal({ type: 'addSeller' });
}}
>
+ Agregar
</button>
<button className="btn btn-ghost btn-sm" onClick={() => {
downloadCSV('cobros_' + new Date().toISOString().slice(0, 10) + '.csv',
['Seller', 'SID', 'Seccion', 'KAM', 'Status', 'Tipo', 'Tarifa', 'Dcto', 'Min', 'F.Contrato', 'F.Termino', 'Contacto', 'Email'],
filteredSellers.map(function(s) { return [s.seller, s.sid, s.sec, s.kam, s.status, s.tipo, String(s.tarifa), String(s.dcto), String(s.min), s.fContrato, s.fTermino, s.cont, s.mail]; })
);
}}>Descargar</button>
</div>
<div
className="sell-head"
style={{
display: 'grid',
gridTemplateColumns: '2fr 1.2fr .8fr .8fr .7fr .7fr .7fr .7fr .4fr',
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
<SortHeader label="Min" sortKey="min" current={sellSort} onSort={(k) => toggleSort(setSellSort, sellSort, k)} />
<div>Dcto</div>
<SortHeader label="Fecha Contrato" sortKey="fContrato" current={sellSort} onSort={(k) => toggleSort(setSellSort, sellSort, k)} />
<div />
</div>
<div style={{ maxHeight: 500, overflowY: 'auto' }}>
{filteredSellers.map((s) => (
<div
key={s.sid}
className="row-hover sell-row"
style={{
display: 'grid',
gridTemplateColumns: '2fr 1.2fr .8fr .8fr .7fr .7fr .7fr .7fr .4fr',
padding: '10px 14px',
borderBottom: '1px solid ' + C.borderLight,
cursor: 'pointer',
alignItems: 'center',
background: selS?.sid === s.sid ? C.primaryLight : undefined,
}}
onClick={() => setSelS(selS?.sid === s.sid ? null : s)}
>
<div>
<div style={{ fontWeight: 600, fontSize: 13 }}>
{s.seller}
{(() => {
const i = mc.bySid.get(s.sid);
if (!i) return null;
return (
<span style={{ marginLeft: 6, verticalAlign: 'middle', display: 'inline-flex', gap: 4 }}>
<Pill color={C.brandDark}>{i.pos ? 'MC ' + i.pos + 'ª · ' + i.pct + '%' : 'MC inactiva'}</Pill>
{i.esPrincipalTemporal && <Pill color={C.warning}>⚠ 1ª temporal</Pill>}
</span>
);
})()}
</div>
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
<div style={{ fontSize: 11, color: C.textSec }}>{s.fContrato || '-'}</div>

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
{/* ═══ ADMIN: REGLAS MULTICUENTA ═══ */}
{tab === 'admin' && isAdminUser && (
<AdminTab cfg={pricingCfg} userEmail={user?.email || ''} show={show} refreshAll={refreshAll} />
)}
{tab === 'dashboard' && (
<div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
<div className="kpi-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: 1 }}>
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
<div className="chart-scroll">
<div className="chart-scroll-inner" style={{ minWidth: 520 }}>
<ResponsiveContainer width="100%" height={280}>
<BarChart data={histogramData} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
<XAxis dataKey="name" tick={{ fill: C.textSec, fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
<YAxis tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: any) => fmt(Number(v))} />
<Tooltip
contentStyle={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10, fontSize: 12 }}
formatter={(v: any, name: any) => [fmtFull(Number(v)), String(name ?? '')]}
/>
{PLAN_TYPES.map((plan) => {
const isFirst = plan === 'Full';

const isTop = plan === PLAN_TYPES[PLAN_TYPES.length - 1];
return (
<Bar key={plan} dataKey={plan} stackId="a" radius={isTop ? [4, 4, 0, 0] : undefined}>
{histogramData.map((entry: any, idx: number) => (
<Cell key={idx} fill={StackedBarCell(plan, entry.idx > CURRENT_MONTH)} />
))}
{isFirst && (
<LabelList position="top" content={(props: any) => { const { x, y, width, height, index } = props; const d = histogramData[index]; if (!d || !d.total || !d.Full) return null; var pxPerUnit = height / d.Full; var offset = ((d.Premium || 0) + (d.Basico || 0)) * pxPerUnit; return (<text x={x + width / 2} y={y - offset - 6} textAnchor="middle" fontSize={9} fontWeight={700} fill="#5A6473">{fmt(d.total)}</text>); }} />
)}
</Bar>
);
})}
</BarChart>
</ResponsiveContainer>
</div>
</div>
<div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 8 }}>
<div style={{ display: 'flex', gap: 16 }}>
{PLAN_TYPES.map((p) => (
<div key={p} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
<span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: PLAN_COLORS[p] }} />
<span>{p}</span>
</div>
))}
</div>
<div style={{ display: 'flex', gap: 16 }}>
<div style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
<span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: C.primary }} />
<span style={{ color: C.textSec }}>Real</span>
</div>
<div style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
<span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: PLAN_COLORS_LIGHT.Full, border: '1px dashed ' + C.textMuted }} />
<span style={{ color: C.textSec }}>Proyectado</span>
</div>
</div>
</div>
</div>
{/* Cards */}
<div className="grid-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
<div className="card" style={{ padding: 18 }}>
<h3 style={{ margin: '0 0 12px', fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
Ingresos por Categoria
</h3>
<ResponsiveContainer width="100%" height={200}>
<BarChart data={revByCategory}>
<XAxis dataKey="name" tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} />

<YAxis tick={{ fill: C.textMuted, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={(v: any) => fmt(Number(v))} />
<Tooltip contentStyle={{ background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 10, fontSize: 12 }} formatter={(v: any) => fmtFull(Number(v))} />
<Bar dataKey="revenue" radius={[6, 6, 0, 0]} fill={C.primary} fillOpacity={0.85}>
<LabelList dataKey="revenue" position="top" formatter={(v: any) => fmt(Number(v))} style={{ fontSize: 9, fontWeight: 700, fill: C.textSec }} />
</Bar>
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
innerRadius={40}
outerRadius={65}
dataKey="value"
label={(props: any) => {
var RADIAN = Math.PI / 180;
var cx2 = props.cx; var cy2 = props.cy;
var midAngle = props.midAngle;
var outerRadius2 = props.outerRadius;
var x = cx2 + (outerRadius2 + 16) * Math.cos(-midAngle * RADIAN);
var y = cy2 + (outerRadius2 + 16) * Math.sin(-midAngle * RADIAN);
return (<text x={x} y={y} textAnchor={x > cx2 ? 'start' : 'end'} dominantBaseline="central" fontSize={10} fontWeight={700} fill={C.textSec}>{props.name + ' ' + fmt(props.value)}</text>);
}}
labelLine={{ stroke: C.textMuted, strokeWidth: 1 }}
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
innerRadius={40}
outerRadius={65}
dataKey="value"
label={(props: any) => {
var RADIAN = Math.PI / 180;
var cx2 = props.cx; var cy2 = props.cy;
var midAngle = props.midAngle;
var outerRadius2 = props.outerRadius;
var x = cx2 + (outerRadius2 + 16) * Math.cos(-midAngle * RADIAN);
var y = cy2 + (outerRadius2 + 16) * Math.sin(-midAngle * RADIAN);
return (<text x={x} y={y} textAnchor={x > cx2 ? 'start' : 'end'} dominantBaseline="central" fontSize={10} fontWeight={700} fill={C.textSec}>{props.name + ' (' + props.value + ')'}</text>);
}}
labelLine={{ stroke: C.textMuted, strokeWidth: 1 }}
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
<div style={{ padding: '12px 16px', borderBottom: '1px solid ' + C.border, background: C.bgAlt, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
<h3 style={{ margin: 0, fontSize: 13, color: C.textSec, fontWeight: 700, textTransform: 'uppercase' }}>
{'Resumen Ingresos ' + CURRENT_YEAR}
</h3>
<button className="btn btn-ghost btn-sm" onClick={() => {
var hdrs: string[] = ['Plan'].concat(MONTHS_SHORT.slice() as unknown as string[]).concat(['Total']);
var rws: string[][] = PLAN_TYPES.map(function(plan): string[] {
return ([plan] as string[]).concat(monthlyBreakdown.map(function(m) { return String(m[plan] || 0); })).concat([String(monthlyBreakdown.reduce(function(s, m) { return s + (m[plan] || 0); }, 0))]);
});
rws.push((['TOTAL'] as string[]).concat(monthlyBreakdown.map(function(m) { return String(m.total); })).concat([String(projectedRev)]));
downloadCSV('resumen_ingresos_' + CURRENT_YEAR + '.csv', hdrs, rws);
}}>Descargar</button>
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
<button className="btn btn-sm btn-ghost" onClick={() => {
var hdrs = ['Seller', 'SID', 'KAM', 'Seccion', 'Status', 'Tarifa', 'Dcto', 'Min', 'F.Contrato'].concat(MONTHS_SHORT.slice()).concat(['Total']);
var rws: string[][] = [];
groupedFullByCat.forEach(function(g) {
g.sellers.forEach(function(s) {
var yt = 0;
var meses = MONTHS_SHORT.map(function(_, mi) { var ch = chargeFor(s, mi); yt += ch.amount; return String(ch.amount); });
rws.push([s.seller, s.sid, s.kam, s.sec, s.status, String(s.tarifa), String(s.dcto), String(s.min), s.fContrato].concat(meses).concat([String(yt)]));
});
});
downloadCSV('detalle_cobros_full_' + CURRENT_YEAR + '.csv', hdrs, rws);
}}>Descargar</button>
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
<span style={{ fontSize: 10, color: C.textMuted, fontWeight: 500 }}>{'(' + group.sellers.filter((s) => s.status !== 'Fuga').length + ' Full)'}</span>
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
{s.status === 'Pausa' && (
<span style={{ marginLeft: 4, fontSize: 9, color: C.warning, fontWeight: 700 }}>PAUSA</span>

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
const ch = chargeFor(s, mi);
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
<button className="btn btn-sm btn-ghost" onClick={() => {
var hdrs = ['Seller', 'SID', 'KAM', 'Seccion', 'Status', 'Tarifa', 'Dcto', 'Min', 'F.Contrato'].concat(MONTHS_SHORT.slice()).concat(['Total']);
var rws: string[][] = [];
groupedPremiumByCat.forEach(function(g) {
g.sellers.forEach(function(s) {
var yt = 0;
var meses = MONTHS_SHORT.map(function(_, mi) { var ch = chargeFor(s, mi); yt += ch.amount; return String(ch.amount); });
rws.push([s.seller, s.sid, s.kam, s.sec, s.status, String(s.tarifa), String(s.dcto), String(s.min), s.fContrato].concat(meses).concat([String(yt)]));
});

});
downloadCSV('detalle_cobros_premium_' + CURRENT_YEAR + '.csv', hdrs, rws);
}}>Descargar</button>
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
Premium
<span style={{ fontSize: 10, color: C.textMuted, fontWeight: 500 }}>{'(' + group.sellers.filter((s) => s.status !== 'Fuga').length + ' sellers)'}</span>
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
{s.status === 'Pausa' && (
<span style={{ marginLeft: 4, fontSize: 9, color: C.warning, fontWeight: 700 }}>PAUSA</span>
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
const ch = chargeFor(s, mi);
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
<div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
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
export default function App() {
return (
<AuthGate>
<AppInner />
</AuthGate>
);
}
