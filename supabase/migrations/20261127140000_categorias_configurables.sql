-- ════════════════════════════════════════════════════════════════════════════
-- Categorias configurables (Admin › Cupos y KAMs › gestionar categorías).
--
-- Hasta nov-2026 las categorias (gerencias) estaban fijas en el codigo
-- (CATEGORIAS en src/App.tsx). Ahora viven en esta tabla y un administrador
-- agrega nuevas desde la app (ej. Internacional SOF) sin volver a publicar.
--
-- Los datos siguen guardando el NOMBRE de la categoria como texto:
--   sellers.seccion · prospects.categoria · kams_cupos.gerencia
-- No hay FK (hay sellers con seccion 'NA' y los cierres de cobro guardan el
-- texto historico), por eso un nombre no se renombra: se agrega o, si nadie
-- lo usa, se quita.
--
-- Que hace (aditiva; la version anterior de la app sigue funcionando igual):
--   1. Tabla public.categorias (nombre, orden) con las 5 de siempre.
--   2. Nombre valido: sin espacios sobrantes, 2 a 40 caracteres, unico sin
--      importar mayusculas y no reservado ('Todos' es el filtro de la app).
--   3. No se puede borrar ni renombrar una categoria en uso (KAMs, sellers o
--      prospectos): la base lo impide aunque la app falle.
--   4. RLS: leen los usuarios de Elite (allowed_emails); agregan y quitan solo
--      los administradores (se_privado.admins). Grants explicitos.
--   5. Realtime: las sesiones abiertas ven la categoria nueva al instante.
-- (Aplicada en Supabase como elite_categorias_configurables.)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Tabla ---------------------------------------------------------------------
create table if not exists public.categorias (
  nombre      text primary key,
  orden       integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text default nullif(auth.jwt() ->> 'email', '')
);

comment on table public.categorias is
  'Categorias (gerencias) del programa Sellers Elite. El nombre es el texto que guardan sellers.seccion, prospects.categoria y kams_cupos.gerencia.';
comment on column public.categorias.orden is
  'Orden en la app (barras de cupos, filtros, formularios). Una categoria nueva queda al final.';

-- 2. Nombre valido -------------------------------------------------------------
alter table public.categorias drop constraint if exists categorias_nombre_valido;
alter table public.categorias add constraint categorias_nombre_valido check (
  nombre = btrim(nombre)
  and nombre !~ '\s\s'
  and char_length(nombre) between 2 and 40
  and lower(nombre) not in ('todos', 'na', '-')
);

create unique index if not exists categorias_nombre_unico_ci on public.categorias (lower(nombre));

insert into public.categorias (nombre, orden, created_by) values
  ('Electro', 1, 'migracion'),
  ('Muebles/Hogar', 2, 'migracion'),
  ('Cat Dig', 3, 'migracion'),
  ('Moda', 4, 'migracion'),
  ('Belleza/Calzado', 5, 'migracion')
on conflict do nothing;

-- 3. Categoria en uso: no se borra ni se renombra --------------------------------
create or replace function public.categorias_proteger_en_uso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uso text;
begin
  if tg_op = 'UPDATE' and new.nombre = old.nombre then
    return new;
  end if;
  select concat_ws(', ',
           (select nullif(count(*), 0) || ' KAM(s)'       from public.kams_cupos where gerencia  = old.nombre),
           (select nullif(count(*), 0) || ' seller(s)'    from public.sellers    where seccion   = old.nombre),
           (select nullif(count(*), 0) || ' prospecto(s)' from public.prospects  where categoria = old.nombre))
    into uso;
  if uso <> '' then
    raise exception 'La categoria "%" esta en uso (%): reasigna o quita eso primero.', old.nombre, uso
      using errcode = '23503';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.categorias_proteger_en_uso() from public, anon, authenticated;

drop trigger if exists categorias_proteger_en_uso on public.categorias;
create trigger categorias_proteger_en_uso
  before delete or update of nombre on public.categorias
  for each row execute function public.categorias_proteger_en_uso();

-- 4. Acceso ----------------------------------------------------------------------
alter table public.categorias enable row level security;

drop policy if exists "categorias: leen usuarios de Elite" on public.categorias;
create policy "categorias: leen usuarios de Elite" on public.categorias
  for select to authenticated using ((select public.se_usuario_permitido()));

drop policy if exists "categorias: admins agregan" on public.categorias;
create policy "categorias: admins agregan" on public.categorias
  for insert to authenticated with check ((select public.se_es_admin()));

drop policy if exists "categorias: admins editan" on public.categorias;
create policy "categorias: admins editan" on public.categorias
  for update to authenticated using ((select public.se_es_admin())) with check ((select public.se_es_admin()));

drop policy if exists "categorias: admins quitan" on public.categorias;
create policy "categorias: admins quitan" on public.categorias
  for delete to authenticated using ((select public.se_es_admin()));

revoke all on table public.categorias from public, anon;
grant select, insert, update, delete on table public.categorias to authenticated;
grant all on table public.categorias to service_role;

-- 5. Realtime ----------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categorias'
  ) then
    alter publication supabase_realtime add table public.categorias;
  end if;
end;
$$;
