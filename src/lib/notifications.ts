// src/lib/notifications.ts
//
// Helper para invocar la Edge Function `send-seller-notification` desde el frontend.
// La Edge Function publica mensajes en canales de Teams (Data y Soporte).
//
// La interfaz publica es identica a la version anterior (Resend), por lo que el
// codigo de App.tsx NO requiere cambios — solo cambia el comportamiento del backend.

import { supabase } from '..src/api'; // ajusta el import si tu api.ts esta en otra ruta

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
  kamEmail: string;
}

export interface NotifyResult {
  ok: boolean;
  error?: string;
  details?: unknown;
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
