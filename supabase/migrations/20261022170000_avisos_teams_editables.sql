-- ════════════════════════════════════════════════════════════════════════════
-- Avisos a Teams editables desde Admin › Avisos a Teams (como en Sellers Growth).
--
-- Las URLs de los webhooks se guardan en un esquema privado (la API no lo
-- expone). Las funciones send-seller-notification y send-monthly-billing-report
-- usan la URL guardada desde la app y, si no hay, la del secreto de Supabase
-- (TEAMS_WEBHOOK_DATA / _SOPORTE / _COBROS), asi nada cambia hasta que un
-- administrador guarde una URL. Solo se aceptan destinos de Microsoft.
--
-- Administradores: se_privado.admins. Para dar acceso a alguien mas, agregalo
-- aqui y en ADMIN_EMAILS de src/App.tsx (que muestra la pestaña Admin).
-- (Aplicada en Supabase como elite_avisos_teams_editables.)
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists se_privado;
revoke all on schema se_privado from public, anon, authenticated;

create table if not exists se_privado.ajustes (
  clave text primary key,
  valor text not null,
  actualizado timestamptz not null default now(),
  actualizado_por text
);
create table if not exists se_privado.admins (
  email text primary key
);
alter table se_privado.ajustes enable row level security;
alter table se_privado.admins enable row level security;
revoke all on all tables in schema se_privado from public, anon, authenticated;

insert into se_privado.admins (email) values ('fconcha@falabella.cl') on conflict do nothing;

create or replace function public.se_es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from se_privado.admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;
revoke all on function public.se_es_admin() from public, anon;
grant execute on function public.se_es_admin() to authenticated, service_role;

-- Estado de cada aviso: si tiene URL propia guardada desde la app y a que dominio envia.
-- La URL completa nunca se devuelve.
create or replace function public.se_estado_avisos()
returns table (tipo text, en_app boolean, destino text, actualizado timestamptz, actualizado_por text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.se_es_admin() then
    raise exception 'Solo un administrador puede ver los avisos.' using errcode = '42501';
  end if;
  return query
    select t.tipo,
           coalesce(a.valor, '') <> '',
           case when coalesce(a.valor, '') <> '' then substring(a.valor from '^https://([^/:]+)') end,
           a.actualizado,
           a.actualizado_por
    from (values ('data'), ('soporte'), ('cobros')) as t(tipo)
    left join se_privado.ajustes a on a.clave = 'webhook_' || t.tipo;
end $$;
revoke all on function public.se_estado_avisos() from public, anon;
grant execute on function public.se_estado_avisos() to authenticated;

-- Cambia la URL de un aviso. Texto vacio = volver a la URL del secreto de Supabase.
create or replace function public.se_guardar_webhook(p_tipo text, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.se_es_admin() then
    raise exception 'Solo un administrador puede cambiar los avisos.' using errcode = '42501';
  end if;
  if p_tipo not in ('data', 'soporte', 'cobros') then
    raise exception 'Tipo de aviso desconocido.' using errcode = '22023';
  end if;
  p_url := btrim(coalesce(p_url, ''));
  if p_url <> '' and (length(p_url) > 2000
     or p_url !~* '^https://([a-z0-9-]+\.)*(logic\.azure\.com|powerplatform\.com|webhook\.office\.com|office\.com)(:443)?/') then
    raise exception 'Pega la URL completa del webhook de Teams o Power Automate (empieza con https://).' using errcode = '22023';
  end if;
  insert into se_privado.ajustes (clave, valor, actualizado, actualizado_por)
  values ('webhook_' || p_tipo, p_url, now(), nullif(auth.jwt() ->> 'email', ''))
  on conflict (clave) do update
    set valor = excluded.valor, actualizado = now(), actualizado_por = excluded.actualizado_por;
end $$;
revoke all on function public.se_guardar_webhook(text, text) from public, anon;
grant execute on function public.se_guardar_webhook(text, text) to authenticated;

-- Para las Edge Functions (service_role): { data, soporte, cobros } con las URLs guardadas desde la app
create or replace function public.se_leer_webhooks() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(substring(clave from 9), valor) filter (where valor <> ''), '{}'::jsonb)
  from se_privado.ajustes
  where clave like 'webhook\_%'
$$;
revoke all on function public.se_leer_webhooks() from public, anon, authenticated;
grant execute on function public.se_leer_webhooks() to service_role;
