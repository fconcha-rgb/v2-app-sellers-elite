/* ════════════════════════════════════════════════════════════════════════════
   ADMIN › AVISOS A TEAMS
   URLs de los webhooks de Teams (Workflows / Power Automate), editables por un
   administrador. Si no hay URL guardada aqui, las funciones usan el secreto de
   Supabase (TEAMS_WEBHOOK_DATA / _SOPORTE / _COBROS). La URL completa nunca se
   vuelve a mostrar: solo el dominio al que envia.
   ════════════════════════════════════════════════════════════════════════════ */
import { useEffect, useState, type FormEvent } from 'react';
import { C } from './theme';
import { fetchEstadoAvisos, guardarWebhook, type EstadoAviso, type TipoAviso } from './api';

type Props = { show: (msg: string, ok?: boolean) => void };

const AVISOS: Record<TipoAviso, { titulo: string; detalle: string }> = {
  data: {
    titulo: 'Equipo Data (Looker)',
    detalle: 'Nuevo seller en Cobros, fugas, pausas y reactivaciones: crear, pausar o dar de baja la cuenta en Looker.',
  },
  soporte: {
    titulo: 'Equipo Soporte (Salesforce)',
    detalle: 'Los mismos eventos: crear, pausar o cerrar el caso en Salesforce y asignar al analista.',
  },
  cobros: {
    titulo: 'Reporte mensual de cobros',
    detalle: 'Resumen del mes con el CSV. También sale con «Forzar envío cobros».',
  },
};

// 22-10-2026 14:20 (hora de Chile)
const fecha = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('es-CL', {
        timeZone: 'America/Santiago',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(new Date(iso))
        .replace(',', '')
    : '';

const Etiqueta = ({ enApp }: { enApp: boolean }) => (
  <span
    style={{
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: '.4px',
      textTransform: 'uppercase',
      padding: '3px 9px',
      borderRadius: 999,
      whiteSpace: 'nowrap',
      background: enApp ? C.primaryLight : C.bgAlt,
      color: enApp ? C.primaryDark : C.textSec,
    }}
  >
    {enApp ? 'URL de la app' : 'URL de Supabase'}
  </span>
);

export default function AvisosTeams({ show }: Props) {
  const [estado, setEstado] = useState<EstadoAviso[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<TipoAviso | null>(null);
  const [url, setUrl] = useState('');
  const [guardando, setGuardando] = useState(false);

  const aplicar = ({ data, error: e }: { data: unknown; error: { message: string } | null }) => {
    if (e) return setError(e.message);
    setError(null);
    setEstado((data ?? []) as EstadoAviso[]);
  };
  const cargar = () => fetchEstadoAvisos().then(aplicar);

  useEffect(() => {
    let vigente = true;
    fetchEstadoAvisos().then((r) => vigente && aplicar(r));
    return () => {
      vigente = false;
    };
  }, []);

  async function guardar(tipo: TipoAviso, valor: string) {
    setGuardando(true);
    const { error: e } = await guardarWebhook(tipo, valor);
    setGuardando(false);
    if (e) return show(e.message, false);
    show(valor ? 'Webhook guardado' : 'Vuelve a usar la URL de Supabase');
    setEditando(null);
    setUrl('');
    cargar();
  }

  const enviar = (tipo: TipoAviso) => (ev: FormEvent) => {
    ev.preventDefault();
    if (!guardando) guardar(tipo, url.trim());
  };

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '11px 16px', borderBottom: '1px solid ' + C.borderLight, background: C.bgAlt }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.5px' }}>
          Avisos a Teams
        </h3>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: C.textMuted }}>
          Pega la URL del flujo de Teams (Workflows o Power Automate). Por seguridad, después de guardarla solo se muestra el dominio.
        </p>
      </div>

      {error && (
        <div style={{ margin: 16, padding: '10px 12px', borderRadius: 8, background: C.warningBg, color: C.textSec, fontSize: 12 }}>
          No pude leer los avisos: {error}
        </div>
      )}
      {!estado && !error && <p style={{ margin: 16, fontSize: 12, color: C.textMuted }}>Cargando…</p>}

      {estado?.map((a, i) => (
        <div key={a.tipo} style={{ padding: '14px 16px', borderTop: i ? '1px solid ' + C.borderLight : undefined }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{AVISOS[a.tipo].titulo}</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{AVISOS[a.tipo].detalle}</div>
              <div style={{ fontSize: 11, color: C.textSec, marginTop: 4, overflowWrap: 'anywhere' }}>
                {a.en_app
                  ? 'Envía a ' + (a.destino ?? '—') + ' · cambiada el ' + fecha(a.actualizado) + (a.actualizado_por ? ' por ' + a.actualizado_por : '')
                  : 'Envía a la URL guardada como secreto en Supabase.'}
              </div>
            </div>
            <Etiqueta enApp={a.en_app} />
          </div>

          {editando === a.tipo ? (
            <form onSubmit={enviar(a.tipo)} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="url"
                required
                autoFocus
                aria-label={'URL del webhook de ' + AVISOS[a.tipo].titulo}
                placeholder="https://…powerplatform.com/… o https://…logic.azure.com/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={guardando}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={guardando} onClick={() => setEditando(null)}>
                  Cancelar
                </button>
                {a.en_app && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={guardando} onClick={() => guardar(a.tipo, '')}>
                    Volver a la URL de Supabase
                  </button>
                )}
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => {
                setEditando(a.tipo);
                setUrl('');
              }}
            >
              Cambiar URL
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
