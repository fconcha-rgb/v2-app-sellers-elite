-- ════════════════════════════════════════════════════════════════════════════
-- Segunda membresia: un mismo seller (mismo Seller ID de Falabella) puede tener
-- mas de una membresia, cada una con su KAM, seccion, tarifa, contrato y promo.
-- Caso de uso: el seller paga dos veces el servicio para tener dos KAMs, y cada
-- membresia ocupa un cupo de su KAM.
--
--   · sellers.sid        llave de la fila = la membresia. La 1ª usa el Seller ID
--                        tal cual; las siguientes, '<Seller ID>-2', '-3', ...
--   · sellers.seller_id  Seller ID real. Es el que va al reporte de Cobros, que
--                        suma las membresias de un mismo seller en una sola linea.
--
-- Que hace (aditiva; la version anterior de la app sigue funcionando):
--   1. Columna seller_id, rellena con el sid de cada fila.
--   2. Trigger: si una fila llega sin seller_id (app anterior), lo deriva del sid
--      quitando el sufijo de membresia ('SC1A2B3-2' -> 'SC1A2B3'). Sin quitarlo,
--      un upsert parcial sobre una membresia extra fallaba el check de formato.
--   3. Checks: IDs solo con mayusculas y numeros (sin espacios: el 26-oct entro
--      " SCF737B" con un espacio adelante) y el sid de una membresia extra es
--      '<seller_id>-<n>'.
--   4. Indice por seller_id.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Seller ID real --------------------------------------------------------
alter table public.sellers add column if not exists seller_id text;

update public.sellers set seller_id = sid where seller_id is null;

comment on column public.sellers.seller_id is
  'Seller ID real de Falabella. Igual al sid en la 1a membresia; las membresias extra tienen sid ''<seller_id>-<n>''.';

-- 2. Relleno automatico ----------------------------------------------------
create or replace function public.sellers_completar_seller_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.seller_id is null or btrim(new.seller_id) = '' then
    new.seller_id := regexp_replace(new.sid, '-[0-9]+$', '');
  end if;
  return new;
end;
$$;

revoke all on function public.sellers_completar_seller_id() from public, anon, authenticated;

drop trigger if exists sellers_completar_seller_id on public.sellers;
create trigger sellers_completar_seller_id
  before insert or update on public.sellers
  for each row execute function public.sellers_completar_seller_id();

alter table public.sellers alter column seller_id set not null;

-- 3. Formato -----------------------------------------------------------------
alter table public.sellers drop constraint if exists sellers_seller_id_formato;
alter table public.sellers add constraint sellers_seller_id_formato
  check (seller_id ~ '^[A-Z0-9]+$');

alter table public.sellers drop constraint if exists sellers_sid_membresia;
alter table public.sellers add constraint sellers_sid_membresia
  check (sid = seller_id or sid ~ ('^' || seller_id || '-[0-9]+$'));

-- 4. Busqueda por seller -----------------------------------------------------
create index if not exists sellers_seller_id_idx on public.sellers (seller_id);
