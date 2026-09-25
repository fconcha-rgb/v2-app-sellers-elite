-- ════════════════════════════════════════════════════════════════════════════
-- Cierre mensual de cobros: snapshot inmutable del billing aplicado.
--
-- Por que: sellers, pricing_config y la composicion de multicuentas solo
-- guardan su estado ACTUAL. Recalcular un mes pasado con ese estado no
-- reproduce lo que se cobro (una Fuga, una Pausa o un cambio de escalera
-- reescriben el pasado). Al cerrar un mes se persiste el resultado ya
-- calculado — monto, componentes y posicion multicuenta — y desde ahi el
-- dashboard, los CSV y el reporte de Cobros leen el snapshot.
--
-- Que hace (solo aditiva, idempotente; NO modifica tablas existentes):
--   1. billing_periods        1 fila por mes cerrado ('YYYY-MM')
--   2. billing_period_lines   1 fila por seller facturado en ese mes
--   3. Triggers de inmutabilidad (UPDATE / DELETE / TRUNCATE bloqueados)
--   4. RPC close_billing_period: cierre atomico, solo service_role
--   5. RLS: lectura para authenticated; escritura solo via service_role
--   6. Realtime para billing_periods
--
-- No incluye backfill: los meses anteriores al primer cierre quedan "sin
-- cierre" y la app los muestra como estimados. Ver supabase/README.md.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Meses cerrados ----------------------------------------------------------
create table if not exists public.billing_periods (
  period                  text primary key,
  closed_at               timestamptz not null default now(),
  closed_by               text,
  source                  text not null,
  engine_version          text not null,
  pricing_config_snapshot jsonb not null default '{}'::jsonb,
  totals                  jsonb not null default '{}'::jsonb,
  constraint billing_periods_period_format check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint billing_periods_source_check check (source in ('manual', 'cron'))
);

comment on table public.billing_periods is
  'Meses de cobro cerrados (YYYY-MM). Inmutables: el dashboard y el reporte de Cobros leen el snapshot en vez de recalcular.';

-- 2. Lineas facturadas del mes ------------------------------------------------
-- Sin FK a sellers: la historia debe sobrevivir si un seller se borra o cambia.
create table if not exists public.billing_period_lines (
  period                 text not null references public.billing_periods (period),
  sid                    text not null,
  seller_name            text not null,
  seccion                text,
  kam                    text,
  tipo                   text not null,
  status_at_close        text not null,
  tarifa_lista           numeric not null,
  descuento              numeric not null,
  monto_neto_final       numeric not null,
  monto_bruto            numeric not null,
  charge_kind            text not null,
  mc_principal_sid       text,
  mc_position            integer,
  mc_pct                 numeric,
  mc_tarifa_base         numeric,
  mc_principal_temporal  boolean not null default false,
  primary key (period, sid),
  constraint billing_period_lines_kind_check check (charge_kind in ('standard', 'promo', 'custom', 'multicuenta'))
);

comment on table public.billing_period_lines is
  'Cobro aplicado por seller en un mes cerrado: montos netos/brutos, tipo de cargo y posicion multicuenta usada.';

-- 3. Inmutabilidad -----------------------------------------------------------
-- Reapertura administrativa (excepcional, documentada en supabase/README.md):
--   begin; set local app.billing_reopen = 'on'; delete ...; commit;
create or replace function public.billing_snapshot_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.billing_reopen', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Los cierres de cobro son inmutables (% sobre %). Ver supabase/README.md para reabrir un mes.',
    tg_op, tg_table_name;
end;
$$;

create or replace function public.billing_snapshot_no_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Los cierres de cobro son inmutables (TRUNCATE sobre %).', tg_table_name;
end;
$$;

drop trigger if exists billing_periods_immutable on public.billing_periods;
create trigger billing_periods_immutable
  before update or delete on public.billing_periods
  for each row execute function public.billing_snapshot_immutable();

drop trigger if exists billing_period_lines_immutable on public.billing_period_lines;
create trigger billing_period_lines_immutable
  before update or delete on public.billing_period_lines
  for each row execute function public.billing_snapshot_immutable();

drop trigger if exists billing_periods_no_truncate on public.billing_periods;
create trigger billing_periods_no_truncate
  before truncate on public.billing_periods
  for each statement execute function public.billing_snapshot_no_truncate();

drop trigger if exists billing_period_lines_no_truncate on public.billing_period_lines;
create trigger billing_period_lines_no_truncate
  before truncate on public.billing_period_lines
  for each statement execute function public.billing_snapshot_no_truncate();

-- 4. Cierre atomico ----------------------------------------------------------
-- La Edge Function send-monthly-billing-report calcula las lineas con el motor
-- compartido y llama esta funcion con service_role. Todo o nada.
create or replace function public.close_billing_period(p_period text, p_meta jsonb, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lines integer;
begin
  if p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Periodo invalido: %', p_period;
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'p_lines debe ser un arreglo JSON';
  end if;
  if exists (select 1 from public.billing_periods where period = p_period) then
    raise exception 'El periodo % ya esta cerrado', p_period using errcode = 'unique_violation';
  end if;

  insert into public.billing_periods (period, closed_by, source, engine_version, pricing_config_snapshot, totals)
  values (
    p_period,
    p_meta ->> 'closed_by',
    coalesce(p_meta ->> 'source', 'manual'),
    coalesce(p_meta ->> 'engine_version', 'desconocida'),
    coalesce(p_meta -> 'pricing_config_snapshot', '{}'::jsonb),
    coalesce(p_meta -> 'totals', '{}'::jsonb)
  );

  insert into public.billing_period_lines (
    period, sid, seller_name, seccion, kam, tipo, status_at_close,
    tarifa_lista, descuento, monto_neto_final, monto_bruto, charge_kind,
    mc_principal_sid, mc_position, mc_pct, mc_tarifa_base, mc_principal_temporal
  )
  select
    p_period, l.sid, l.seller_name, l.seccion, l.kam, l.tipo, l.status_at_close,
    l.tarifa_lista, l.descuento, l.monto_neto_final, l.monto_bruto, l.charge_kind,
    l.mc_principal_sid, l.mc_position, l.mc_pct, l.mc_tarifa_base, coalesce(l.mc_principal_temporal, false)
  from jsonb_to_recordset(p_lines) as l (
    sid text, seller_name text, seccion text, kam text, tipo text, status_at_close text,
    tarifa_lista numeric, descuento numeric, monto_neto_final numeric, monto_bruto numeric, charge_kind text,
    mc_principal_sid text, mc_position integer, mc_pct numeric, mc_tarifa_base numeric, mc_principal_temporal boolean
  );
  get diagnostics v_lines = row_count;

  return jsonb_build_object('period', p_period, 'lines', v_lines);
end;
$$;

-- En este proyecto los default privileges otorgan EXECUTE a anon/authenticated.
revoke all on function public.close_billing_period(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.close_billing_period(text, jsonb, jsonb) to service_role;
revoke all on function public.billing_snapshot_immutable() from public, anon, authenticated;
revoke all on function public.billing_snapshot_no_truncate() from public, anon, authenticated;

-- 5. Acceso ------------------------------------------------------------------
alter table public.billing_periods enable row level security;
alter table public.billing_period_lines enable row level security;

-- Defensa en profundidad: los default privileges del proyecto dan ALL a anon/authenticated.
revoke insert, update, delete, truncate on public.billing_periods from anon, authenticated;
revoke insert, update, delete, truncate on public.billing_period_lines from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'billing_periods' and policyname = 'billing_periods_select_authenticated'
  ) then
    create policy billing_periods_select_authenticated on public.billing_periods
      for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'billing_period_lines' and policyname = 'billing_period_lines_select_authenticated'
  ) then
    create policy billing_period_lines_select_authenticated on public.billing_period_lines
      for select to authenticated using (true);
  end if;
end;
$$;

-- 6. Realtime (la app refresca al cerrarse un mes) --------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'billing_periods'
     ) then
    alter publication supabase_realtime add table public.billing_periods;
  end if;
end;
$$;
