/* ════════════════════════════════════════════════════════════════════════════
   MULTICUENTAS — LOGICA DE CALCULO (funciones puras, sin estado, testeables)

   Reglas clave del modelo:
   · La POSICION ORDINAL nunca se persiste: se deriva en runtime filtrando
     cuentas con status activo y ordenando [principal, ...por fecha_vinculacion].
   · SUCESION AUTOMATICA: si la principal designada esta en Pausa/Fuga, la
     activa mas antigua toma la posicion 1a (100%) hasta que aquella vuelva.
   · El cobro de cada cuenta arranca desde SU fecha_vinculacion.
   · Cupos: ceil(cuentas_activas_de_ese_KAM / divisor), sumado por KAM.
   · Todos los % , la tarifa base y el divisor vienen de pricing_config
     (tabla editable en Admin) — NUNCA hardcodeados aqui.

   Nota de vocabulario: en la app el status "activo" del negocio se llama
   'Iniciado' (junto a 'Pausa' y 'Fuga'). Este modulo usa ese literal.
   ════════════════════════════════════════════════════════════════════════════ */

export const ACTIVE_SELLER_STATUS = 'Iniciado'; // ≡ "Activo" en el modelo de negocio

export const MESES_CORTOS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
] as const;

/* ── Tipos ────────────────────────────────────────────────────────────────── */

/** Subconjunto de la fila de seller que necesita este modulo (el tipo Seller
 *  de App.tsx lo satisface estructuralmente). */
export type SellerLike = {
  sid: string;
  seller: string;
  kam: string;
  sec: string;
  status: string;
  tipo: string;
};

export type GroupEstado = 'Activo' | 'Inactivo';

export type GroupRow = {
  id: string;
  nombre: string;
  rutPrincipal: string;
  cuentaPrincipalSid: string | null;
  estado: GroupEstado;
  createdAt: string;
};

export type GroupMemberRow = {
  groupId: string;
  sellerSid: string;
  fechaVinculacion: string; // 'YYYY-MM-DD'
  validadoPor: string;
  fechaValidacion: string;
};

export type MemberSeller = { member: GroupMemberRow; seller: SellerLike };

export type GroupJoined = { group: GroupRow; members: MemberSeller[] };

/** Porcentajes en escala 0–100. pctPos[0] = 1a cuenta ... pctPos[4] = 5a. */
export type PricingConfig = {
  tarifaBase: number;
  pctPos: [number, number, number, number, number];
  pctPos6Plus: number;
  cupoDivisor: number;
  updatedAt: string;
  updatedBy: string;
};

export const DEFAULT_PRICING: PricingConfig = {
  tarifaBase: 990000,
  pctPos: [100, 0, 25, 35, 45],
  pctPos6Plus: 50,
  cupoDivisor: 2,
  updatedAt: '',
  updatedBy: '',
};

/* ── Mappers Supabase → app ───────────────────────────────────────────────── */

export const mapGroup = (r: any): GroupRow => ({
  id: String(r.id ?? ''),
  nombre: String(r.nombre_grupo ?? ''),
  rutPrincipal: String(r.rut_principal ?? ''),
  cuentaPrincipalSid: r.cuenta_principal_sid != null ? String(r.cuenta_principal_sid) : null,
  estado: (r.estado as GroupEstado) ?? 'Activo',
  createdAt: String(r.created_at ?? ''),
});

export const mapGroupMember = (r: any): GroupMemberRow => ({
  groupId: String(r.group_id ?? ''),
  sellerSid: String(r.seller_sid ?? ''),
  fechaVinculacion: String(r.fecha_vinculacion ?? ''),
  validadoPor: String(r.validado_por ?? ''),
  fechaValidacion: String(r.fecha_validacion ?? ''),
});

export const mapPricingConfig = (r: any): PricingConfig => ({
  tarifaBase: Number(r.tarifa_base ?? DEFAULT_PRICING.tarifaBase),
  pctPos: [
    Number(r.pct_pos1 ?? 100),
    Number(r.pct_pos2 ?? 0),
    Number(r.pct_pos3 ?? 25),
    Number(r.pct_pos4 ?? 35),
    Number(r.pct_pos5 ?? 45),
  ],
  pctPos6Plus: Number(r.pct_pos6_plus ?? 50),
  cupoDivisor: Math.max(1, Number(r.cupo_divisor ?? 2) || 2),
  updatedAt: String(r.updated_at ?? ''),
  updatedBy: String(r.updated_by ?? ''),
});

/* ── Helpers internos ─────────────────────────────────────────────────────── */

export const isMemberActive = (m: MemberSeller): boolean =>
  m.seller.status === ACTIVE_SELLER_STATUS;

/** Orden estable por fecha_vinculacion ASC; empate → sid (determinista). */
const byVinculacion = (a: MemberSeller, b: MemberSeller): number => {
  const fa = a.member.fechaVinculacion || '';
  const fb = b.member.fechaVinculacion || '';
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a.seller.sid.localeCompare(b.seller.sid);
};

/** 'YYYY-MM-DD' → indice absoluto de mes (year*12+month), o null si invalida. */
const monthNum = (iso: string): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() * 12 + d.getMonth();
};

/* ── 1) ORDINALES + SUCESION DE LA PRINCIPAL ──────────────────────────────── */

export type GroupOrdinals = {
  /** Cuentas ACTIVAS en orden ordinal: [principal efectiva, ...por fecha ASC]. */
  ordered: MemberSeller[];
  /** SID de quien ocupa la posicion 1a HOY (designada, o sucesora automatica). */
  principalEfectivaSid: string | null;
  /** true ⇢ la principal DESIGNADA existe en el grupo pero esta en Pausa/Fuga,
   *  y otra cuenta esta ocupando temporalmente la 1a posicion. */
  sucesionActiva: boolean;
};

export const getGroupOrdinals = (
  members: MemberSeller[],
  cuentaPrincipalSid: string | null
): GroupOrdinals => {
  const activos = members.filter(isMemberActive).slice().sort(byVinculacion);
  if (activos.length === 0)
    return { ordered: [], principalEfectivaSid: null, sucesionActiva: false };

  const idx = cuentaPrincipalSid
    ? activos.findIndex((m) => m.seller.sid === cuentaPrincipalSid)
    : -1;

  if (idx >= 0) {
    // La designada esta activa: toma la 1a; el resto por fecha_vinculacion.
    const principal = activos[idx];
    const resto = activos.filter((_, i) => i !== idx);
    return {
      ordered: [principal, ...resto],
      principalEfectivaSid: principal.seller.sid,
      sucesionActiva: false,
    };
  }

  // La designada no esta activa (o no hay designada): la activa mas antigua
  // asume la 1a. La sucesion es "temporal" solo si existe una designada en
  // el grupo que hoy esta en Pausa/Fuga (cuando reactive, retoma sola).
  const designadaEnGrupo =
    !!cuentaPrincipalSid && members.some((m) => m.seller.sid === cuentaPrincipalSid);
  return {
    ordered: activos,
    principalEfectivaSid: activos[0].seller.sid,
    sucesionActiva: designadaEnGrupo,
  };
};

/* ── 2) ESCALERA DE PRICING ───────────────────────────────────────────────── */

/** % para la posicion 0-based (0 = 1a cuenta). ≥5 → tope 6a+. */
export const getPctForPosition = (pos0: number, cfg: PricingConfig): number =>
  pos0 < 5 ? cfg.pctPos[pos0] ?? 0 : cfg.pctPos6Plus;

/** Monto de UNA cuenta en un mes dado: aplica su % ordinal desde su
 *  fecha_vinculacion (antes de vincularse no factura). */
export const getMemberMonthAmount = (
  fechaVinculacion: string,
  pct: number,
  cfg: PricingConfig,
  mIdx: number,
  year: number
): number => {
  const vm = monthNum(fechaVinculacion);
  if (vm == null) return 0;
  if (year * 12 + mIdx < vm) return 0;
  return Math.round((cfg.tarifaBase * pct) / 100);
};

export type GroupPricingLine = {
  sid: string;
  seller: string;
  kam: string;
  tipo: string;
  status: string;
  fechaVinculacion: string;
  validadoPor: string;
  fechaValidacion: string;
  activa: boolean;
  /** 1-based; null para cuentas en Pausa/Fuga (fuera de la escalera). */
  posicion: number | null;
  pct: number | null;
  monto: number;
  esPrincipalEfectiva: boolean;
  esPrincipalDesignada: boolean;
};

export type GroupPricing = {
  lines: GroupPricingLine[];
  totalMes: number;
  activas: number;
  sucesionActiva: boolean;
  principalEfectivaSid: string | null;
};

/** Cobro del grupo para un mes: desglose por cuenta (posicion, % y monto).
 *  Incluye tambien las cuentas inactivas (monto 0) para poder listarlas. */
export const getGroupPricing = (
  members: MemberSeller[],
  cuentaPrincipalSid: string | null,
  cfg: PricingConfig,
  mIdx: number,
  year: number
): GroupPricing => {
  const { ordered, principalEfectivaSid, sucesionActiva } = getGroupOrdinals(
    members,
    cuentaPrincipalSid
  );

  const lines: GroupPricingLine[] = ordered.map((m, i) => {
    const pct = getPctForPosition(i, cfg);
    return {
      sid: m.seller.sid,
      seller: m.seller.seller,
      kam: m.seller.kam,
      tipo: m.seller.tipo,
      status: m.seller.status,
      fechaVinculacion: m.member.fechaVinculacion,
      validadoPor: m.member.validadoPor,
      fechaValidacion: m.member.fechaValidacion,
      activa: true,
      posicion: i + 1,
      pct,
      monto: getMemberMonthAmount(m.member.fechaVinculacion, pct, cfg, mIdx, year),
      esPrincipalEfectiva: m.seller.sid === principalEfectivaSid,
      esPrincipalDesignada: m.seller.sid === cuentaPrincipalSid,
    };
  });

  // Cuentas fuera de la escalera (Pausa/Fuga): visibles, sin posicion ni cobro.
  members
    .filter((m) => !isMemberActive(m))
    .slice()
    .sort(byVinculacion)
    .forEach((m) => {
      lines.push({
        sid: m.seller.sid,
        seller: m.seller.seller,
        kam: m.seller.kam,
        tipo: m.seller.tipo,
        status: m.seller.status,
        fechaVinculacion: m.member.fechaVinculacion,
        validadoPor: m.member.validadoPor,
        fechaValidacion: m.member.fechaValidacion,
        activa: false,
        posicion: null,
        pct: null,
        monto: 0,
        esPrincipalEfectiva: false,
        esPrincipalDesignada: m.seller.sid === cuentaPrincipalSid,
      });
    });

  return {
    lines,
    totalMes: lines.reduce((s, l) => s + l.monto, 0),
    activas: ordered.length,
    sucesionActiva,
    principalEfectivaSid,
  };
};

/** Totales del grupo para los 12 meses de un año (misma composicion actual:
 *  la posicion es derivada del estado presente, coherente con el modelo). */
export const getGroupMonthTotals = (
  members: MemberSeller[],
  cuentaPrincipalSid: string | null,
  cfg: PricingConfig,
  year: number
): number[] => {
  const { ordered } = getGroupOrdinals(members, cuentaPrincipalSid);
  const totals = new Array(12).fill(0) as number[];
  ordered.forEach((m, i) => {
    const pct = getPctForPosition(i, cfg);
    for (let mi = 0; mi < 12; mi++) {
      totals[mi] += getMemberMonthAmount(m.member.fechaVinculacion, pct, cfg, mi, year);
    }
  });
  return totals;
};

/* ── 3) CUPOS DE CARTERA ──────────────────────────────────────────────────── */

export type GroupCupos = {
  porKam: { kam: string; cuentas: number; cupos: number }[];
  total: number;
};

/** ceil(cuentas_activas_Full_de_ese_KAM / divisor), sumado por KAM.
 *  Los cupos de cartera hoy se administran solo sobre plan Full — se mantiene
 *  ese criterio para que el numero calce con la barra de cupos existente. */
export const getGroupCupos = (members: MemberSeller[], divisor: number): GroupCupos => {
  const div = Math.max(1, Math.floor(divisor) || 1);
  const counts = new Map<string, number>();
  members
    .filter((m) => isMemberActive(m) && m.seller.tipo === 'Full')
    .forEach((m) => {
      const k = m.seller.kam || '-';
      counts.set(k, (counts.get(k) || 0) + 1);
    });
  const porKam = Array.from(counts.entries())
    .map(([kam, cuentas]) => ({ kam, cuentas, cupos: Math.ceil(cuentas / div) }))
    .sort((a, b) => a.kam.localeCompare(b.kam));
  return { porKam, total: porKam.reduce((s, r) => s + r.cupos, 0) };
};

/** Cupos que un grupo aporta a una fila (gerencia, KAM) especifica de la barra
 *  global de cupos — integra el modelo grupal al conteo existente. */
export const getGroupCuposForKamGerencia = (
  members: MemberSeller[],
  kam: string,
  gerencia: string,
  divisor: number
): number => {
  const div = Math.max(1, Math.floor(divisor) || 1);
  const n = members.filter(
    (m) =>
      isMemberActive(m) &&
      m.seller.tipo === 'Full' &&
      m.seller.kam === kam &&
      m.seller.sec === gerencia
  ).length;
  return n > 0 ? Math.ceil(n / div) : 0;
};
