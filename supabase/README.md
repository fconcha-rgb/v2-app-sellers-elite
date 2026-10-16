# supabase/

Backend versionado de Sellers Elite. Hasta ahora las Edge Functions y el schema
vivian solo en el proyecto Supabase; aqui queda lo que cambio con la
arquitectura temporal (años, YTD, rolling, cierres de mes).

| Ruta | Que es |
|---|---|
| `functions/_shared/period.ts` | Modelo temporal unico (`YearMonth`, `'YYYY-MM'`, ventanas, "hoy" en `America/Santiago`). Lo importan el frontend y las Edge Functions. |
| `functions/_shared/billing.ts` | Motor de cobro unico: dashboard y reporte de Cobros calculan con el mismo codigo. |
| `functions/send-monthly-billing-report/` | Reporte de cobros: usa el motor compartido, lee/escribe snapshots de cierre. |
| `migrations/20260926000000_billing_period_snapshots.sql` | Tablas de cierre mensual inmutable. **No se ha ejecutado en ningun entorno.** |

`send-seller-notification` no cambio y sigue solo en el proyecto.

## Semantica de un mes

| Estado | Cuando | De donde sale el dato |
|---|---|---|
| **Real** | el mes tiene cierre (`billing_periods`) | snapshot persistido; nunca se recalcula |
| **Actual** | mes en curso sin cierre | motor con condiciones vigentes |
| **Estimado** | mes pasado sin cierre (todo lo anterior al primer cierre) | motor con condiciones **actuales**: puede no coincidir con lo facturado |
| **Proyeccion** | mes futuro | motor con condiciones vigentes |

## Reglas del motor (`_shared/billing.ts`)

- Factura el mes M si `f_contrato < M-25` y (`f_termino` vacio o `f_termino ≥ M-25`).
- Sin `f_contrato`, o Fuga sin `f_termino`: no factura (la app exige F.Termino al marcar Fuga).
- `custom_dctos['YYYY-MM']` reemplaza el monto de ese mes (dentro de la ventana).
- Individual: `tarifa`; los primeros `dcto` meses desde el mes calendario del contrato a `tarifa × 0,424412189118071`. Pausa factura.
- Multicuenta: `tarifa_base × %` de la posicion en el holding (condiciones congeladas si existen), sin promo. Pausa/Fuga no facturan.
- Bruto = neto × 1,19.
- CSV del reporte: en multicuenta, `Monto Neto` = tarifa base y `Descuento` = lo que descuenta la escalera (2ª cuenta al 0%: `990000,990000,0,0`).

## Despliegue

Vercel publica solo el frontend. La Edge Function `send-monthly-billing-report`
la despliega el workflow `.github/workflows/deploy-edge-functions.yml` en cada
push a `main` que toque `supabase/functions/`: corre los tests y despliega
desde el mismo commit, asi frontend y reporte calculan con el mismo motor.

**Configuracion (una vez):** en GitHub → Settings → Secrets and variables →
Actions, crear `SUPABASE_ACCESS_TOKEN` (token personal de Supabase) y
`SUPABASE_PROJECT_ID` (ref del proyecto). Para desplegar sin hacer push:
pestaña Actions → "Deploy Edge Functions" → Run workflow.

**Como verificar que corre la version correcta:**

- La tarjeta de Teams muestra `Motor de cobro: vX.Y.Z`; debe ser igual a
  `BILLING_ENGINE_VERSION` en `_shared/billing.ts`.
- La app manda su version en cada pedido. Si la funcion es de otra version
  responde 409 y no envia nada. Si es una funcion antigua que no informa
  version, la app muestra una alerta: ese reporte no es valido.
- Subir `BILLING_ENGINE_VERSION` en cada cambio de reglas o del formato del CSV.

**Migracion de cierres** (`migrations/`): sigue manual. Revisarla y aplicarla
primero en un branch/staging, luego en produccion (SQL Editor o
`supabase db push`). Es aditiva. Sin ella la app y el reporte funcionan igual y
tratan todos los meses como "sin cierre" (no se puede cerrar un mes).

### Incidente oct-2026 (por que esto ya no es manual)

Desde el merge del 28-sep la app calculaba con este motor, pero la funcion
desplegada seguia siendo la de mayo (v11): cobraba la `tarifa` de cada cuenta
sin escalera multicuenta. El reporte cobro $990.000 a secundarias que debian ir
en $0 (holdings con condiciones pactadas cuyas secundarias tenian tarifa
cargada). Ademas, cada reenvio sobrescribia el CSV del mes: ahora cada envio
queda tambien en `YYYY/envios/` y el link de Teams apunta a esa copia.

Secret opcional: `BILLING_CLOSE_ALLOWED_EMAILS` (emails separados por coma que
pueden cerrar meses). Sin definir, cualquier usuario autenticado puede cerrar
desde la Edge Function; en la UI el boton solo lo ven los `ADMIN_EMAILS`.

## Cerrar un mes

Admin → boton **Forzar envio cobros** → elegir mes → marcar **Cerrar y congelar
el mes**. Solo se puede cerrar el mes en curso o el anterior (cerrar meses mas
antiguos con el estado de hoy inventaria historia). Reenviar un mes cerrado
regenera el CSV desde el snapshot, con los mismos montos.

Payload del endpoint: `{ year, month, close?: boolean, forceMode?: 'manual' | 'cron' }`.
Sin `year`/`month` usa el mes en curso en hora de Chile (solo pensado para el cron).

### Cron automatico (opcional)

El export no muestra `pg_cron` ni `pg_net` instalados, asi que el envio
automatico del dia 24 que menciona el codigo original probablemente no existe.
Si se quiere, con ambas extensiones habilitadas:

```sql
-- Cierra y envia el mes en curso el dia 24 a las 13:00 UTC (09:00 de Chile en invierno, 10:00 en verano).
select cron.schedule(
  'cierre-cobros-mensual',
  '0 13 24 * *',
  $$ select net.http_post(
       url     := 'https://<project-ref>.supabase.co/functions/v1/send-monthly-billing-report',
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'Authorization', 'Bearer ' || '<service-role-key>'),
       body    := jsonb_build_object('close', true, 'forceMode', 'cron')
     ) $$
);
```

Guardar la service-role key en Vault en vez de dejarla en el comando.

## Reabrir un mes (excepcional)

Los triggers bloquean UPDATE/DELETE. Para corregir un cierre erroneo:

```sql
begin;
set local app.billing_reopen = 'on';
delete from public.billing_period_lines where period = '2026-09';
delete from public.billing_periods      where period = '2026-09';
commit;
```

Luego volver a cerrar el mes desde la app (solo si es el mes en curso o el anterior).
