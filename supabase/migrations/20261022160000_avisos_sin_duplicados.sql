-- ════════════════════════════════════════════════════════════════════════════
-- Avisos a Teams sin duplicados.
--
-- Por que: el boton Confirmar/Guardar sigue activo mientras se guarda; un
-- segundo clic repetia el guardado y send-seller-notification publicaba la
-- misma card dos veces en Data y en Soporte.
--
-- Que hace: send-seller-notification reserva cada aviso (evento|sid|fecha)
-- antes de publicarlo. Si el mismo aviso ya se publico hace menos de 5
-- minutos, no se vuelve a publicar. Solo service_role puede usarlo.
-- (Aplicada en Supabase como elite_avisos_sin_duplicados.)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.se_avisos_enviados (
  clave   text primary key,
  enviado timestamptz not null default now()
);
alter table public.se_avisos_enviados enable row level security;
revoke all on table public.se_avisos_enviados from anon, authenticated;

-- true = publicar (primera vez o ya paso la ventana); false = duplicado, no publicar
create or replace function public.se_reservar_aviso(p_clave text, p_ventana_segundos int default 300)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publicar boolean;
begin
  insert into public.se_avisos_enviados as a (clave, enviado)
  values (p_clave, now())
  on conflict (clave) do update set enviado = now()
    where a.enviado < now() - make_interval(secs => p_ventana_segundos)
  returning true into v_publicar;
  return coalesce(v_publicar, false);
end $$;

-- Si Teams rechaza el envio, la reserva queda vencida para que un reintento si publique
create or replace function public.se_liberar_aviso(p_clave text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.se_avisos_enviados set enviado = '-infinity' where clave = p_clave;
$$;

revoke all on function public.se_reservar_aviso(text, int) from public, anon, authenticated;
revoke all on function public.se_liberar_aviso(text) from public, anon, authenticated;
grant execute on function public.se_reservar_aviso(text, int) to service_role;
grant execute on function public.se_liberar_aviso(text) to service_role;
