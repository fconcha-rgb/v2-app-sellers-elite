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

/** CUPOS */
export const fetchCupos = () => supabase.from('cupos').select('*');

export const upsertCupo = (row: any) =>
  supabase.from('cupos').upsert(row, { onConflict: 'gerencia' });