/* ════════════════════════════════════════════════════════════════════════════
   TAB ADMIN — Reglas del modelo multicuenta
   Edita pricing_config (fila unica id=1): tarifa base, % de la escalera por
   posicion y divisor de cupos. Los cambios impactan todos los calculos al
   guardar, sin redeploy (el frontend deriva todo en runtime + realtime).
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

const POS_LABELS = ['1ª cuenta (principal)', '2ª cuenta', '3ª cuenta', '4ª cuenta', '5ª cuenta'];

export default function AdminTab({ cfg, userEmail, show, refreshAll }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(cfg));
  const [saving, setSaving] = useState(false);

  // Re-sincroniza si la config cambia por realtime (otro admin editando).
  useEffect(() => {
    setForm(toForm(cfg));
  }, [cfg]);

  const setPct = (i: number, v: string) =>
    setForm((p) => {
      const pct = p.pct.slice() as FormState['pct'];
      pct[i] = v;
      return { ...p, pct };
    });

  /* Config "borrador" para el preview en vivo (antes de guardar). */
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

  const errores = useMemo(() => {
    const e: string[] = [];
    if (!(Number(form.tarifaBase) >= 0)) e.push('Tarifa base inválida');
    form.pct.forEach((v, i) => {
      const n = Number(v);
      if (isNaN(n) || n < 0 || n > 100) e.push('% posición ' + (i + 1) + ' fuera de 0–100');
    });
    const p6 = Number(form.pct6);
    if (isNaN(p6) || p6 < 0 || p6 > 100) e.push('% 6ª+ fuera de 0–100');
    if (!(Number(form.divisor) >= 1)) e.push('Divisor de cupos debe ser ≥ 1');
    return e;
  }, [form]);

  /* Preview: escalera + facturación acumulada 1..6 cuentas (como el modelo). */
  const preview = useMemo(() => {
    const rows = [] as { pos: string; pct: number; monto: number }[];
    for (let i = 0; i < 6; i++) {
      const pct = getPctForPosition(i, draft);
      rows.push({
        pos: i < 5 ? i + 1 + 'ª' : '6ª+',
        pct,
        monto: Math.round((draft.tarifaBase * pct) / 100),
      });
    }
    const acumulado = [] as { n: number; mensual: number; anual: number }[];
    let sum = 0;
    for (let n = 1; n <= 6; n++) {
      sum += Math.round((draft.tarifaBase * getPctForPosition(n - 1, draft)) / 100);
      acumulado.push({ n, mensual: sum, anual: sum * 12 });
    }
    return { rows, acumulado };
  }, [draft]);

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

  const th = {
    padding: '8px 12px',
    fontWeight: 700 as const,
    fontSize: 10,
    color: C.textMuted,
    textTransform: 'uppercase' as const,
  };
  const inputStyle = { width: '100%', boxSizing: 'border-box' as const };
  const label = (t: string) => (
    <label
      style={{
        fontSize: 11,
        color: C.textMuted,
        display: 'block',
        marginBottom: 4,
        fontWeight: 600,
        letterSpacing: '0.3px',
        textTransform: 'uppercase',
      }}
    >
      {t}
    </label>
  );

  return (
    <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 800, color: C.text }}>
          Reglas de multicuentas
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: C.textMuted }}>
          Nada de esto está hardcodeado: la escalera, la tarifa base y el pareo de cupos se leen
          desde <code>pricing_config</code>. El pricing es auto-ejecutable — sin condiciones de
          performance en la ecuación de cobro.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
          <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
            {label('Tarifa base mensual (CLP neto)')}
            <input
              type="number"
              min={0}
              value={form.tarifaBase}
              onChange={(e) => setForm((p) => ({ ...p, tarifaBase: e.target.value }))}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: '1 1 160px', maxWidth: 220 }}>
            {label('Cuentas por cupo (divisor)')}
            <input
              type="number"
              min={1}
              step={1}
              value={form.divisor}
              onChange={(e) => setForm((p) => ({ ...p, divisor: e.target.value }))}
              style={inputStyle}
            />
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
              cupos_por_KAM = ceil(cuentas_activas / divisor)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {POS_LABELS.map((pl, i) => (
            <div key={pl} style={{ flex: '1 1 130px', maxWidth: 170 }}>
              {label('% ' + pl)}
              <input
                type="number"
                min={0}
                max={100}
                value={form.pct[i]}
                onChange={(e) => setPct(i, e.target.value)}
                style={inputStyle}
              />
            </div>
          ))}
          <div style={{ flex: '1 1 130px', maxWidth: 170 }}>
            {label('% 6ª cuenta y siguientes (tope)')}
            <input
              type="number"
              min={0}
              max={100}
              value={form.pct6}
              onChange={(e) => setForm((p) => ({ ...p, pct6: e.target.value }))}
              style={inputStyle}
            />
          </div>
        </div>

        {errores.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12, color: C.danger, fontWeight: 600 }}>
            {errores.join(' · ')}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={save} disabled={saving || errores.length > 0}>
            {saving ? 'Guardando…' : 'Guardar reglas'}
          </button>
          <button className="btn btn-ghost" onClick={() => setForm(toForm(cfg))}>
            Descartar cambios
          </button>
          {cfg.updatedAt && (
            <span style={{ fontSize: 11, color: C.textMuted }}>
              Última actualización: {cfg.updatedAt.slice(0, 16).replace('T', ' ')}
              {cfg.updatedBy ? ' · ' + cfg.updatedBy : ''}
            </span>
          )}
        </div>
      </div>

      {/* Preview en vivo con los valores del formulario (antes de guardar) */}
      <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: C.bgAlt, borderBottom: '1px solid ' + C.border }}>
            <h4 style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.textSec, textTransform: 'uppercase' }}>
              Escalera resultante por cuenta
            </h4>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid ' + C.border }}>
                <th style={{ ...th, textAlign: 'left' }}>Cuenta</th>
                <th style={{ ...th, textAlign: 'right' }}>% base</th>
                <th style={{ ...th, textAlign: 'right' }}>Monto mensual</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.pos} style={{ borderBottom: '1px solid ' + C.borderLight }}>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>{r.pos}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: C.textSec }}>{fmtPct(r.pct)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: C.primaryDark }}>
                    {fmtFull(r.monto)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: C.bgAlt, borderBottom: '1px solid ' + C.border }}>
            <h4 style={{ margin: 0, fontSize: 12, fontWeight: 800, color: C.textSec, textTransform: 'uppercase' }}>
              Facturación acumulada del grupo
            </h4>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid ' + C.border }}>
                <th style={{ ...th, textAlign: 'left' }}>Nº cuentas</th>
                <th style={{ ...th, textAlign: 'right' }}>Total mensual</th>
                <th style={{ ...th, textAlign: 'right' }}>Total anual</th>
              </tr>
            </thead>
            <tbody>
              {preview.acumulado.map((r) => (
                <tr key={r.n} style={{ borderBottom: '1px solid ' + C.borderLight }}>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>{r.n}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{fmtFull(r.mensual)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: C.textSec }}>{fmtFull(r.anual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '8px 14px', fontSize: 10, color: C.textMuted }}>
            Montos netos + IVA. La 2ª cuenta gratis es el gancho de adopción; la escalera aparece de la 3ª en adelante.
          </div>
        </div>
      </div>
    </div>
  );
}
