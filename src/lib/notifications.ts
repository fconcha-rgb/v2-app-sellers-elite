// src/lib/notifications.ts
//
// Helper para invocar la Edge Function `send-seller-notification` desde el frontend.
// La Edge Function publica mensajes en canales de Teams (Data y Soporte).
//
// La interfaz publica es identica a la version anterior (Resend), por lo que el
// codigo de App.tsx NO requiere cambios — solo cambia el comportamiento del backend.

import { supabase } from '../api'; // ajusta el import si tu api.ts esta en otra ruta
import { buildBillingReportRequest, staleServerMessage } from '../../supabase/functions/_shared/billing.ts';
import type { YearMonth } from './period.ts';

export type SellerEventType = 'created' | 'fuga' | 'pausa' | 'reactivacion';

export interface SellerNotificationPayload {
  event: SellerEventType;
  seller: {
    sid: string;
    seller: string;
    mail: string;
    contacto?: string;
    seccion?: string;
    tipo?: string;
    kam?: string;
  };
  eventDate?: string; // ISO date "YYYY-MM-DD"
  kamEmail: string;
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
  details?: unknown;
  /** true si respondio una Edge Function con otro motor de cobro: el reporte enviado no es valido */
  staleServer?: boolean;
}

/**
 * Invoca la Edge Function. NUNCA lanza: siempre devuelve un objeto.
 * Si Teams falla, no queremos que se rompa el flujo de creacion del seller.
 */
export async function notifySellerEvent(
  payload: SellerNotificationPayload
): Promise<NotifyResult> {
  try {
    const { data, error } = await supabase.functions.invoke(
      'send-seller-notification',
      { body: payload }
    );

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[notifySellerEvent] Edge function error:', error);
      return { ok: false, error: error.message, details: error };
    }

    if (!data?.ok) {
      // eslint-disable-next-line no-console
      console.error('[notifySellerEvent] Teams rechazo el envio:', data);
      return { ok: false, error: 'Teams rechazo el envio', details: data };
    }

    return { ok: true, details: data };
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error('[notifySellerEvent] Exception:', e);
    return { ok: false, error: e?.message || 'Error desconocido' };
  }
}
/** Ante un status no-2xx supabase-js devuelve un mensaje generico; el motivo
 *  real (p.ej. "mes ya cerrado") viene en el cuerpo JSON de la respuesta. */
async function edgeErrorMessage(error: { message: string; context?: unknown }): Promise<string> {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      /* cuerpo no JSON */
    }
  }
  return error.message;
}

/**
* Dispara el envio manual del reporte mensual de cobros para un periodo
* EXPLICITO (nunca depende del "mes actual" del servidor).
* close = true congela el mes: se persiste el snapshot y queda inmutable.
*/
export async function triggerMonthlyBillingReport(
options: { period: YearMonth; close?: boolean }
): Promise<NotifyResult> {
try {
const { data, error } = await supabase.functions.invoke(
'send-monthly-billing-report',
{
body: buildBillingReportRequest(options.period, { close: options.close, forceMode: 'manual' }),
}
);
if (error) {
console.error('[triggerMonthlyBillingReport] Edge function error:', error);
const message = await edgeErrorMessage(error);
// 409 por motor distinto: la funcion nueva se nego a enviar (ver engineVersionMismatch).
const versionConflict = error.context instanceof Response && error.context.status === 409 && /motor de cobro/i.test(message);
return { ok: false, error: message, details: error, staleServer: versionConflict };
}
// Una funcion desplegada desde otro commit calcula con otras reglas (incidente
// oct-2026: la v11 de mayo cobraba tarifa completa a las secundarias multicuenta).
const stale = data && data.ok !== false ? staleServerMessage(data.engineVersion) : null;
if (stale) {
console.error('[triggerMonthlyBillingReport] motor distinto en la Edge Function:', data);
return { ok: false, error: stale, details: data, staleServer: true };
}
if (!data?.ok) {
console.error('[triggerMonthlyBillingReport] respuesta no ok:', data);
return { ok: false, error: data?.error || data?.warning || 'Error desconocido', details: data };
}
  return { ok: true, details: data };
} catch (e: any) {
console.error('[triggerMonthlyBillingReport] Exception:', e);
return { ok: false, error: e?.message || 'Error desconocido' };
}
}
