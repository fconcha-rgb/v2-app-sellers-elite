/* ════════════════════════════════════════════════════════════════════════════
   MEMBRESIAS — un mismo seller (Seller ID) con mas de una membresia.
   Caso: el seller paga dos veces el servicio para tener dos KAMs; cada
   membresia ocupa un cupo de su KAM y se cobra aparte. Finanzas la recibe en
   una sola linea por Seller ID (ver buildBillingReportRows en el motor).
   Logica pura: sin React ni Supabase.
   ════════════════════════════════════════════════════════════════════════════ */

export type MembershipLike = { sid: string; sellerId: string; seller: string; kam: string; status: string; tipo: string };
export type SellerStatusAgg = 'Iniciado' | 'Pausa' | 'Fuga';
export type SellerEvent = 'created' | 'fuga' | 'pausa' | 'reactivacion';

export const membershipsOf = <T extends { sellerId: string }>(sellers: readonly T[], sellerId: string): T[] =>
  sellers.filter((s) => s.sellerId === sellerId);

/** Estado del SELLER a partir de sus membresias: activo si alguna esta activa. */
export const aggregateStatus = (statuses: readonly string[]): SellerStatusAgg | null => {
  if (statuses.length === 0) return null;
  if (statuses.includes('Iniciado')) return 'Iniciado';
  if (statuses.includes('Pausa')) return 'Pausa';
  return 'Fuga';
};

/** Aviso a Teams (Looker y Salesforce) que corresponde a un cambio.
 *  Esas cuentas son una por Seller ID: una membresia extra no crea cuenta
 *  nueva, y pausar o dar de baja una membresia no corta el acceso mientras
 *  otra siga activa. Por eso se compara el estado del seller antes y despues.
 *  Con una sola membresia da lo mismo que comparar la fila. */
export const sellerAccessEvent = (
  before: readonly string[],
  after: readonly string[],
  creatingMembership: boolean
): SellerEvent | null => {
  const prev = aggregateStatus(before);
  const next = aggregateStatus(after);
  if (prev == null) return creatingMembership ? 'created' : null;
  if (prev === next) return null;
  if (next === 'Fuga') return 'fuga';
  if (next === 'Pausa') return 'pausa';
  if (prev === 'Pausa') return 'reactivacion';
  // Vuelve un seller que estaba en Fuga: solo una membresia nueva re-crea sus cuentas.
  return creatingMembership ? 'created' : null;
};

/** Motivo por el que no se puede crear otra membresia del seller; null si se puede. */
export const newMembershipProblem = (
  existing: readonly MembershipLike[],
  candidate: { tipo: string; kam: string; esMulticuenta: boolean }
): string | null => {
  if (candidate.tipo !== 'Full') return 'Una segunda membresia es solo para plan Full, con otro KAM.';
  if (candidate.esMulticuenta) return 'Una segunda membresia no puede ser multicuenta: se cobra completa.';
  const mismoKam = existing.find((m) => m.status !== 'Fuga' && m.kam === candidate.kam);
  if (mismoKam) return 'Este seller ya tiene una membresia vigente con ' + candidate.kam + '. Elige otro KAM.';
  return null;
};

/** Al editar: otra membresia vigente del mismo seller con el mismo KAM. */
export const kamCollision = (
  others: readonly MembershipLike[],
  row: { kam: string; status: string; tipo: string }
): MembershipLike | null =>
  row.status === 'Fuga' || row.tipo !== 'Full'
    ? null
    : others.find((m) => m.status !== 'Fuga' && m.tipo === 'Full' && m.kam === row.kam) ?? null;

/** Cuantos sellers distintos hay (las membresias de un mismo Seller ID cuentan una vez). */
export const uniqueSellerCount = (rows: readonly { sellerId: string }[]): number => new Set(rows.map((r) => r.sellerId)).size;

/** Sellers por estado agregado (para KPIs de sellers, no de cupos). */
export const sellersByAggregateStatus = (rows: readonly { sellerId: string; status: string }[]): Record<SellerStatusAgg, number> => {
  const bySeller = new Map<string, string[]>();
  rows.forEach((r) => bySeller.set(r.sellerId, [...(bySeller.get(r.sellerId) ?? []), r.status]));
  const out: Record<SellerStatusAgg, number> = { Iniciado: 0, Pausa: 0, Fuga: 0 };
  bySeller.forEach((statuses) => {
    const agg = aggregateStatus(statuses);
    if (agg) out[agg]++;
  });
  return out;
};
