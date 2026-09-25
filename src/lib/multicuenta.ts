/* ════════════════════════════════════════════════════════════════════════════
   MULTICUENTA — logica pura (sin React, sin Supabase)
   Modelo integrado en la tabla `sellers`:
     · es_multicuenta = true  y  principal_sid = null  → cuenta PRINCIPAL
     · es_multicuenta = true  y  principal_sid = <sid> → cuenta SECUNDARIA
   La escalera (posicion, %, sucesion) la define el motor de cobro compartido
   (supabase/functions/_shared/billing.ts) para que dashboard y reporte de
   Cobros apliquen exactamente la misma regla. Aqui se agrega lo propio de la
   UI: tags, selector de principales y pareo de cupos por KAM.
   La posicion se deriva del estado ACTUAL; los meses cerrados conservan la
   posicion aplicada en su snapshot de billing.
   ════════════════════════════════════════════════════════════════════════════ */
import {
  SELLER_STATUS,
  rankHoldings,
  type HoldingPosition,
  type PricingConfig,
} from '../../supabase/functions/_shared/billing.ts';
import type { ISODate } from './period.ts';

export {
  DEFAULT_PRICING,
  getPctForPosition,
  mapPricingConfig,
  mapPricingOverride,
  type PricingConfig,
} from '../../supabase/functions/_shared/billing.ts';

export const ACTIVE_SELLER_STATUS = SELLER_STATUS.active;

/** Serializa condiciones para congelarlas en un holding (sellers.pricing_override).
 *  `congeladoEl` = fecha de negocio en que se pactaron. */
export const toPricingOverride = (cfg: PricingConfig, porQuien: string, congeladoEl: ISODate) => ({
  tarifaBase: cfg.tarifaBase,
  pctPos: cfg.pctPos,
  pctPos6Plus: cfg.pctPos6Plus,
  cupoDivisor: cfg.cupoDivisor,
  congeladoEl,
  congeladoPor: porQuien,
});

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
  /** Solo en la PRINCIPAL: condiciones congeladas del holding.
   *  null = el holding sigue las reglas generales vigentes. */
  pricingOverride?: PricingConfig | null;
  customDctos?: Record<string, number>;
};

export type McInfo = Omit<HoldingPosition, 'cfg'>;

export type McResult = {
  /** solo sids que pertenecen a un cluster valido */
  bySid: Map<string, McInfo>;
  /** mismas posiciones con sus condiciones: entrada del motor de cobro */
  positions: ReadonlyMap<string, HoldingPosition>;
  mcSids: Set<string>;
  /** principales designadas (para el selector del formulario) */
  principales: SellerMC[];
  /** cluster completo por sid de principal (orden: escalera + inactivas al final) */
  clusterOf: Map<string, SellerMC[]>;
  /** cupos ya "ceileados" por cluster, agregados por clave `${kam}|${gerencia}` */
  cuposKamGer: Map<string, number>;
  /** secundarias cuyo principal_sid no apunta a una principal valida (facturan individual) */
  huerfanas: string[];
  /** Config efectiva de cada holding (congelada si la tiene, si no la global) */
  cfgOf: Map<string, PricingConfig>;
  /** Misma config, indexada por cada cuenta del holding */
  cfgBySid: Map<string, PricingConfig>;
  /** sids de principales con condiciones congeladas */
  congelados: Set<string>;
};

/** Deriva clusters, posiciones, sucesion y cupos a partir de la tabla sellers. */
export const computeMulticuenta = (sellers: SellerMC[], cfgGlobal: PricingConfig): McResult => {
  const ranking = rankHoldings(sellers, cfgGlobal);
  const cfgBySid = new Map<string, PricingConfig>();
  ranking.bySid.forEach((info, sid) => cfgBySid.set(sid, info.cfg));

  // Cupos: pareo POR KAM (y gerencia) dentro del cluster, solo Full activas.
  // ceil se aplica POR CLUSTER: 2 cuentas KAM A = 1 cupo; 3 = 2; 2+2 en dos
  // KAMs = 1+1. Pausa/Fuga liberan cupo automaticamente (no cuentan).
  const cuposKamGer = new Map<string, number>();
  ranking.ladderOf.forEach((ladder, principalSid) => {
    const divisor = Math.max(1, (ranking.cfgOf.get(principalSid) || cfgGlobal).cupoDivisor);
    const counts = new Map<string, number>();
    ladder
      .filter((m) => m.tipo === 'Full')
      .forEach((m) => {
        const k = m.kam + '|' + m.sec;
        counts.set(k, (counts.get(k) || 0) + 1);
      });
    counts.forEach((n, k) => cuposKamGer.set(k, (cuposKamGer.get(k) || 0) + Math.ceil(n / divisor)));
  });

  return {
    bySid: ranking.bySid,
    positions: ranking.bySid,
    mcSids: new Set(ranking.bySid.keys()),
    principales: ranking.principales,
    clusterOf: ranking.clusterOf,
    cuposKamGer,
    huerfanas: ranking.huerfanas,
    cfgOf: ranking.cfgOf,
    cfgBySid,
    congelados: ranking.congelados,
  };
};
