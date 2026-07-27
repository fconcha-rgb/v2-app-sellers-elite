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
 *  MULTICUENTAS — grupos, vinculos y configuracion de pricing
 *  (Los mappers snake_case → camelCase viven en src/lib/groupCalc.ts)
 *  ──────────────────────────────────────────────────────────────────────── */

/** GROUPS */
export const fetchGroups = () =>
  supabase.from('groups').select('*').order('created_at', { ascending: true });

export const insertGroup = (row: {
  nombre_grupo: string;
  rut_principal?: string | null;
  cuenta_principal_sid?: string | null;
  estado?: string;
}) => supabase.from('groups').insert(row).select().single();

export const updateGroup = (id: string, patch: Record<string, any>) =>
  supabase.from('groups').update(patch).eq('id', id);

export const deleteGroupDB = (id: string) =>
  supabase.from('groups').delete().eq('id', id);

/** GROUP_MEMBERS (vinculo cuenta ↔ grupo; posicion SIEMPRE derivada, no se guarda) */
export const fetchGroupMembers = () => supabase.from('group_members').select('*');

export const addGroupMember = (row: {
  group_id: string;
  seller_sid: string;
  fecha_vinculacion: string;
  validado_por?: string | null;
  fecha_validacion?: string | null;
}) => supabase.from('group_members').insert(row);

export const updateGroupMember = (
  groupId: string,
  sellerSid: string,
  patch: Record<string, any>
) =>
  supabase
    .from('group_members')
    .update(patch)
    .eq('group_id', groupId)
    .eq('seller_sid', sellerSid);

export const removeGroupMember = (groupId: string, sellerSid: string) =>
  supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('seller_sid', sellerSid);

/** PRICING_CONFIG (fila unica id=1, editable desde el panel Admin) */
export const fetchPricingConfig = () =>
  supabase.from('pricing_config').select('*').eq('id', 1).single();

export const updatePricingConfig = (patch: Record<string, any>) =>
  supabase.from('pricing_config').update(patch).eq('id', 1);

/** Update parcial de un seller (KAM/status desde la vista de grupo).
 *  Se usa .update() y no .upsert() para no chocar con columnas NOT NULL. */
export const updateSellerFields = (sid: string, patch: Record<string, any>) =>
  supabase.from('sellers').update(patch).eq('sid', sid);
