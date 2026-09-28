import { supabase } from './supabaseClient';
export { supabase };

/** PROSPECTS */
export const fetchProspects = () => supabase.from('prospects').select('*');

export const upsertProspect = (row: any) =>
  supabase.from('prospects').upsert(row, { onConflict: 'id' });

export const deleteProspectDB = (id: string) =>
  supabase.from('prospects').delete().eq('id', id);

export const updateProspectStatus = (id: string, status: string) =>
  supabase.from('prospects').update({ status }).eq('id', id);

/** SELLERS */
export const fetchSellers = () => supabase.from('sellers').select('*');

export const upsertSeller = (row: any) =>
  supabase.from('sellers').upsert(row, { onConflict: 'sid' });

export const deleteSellerDB = (sid: string) =>
  supabase.from('sellers').delete().eq('sid', sid);

/** CUPOS (legacy) - mantenido por compatibilidad pero ya no se usa */
export const fetchCupos = () => supabase.from('cupos').select('*');

export const upsertCupo = (row: any) =>
  supabase.from('cupos').upsert(row, { onConflict: 'gerencia' });

/** KAMS_CUPOS - nuevo modelo: 1 fila por (gerencia, KAM) */
export const fetchKamsCupos = () =>
  supabase.from('kams_cupos').select('*').order('gerencia').order('kam_nombre');

export const upsertKamCupo = (row: {
  id?: string;
  gerencia: string;
  kam_nombre: string;
  cupo_total: number;
}) =>
  supabase
    .from('kams_cupos')
    .upsert(row, { onConflict: 'gerencia,kam_nombre' });

export const deleteKamCupo = (id: string) =>
  supabase.from('kams_cupos').delete().eq('id', id);

export const checkAllowedEmail = async (email: string) => {
  const { data, error } = await supabase
    .from('allowed_emails')
    .select('email')
    .eq('email', email.toLowerCase())
    .single();
  return { allowed: !!data && !error };
};

/** ────────────────────────────────────────────────────────────────────────
 *  MULTICUENTA — configuracion de pricing (escalera, tarifa base, cupos)
 *  El vinculo principal/secundaria vive en columnas de `sellers`
 *  (es_multicuenta, principal_sid) y viaja en el upsertSeller normal.
 *  ──────────────────────────────────────────────────────────────────────── */

/** PRICING_CONFIG (fila unica id=1, editable desde el panel Admin) */
export const fetchPricingConfig = () =>
  supabase.from('pricing_config').select('*').eq('id', 1).single();

export const updatePricingConfig = (patch: Record<string, any>) =>
  supabase.from('pricing_config').update(patch).eq('id', 1);

/** Update parcial de un seller (condiciones congeladas del holding, KAM, etc.).
 *  Se usa .update() y no .upsert() para no chocar con columnas NOT NULL. */
export const updateSellerFields = (sid: string, patch: Record<string, any>) =>
  supabase.from('sellers').update(patch).eq('sid', sid);

/** ────────────────────────────────────────────────────────────────────────
 *  CIERRES DE COBRO — snapshots inmutables por mes (solo lectura desde la
 *  app; los escribe la Edge Function send-monthly-billing-report).
 *  ──────────────────────────────────────────────────────────────────────── */
export const fetchBillingPeriods = () =>
  supabase
    .from('billing_periods')
    .select('period, closed_at, closed_by, source, engine_version')
    .order('period');

/** Limite de filas por respuesta de PostgREST (max_rows del proyecto). */
const BILLING_LINES_PAGE_SIZE = 1000;

export const fetchBillingLines = async (
  periods: readonly string[]
): Promise<{ data: Record<string, unknown>[]; error: { message: string } | null }> => {
  const data: Record<string, unknown>[] = [];
  if (periods.length === 0) return { data, error: null };
  for (let from = 0; ; from += BILLING_LINES_PAGE_SIZE) {
    const { data: page, error } = await supabase
      .from('billing_period_lines')
      .select('*')
      .in('period', periods as string[])
      .order('period')
      .order('sid')
      .range(from, from + BILLING_LINES_PAGE_SIZE - 1);
    if (error) return { data, error };
    data.push(...(page || []));
    if (!page || page.length < BILLING_LINES_PAGE_SIZE) return { data, error: null };
  }
};
