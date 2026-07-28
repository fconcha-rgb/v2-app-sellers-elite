/* ════════════════════════════════════════════════════════════════════════════
   ADMIN › PRICING MULTICUENTA
   Edita pricing_config (fila unica id=1): tarifa base, escalera de % por
   posicion y divisor de cupos. Cada campo muestra en vivo el monto que
   produce, y abajo la facturacion acumulada del holding. Nada hardcodeado:
   al guardar, todos los calculos de la app se recalculan sin redeploy.
   ════════════════════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from 'react';
import { C, fmtFull, fmtPct } from './theme';
import { updatePricingConfig } from './api';
import { getPctForPosition, type PricingConfig } from './lib/multicuenta';

type Props = {
  cfg: PricingConfig;
  userEmail: string;
  show: (msg: string, ok?: boolean) => void;
  refreshAll: () => Promise<any>;
};

type FormState = {
  tarifaBase: string;
  pct: [string, string, string, string, string];
  pct6: string;
  divisor: string;
};

const toForm = (cfg: PricingConfig): FormState => ({
  tarifaBase: String(cfg.tarifaBase),
  pct: cfg.pctPos.map(String) as FormState['pct'],
  pct6: String(cfg.pctPos6Plus),
  divisor: String(cfg.cupoDivisor),
});

const POS = ['1ª cuenta', '2ª cuenta', '3ª cuenta', '4ª cuenta', '5ª cuenta', '6ª y siguientes'];
const POS_HINT = ['principal', 'gancho de adopción', '', '', '', 'tope'];

/* ── Bloques de UI reutilizables ─────────────────────────────────────────── */
const Section = (p: { title: string; desc?: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="card" style={{ overflow: 'hidden' }}>
    <div
      style={{
        padding: '11px 16px',
        borderBottom: '1px solid ' + C.borderLight,
        background: C.bgAlt,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: '1 1 220px' }}>
        <h3 style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.textSec, textTransform: 'uppercase', letterSpacing: '.5px' }}>
          {p.title}
        </h3>
        {p.desc && <p style={{ margin: '2px 0 0', fontSize: 11, color: C.textMuted }}>{p.desc}</p>}
      </div>
      {p.right}
    </div>
    <div style={{ padding: 16 }}>{p.children}</div>
  </div>
);

const Field = (p: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  min?: number;
  max?: number;
  width?: number | string;
  invalid?: boolean;
}) => (
  <div style={{ flex: '1 1 ' + (p.width || '150px'), maxWidth: 210 }}>
    <label
      style={{
        fontSize: 10,
        color: C.textMuted,
        display: 'block',
        marginBottom: 4,
        fontWeight: 700,
        letterSpacing: '.4px',
        textTransform: 'uppercase',
      }}
    >
      {p.label}
    </label>
    <div style={{ position: 'relative' }}>
      <input
        type="number"
        min={p.min}
        max={p.max}
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          paddingRight: p.suffix ? 26 : undefined,
          borderColor: p.invalid ? C.danger : undefined,
        }}
      />
      {p.suffix && (
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: C.textMuted, fontWeight: 700, pointerEvents: 'none' }}>
          {p.suffix}
        </span>
      )}
    </div>
    {p.hint && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4, lineHeight: 1.35 }}>{p.hint}</div>}
  </div>
);

export default function AdminTab({ cfg, userEmail, show, refreshAll }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(cfg));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(toForm(cfg));
  }, [cfg]);

  const setPct = (i: number, v: string) =>
    setForm((p) => {
      const pct = p.pct.slice() as FormState['pct'];
      pct[i] = v;
      return { ...p, pct };
    });

  /* Config "borrador": alimenta el preview antes de guardar. */
  const draft: PricingConfig = useMemo(
    () => ({
      tarifaBase: Math.max(0, Number(form.tarifaBase) || 0),
      pctPos: form.pct.map((v) => Number(v) || 0) as PricingConfig['pctPos'],
      pctPos6Plus: Number(form.pct6) || 0,
      cupoDivisor: Math.max(1, Math.floor(Number(form.divisor) || 1)),
      updatedAt: cfg.updatedAt,
      updatedBy: cfg.updatedBy,
    }),
    [form, cfg.updatedAt, cfg.updatedBy]
  );

  const pctInvalid = (v: string) => {
    const n = Number(v);
    return isNaN(n) || n < 0 || n > 100;
  };

  const errores = useMemo(() => {
    const e: string[] = [];
    if (!(Number(form.tarifaBase) >= 0)) e.push('La tarifa base debe ser un número positivo');
    if (form.pct.some(pctInvalid) || pctInvalid(form.pct6)) e.push('Los porcentajes deben estar entre 0 y 100');
    if (!(Number(form.divisor) >= 1)) e.push('El divisor de cupos debe ser 1 o mayor');
    return e;
  }, [form]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(toForm(cfg)), [form, cfg]);

  /* Escalera + acumulado, calculados desde el FORMULARIO (preview en vivo). */
  const escalera = useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const pct = getPctForPosition(i, draft);
        return { i, pct, monto: Math.round((draft.tarifaBase * pct) / 100) };
      }),
    [draft]
  );

  const acumulado = useMemo(() => {
    let sum = 0;
    return escalera.map((r) => {
      sum += r.monto;
      return { n: r.i + 1, mensual: sum, anual: sum * 12 };
    });
  }, [escalera]);

  const save = async () => {
    if (errores.length) return show(errores[0], false);
    setSaving(true);
    const res: any = await updatePricingConfig({
      tarifa_base: draft.tarifaBase,
      pct_pos1: draft.pctPos[0],
      pct_pos2: draft.pctPos[1],
      pct_pos3: draft.pctPos[2],
      pct_pos4: draft.pctPos[3],
      pct_pos5: draft.pctPos[4],
      pct_pos6_plus: draft.pctPos6Plus,
      cupo_divisor: draft.cupoDivisor,
      updated_at: new Date().toISOString(),
      updated_by: userEmail,
    });
    setSaving(false);
    if (res?.error) return show(res.error.message || 'Error al guardar', false);
    await refreshAll();
    show('Reglas guardadas — aplicadas al instante en todos los cálculos');
  };

  const th = { padding: '7px 12px', fontWeight: 700 as const, fontSize: 10, color: C.textMuted, textTransform: 'uppercase' as const };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Barra de acciones (estado + guardar) ── */}
      <div
        className="card"
        style={{
          padding: '12px 16px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          borderLeft: '4px solid ' + (dirty ? C.warning : C.primary),
        }}
      >
        <div style={{ flex: '1 1 260px' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
            {dirty ? 'Tienes cambios sin guardar' : 'Configuración al día'}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted }}>
            {cfg.updatedAt
              ? 'Última actualización: ' + cfg.updatedAt.slice(0, 16).replace('T', ' ') + (cfg.updatedBy ? ' · ' + cfg.updatedBy : '')
              : 'Sin ediciones registradas'}
          </div>
        </div>
        {errores.length > 0 && (
          <span style={{ fontSize: 11, color: C.danger, fontWeight: 700, flex: '1 1 200px' }}>{errores[0]}</span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setForm(toForm(cfg))} disabled={!dirty}>
          Descartar
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saving || !!errores.length || !dirty}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>

      {/* ── Parámetros base ── */}
      <Section
        title="Parámetros base"
        desc="Valores de referencia sobre los que se construye toda la escalera."
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <Field
            label="Tarifa base mensual"
            suffix="CLP"
            width="220px"
            value={form.tarifaBase}
            min={0}
            onChange={(v) => setForm((p) => ({ ...p, tarifaBase: v }))}
            hint={'Neto, sin IVA. Es el 100% de la escalera: hoy ' + fmtFull(draft.tarifaBase) + '/mes.'}
            invalid={!(Number(form.tarifaBase) >= 0)}
          />
          <Field
            label="Cuentas por cupo"
            width="180px"
            value={form.divisor}
            min={1}
            onChange={(v) => setForm((p) => ({ ...p, divisor: v }))}
            hint={'cupos = ⌈cuentas activas del KAM ÷ ' + draft.cupoDivisor + '⌉. Con ' + draft.cupoDivisor + ', tres cuentas ocupan dos cupos.'}
            invalid={!(Number(form.divisor) >= 1)}
          />
        </div>
      </Section>

      {/* ── Escalera ── */}
      <Section
        title="Escalera de precios por posición"
        desc="Porcentaje de la tarifa base que paga cada cuenta según su lugar en el holding. La posición se recalcula sola: nunca queda fija."
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {escalera.map((r) => (
            <div
              key={r.i}
              style={{
                flex: '1 1 140px',
                maxWidth: 180,
                border: '1px solid ' + C.borderLight,
                borderRadius: 10,
                padding: '10px 12px',
                background: r.i === 0 ? C.primaryBg : C.bgCard,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: C.text }}>{POS[r.i]}</div>
              <div style={{ fontSize: 9.5, color: C.textMuted, minHeight: 13, marginBottom: 7 }}>{POS_HINT[r.i]}</div>
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={r.i < 5 ? form.pct[r.i] : form.pct6}
                  onChange={(e) => (r.i < 5 ? setPct(r.i, e.target.value) : setForm((p) => ({ ...p, pct6: e.target.value })))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    paddingRight: 24,
                    fontWeight: 700,
                    borderColor: pctInvalid(r.i < 5 ? form.pct[r.i] : form.pct6) ? C.danger : undefined,
                  }}
                />
                <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: C.textMuted, fontWeight: 700, pointerEvents: 'none' }}>
                  %
                </span>
              </div>
              <div style={{ marginTop: 7, fontSize: 13, fontWeight: 800, color: r.monto > 0 ? C.primaryDark : C.textMuted }}>
                {fmtFull(r.monto)}
                <span style={{ fontSize: 9.5, color: C.textMuted, fontWeight: 600 }}> /mes</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Simulación ── */}
      <Section
        title="Simulación de facturación"
        desc="Lo que factura un holding completo a medida que suma cuentas, con los valores de arriba."
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 420 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid ' + C.border }}>
                <th style={{ ...th, textAlign: 'left' }}>Cuentas en el holding</th>
                <th style={{ ...th, textAlign: 'right' }}>Aporte de la última</th>
                <th style={{ ...th, textAlign: 'right' }}>Total mensual</th>
                <th style={{ ...th, textAlign: 'right' }}>Total anual</th>
              </tr>
            </thead>
            <tbody>
              {acumulado.map((r, i) => (
                <tr key={r.n} style={{ borderBottom: '1px solid ' + C.borderLight }}>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>
                    {r.n === 6 ? '6 o más' : r.n}
                    <span style={{ fontSize: 10, color: C.textMuted, fontWeight: 500 }}>
                      {'  (' + fmtPct(escalera[i].pct) + ')'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: escalera[i].monto > 0 ? C.textSec : C.textMuted }}>
                    {escalera[i].monto > 0 ? '+ ' + fmtFull(escalera[i].monto) : 'gratis'}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: C.primaryDark }}>{fmtFull(r.mensual)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: C.textSec }}>{fmtFull(r.anual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: 10, color: C.textMuted }}>
          Montos netos, sin IVA. Los cambios se aplican al instante en Cobros y Dashboard, sin necesidad de volver a publicar la app.
        </div>
      </Section>
    </div>
  );
}
