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
