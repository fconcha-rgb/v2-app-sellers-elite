/* ════════════════════════════════════════════════════════════════════════════
   MULTICUENTA — logica pura (sin React, sin Supabase)
   Modelo integrado en la tabla `sellers`:
     · es_multicuenta = true  y  principal_sid = null  → cuenta PRINCIPAL
     · es_multicuenta = true  y  principal_sid = <sid> → cuenta SECUNDARIA
   La posicion ordinal NUNCA se persiste: se deriva aqui en cada render sobre
   las cuentas ACTIVAS (status 'Iniciado') del cluster:
     [principal designada, ...secundarias por f_contrato ASC (empate: sid)]
   Si la principal designada esta en Pausa/Fuga, la activa mas antigua asume
   el 100% (sucesion automatica, con flag). Al reactivarse, retoma sola.
   ════════════════════════════════════════════════════════════════════════════ */

export const ACTIVE_SELLER_STATUS = 'Iniciado';

/* ── Config (tabla pricing_config, fila unica id=1, editable en Admin) ────── */
export type PricingConfig = {
  tarifaBase: number;
  /** % por posicion 1ª..5ª (escala 0–100) */
  pctPos: [number, number, number, number, number];
  /** % 6ª cuenta y siguientes (tope) */
  pctPos6Plus: number;
  /** cuantas cuentas activas del mismo KAM equivalen a 1 cupo (ceil) */
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
  cupoDivisor: Math.max(1, Number(r.cupo_divisor ?? 2)),
  updatedAt: String(r.updated_at ?? ''),
  updatedBy: String(r.updated_by ?? ''),
});

/** % que corresponde al indice 0-based de la escalera (0 = 1ª cuenta). */
export const getPctForPosition = (idx0: number, cfg: PricingConfig): number =>
  idx0 < 5 ? cfg.pctPos[idx0] : cfg.pctPos6Plus;

/* ── Shape minimo del seller que necesita este modulo ─────────────────────── */
export type SellerMC = {
  sid: string;
  seller: string;
  kam: string;
  sec: string;
  status: string;
  tipo: string;
  fContrato: string;
  fTermino: string;
  esMulticuenta: boolean;
  /** sid de la principal (vacio si esta cuenta ES la principal o no es MC) */
  principalSid: string;
  customDctos?: Record<string, number>;
};

export type McInfo = {
  /** posicion en la escalera (1 = principal efectiva); null si esta inactiva */
  pos: number | null;
  /** % de la tarifa base segun posicion; null si inactiva */
  pct: number | null;
  /** sid de la principal designada del cluster */
  principalSid: string;
  esPrincipalDesignada: boolean;
  /** true cuando esta cuenta asume el 100% porque la designada esta inactiva */
  esPrincipalTemporal: boolean;
  /** total de cuentas del cluster (activas + inactivas) */
  clusterSize: number;
  /** cuentas activas del cluster */
  activas: number;
};

export type McResult = {
  /** solo sids que pertenecen a un cluster valido */
  bySid: Map<string, McInfo>;
  mcSids: Set<string>;
  /** principales designadas (para el selector del formulario) */
  principales: SellerMC[];
  /** cluster completo por sid de principal (orden: escalera + inactivas al final) */
  clusterOf: Map<string, SellerMC[]>;
  /** cupos ya "ceileados" por cluster, agregados por clave `${kam}|${gerencia}` */
  cuposKamGer: Map<string, number>;
  /** secundarias cuyo principal_sid no apunta a una principal valida (facturan individual) */
  huerfanas: string[];
};

const byFechaSid = (a: SellerMC, b: SellerMC) => {
  const fa = a.fContrato || '9999-12-31';
  const fb = b.fContrato || '9999-12-31';
  if (fa !== fb) return fa < fb ? -1 : 1;
  return a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0;
};

/** Deriva clusters, posiciones, sucesion y cupos a partir de la tabla sellers. */
export const computeMulticuenta = (sellers: SellerMC[], cfg: PricingConfig): McResult => {
  const bySid = new Map<string, McInfo>();
  const clusterOf = new Map<string, SellerMC[]>();
  const cuposKamGer = new Map<string, number>();
  const huerfanas: string[] = [];

  const principales = sellers
    .filter((s) => s.esMulticuenta && !s.principalSid)
    .slice()
    .sort((a, b) => a.seller.localeCompare(b.seller));
  const principalSet = new Set(principales.map((p) => p.sid));

  // Secundarias colgando de una principal invalida → siguen individuales.
  sellers.forEach((s) => {
    if (s.esMulticuenta && s.principalSid && !principalSet.has(s.principalSid))
      huerfanas.push(s.sid);
  });

  principales.forEach((p) => {
    const secundarias = sellers.filter((s) => s.principalSid === p.sid && s.sid !== p.sid);
    const members = [p, ...secundarias];
    const activas = members.filter((m) => m.status === ACTIVE_SELLER_STATUS);
    const principalActiva = p.status === ACTIVE_SELLER_STATUS;

    // Orden de la escalera (derivado, jamas persistido):
    let ordered: SellerMC[];
    let sucesion = false;
    if (principalActiva) {
      ordered = [p, ...activas.filter((m) => m.sid !== p.sid).sort(byFechaSid)];
    } else {
      ordered = activas.slice().sort(byFechaSid);
      sucesion = ordered.length > 0;
    }

    ordered.forEach((m, i) => {
      bySid.set(m.sid, {
        pos: i + 1,
        pct: getPctForPosition(i, cfg),
        principalSid: p.sid,
        esPrincipalDesignada: m.sid === p.sid,
        esPrincipalTemporal: sucesion && i === 0,
        clusterSize: members.length,
        activas: ordered.length,
      });
    });
    members
      .filter((m) => m.status !== ACTIVE_SELLER_STATUS)
      .forEach((m) => {
        bySid.set(m.sid, {
          pos: null,
          pct: null,
          principalSid: p.sid,
          esPrincipalDesignada: m.sid === p.sid,
          esPrincipalTemporal: false,
          clusterSize: members.length,
          activas: ordered.length,
        });
      });

    const inactivasAlFinal = members.filter((m) => m.status !== ACTIVE_SELLER_STATUS);
    clusterOf.set(p.sid, [...ordered, ...inactivasAlFinal]);

    // Cupos: pareo POR KAM (y gerencia) dentro del cluster, solo Full activas.
    // ceil se aplica POR CLUSTER: 2 cuentas KAM A = 1 cupo; 3 = 2; 2+2 en dos
    // KAMs = 1+1. Pausa/Fuga liberan cupo automaticamente (no cuentan).
    const counts = new Map<string, number>();
    ordered
      .filter((m) => m.tipo === 'Full')
      .forEach((m) => {
        const k = m.kam + '|' + m.sec;
        counts.set(k, (counts.get(k) || 0) + 1);
      });
    counts.forEach((n, k) => {
      const cupos = Math.ceil(n / Math.max(1, cfg.cupoDivisor));
      cuposKamGer.set(k, (cuposKamGer.get(k) || 0) + cupos);
    });
  });

  const mcSids = new Set(bySid.keys());
  return { bySid, mcSids, principales, clusterOf, cuposKamGer, huerfanas };
};

/* ── Cobro mensual de una cuenta multicuenta ──────────────────────────────
   Misma ventana de facturacion que el cobro individual (arranca con
   f_contrato bajo la regla del dia-ancla; Fuga corta en f_termino), pero el
   monto es tarifa_base × % de la posicion. Sin descuento promocional; el
   override manual por mes (custom_dctos) SI se respeta, para que puedas
   ajustar un mes puntual desde la celda como siempre. */
export type ChargeShape = {
  amount: number;
  isDiscount: boolean;
  active: boolean;
  isCustom: boolean;
  isProrated: boolean;
};

const OFF: ChargeShape = { amount: 0, isDiscount: false, active: false, isCustom: false, isProrated: false };

export const getMulticuentaCharge = (
  seller: SellerMC,
  pct: number | null,
  cfg: PricingConfig,
  mIdx: number,
  year: number
): ChargeShape => {
  // Inactiva (Pausa/Fuga): fuera de la escalera → no factura. La posicion no
  // guarda historial: todo el cuadro anual se deriva del estado actual.
  if (pct == null) return { ...OFF };
  const base = Math.round((cfg.tarifaBase * pct) / 100);
  const mk = year + '-' + String(mIdx + 1).padStart(2, '0');
  const customAmt = seller.customDctos ? seller.customDctos[mk] : undefined;

  if (!seller.fContrato) {
    if (customAmt != null)
      return { amount: customAmt, isDiscount: customAmt < base, active: true, isCustom: true, isProrated: false };
    return { amount: base, isDiscount: false, active: true, isCustom: false, isProrated: false };
  }
  const cd = new Date(seller.fContrato);
  const cm = cd.getFullYear() * 12 + cd.getMonth();
  const tm = year * 12 + mIdx;
  if (tm < cm) return { ...OFF };
  if (customAmt != null)
    return { amount: customAmt, isDiscount: customAmt < base, active: true, isCustom: true, isProrated: false };
  return { amount: base, isDiscount: false, active: true, isCustom: false, isProrated: false };
};
