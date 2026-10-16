/* Resguardos del incidente oct-2026: la Edge Function de cobros quedo con un
   motor propio y desplegada a mano, distinta de la app. Estos tests fallan si
   alguien vuelve a meter calculo de cobro dentro de la funcion o desarma el
   despliegue automatico. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Un solo motor de cobro', () => {
  const fn = read('../supabase/functions/send-monthly-billing-report/index.ts');

  it('la Edge Function calcula con el motor compartido', () => {
    assert.match(fn, /from "\.\.\/_shared\/billing\.ts"/);
    assert.match(fn, /computeMonthLines\(/);
    assert.match(fn, /engineVersionMismatch\(/);
  });

  it('la Edge Function no tiene reglas de cobro propias', () => {
    for (const marker of ['DISCOUNT_RATE', 'calcularCobro', 'getMonthlyCharge', '* IVA', '0.424412']) {
      assert.ok(!fn.includes(marker), 'la funcion no debe contener "' + marker + '": las reglas viven en _shared/billing.ts');
    }
  });
});

describe('Despliegue automatico de la Edge Function', () => {
  const wf = read('../.github/workflows/deploy-edge-functions.yml');

  it('se despliega en cada push a main que toque supabase/functions', () => {
    assert.match(wf, /branches:\s*\[main\]/);
    assert.match(wf, /'supabase\/functions\/\*\*'/);
    assert.match(wf, /supabase functions deploy send-monthly-billing-report/);
  });

  it('corre los tests antes de desplegar y no desactiva la verificacion JWT', () => {
    assert.match(wf, /needs:\s*test/);
    assert.ok(!wf.includes('--no-verify-jwt'));
  });
});
