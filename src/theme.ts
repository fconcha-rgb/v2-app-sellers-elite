/* ════════════════════════════════════════════════════════════════════════════
   SELLERS ELITE — TEMA CONSOLIDADO (fuente de verdad visual)
   Basado en el Falabella Design System oficial (Brandbook "Neon" 2024 +
   paleta corporativa Grupo Falabella).

   Leyes de marca aplicadas:
   · Verde Falabella #ADD500 es la MARCA (banderola, serie "Grupos"),
     NO un color de boton. Botones = pildoras negras/blancas.
   · Banderola siempre rectangulo duro (border-radius: 0), "f" minuscula.
   · Tipografia: Montserrat (sustituto oficial de Mont) + Poppins para UI.
   · Semanticos desde la paleta corporativa: ok #44BF00 · alerta #F2B600 ·
     peligro #FF004D · azul #0045C0 · indigo #5069B1 · rosa #C65F6B.
   · Sin gradientes, sin emoji de marca, radios pequeños.

   Todo color/tipografia/espaciado de la app sale de este archivo.
   ════════════════════════════════════════════════════════════════════════════ */

export const FONT_FAMILY = "'Montserrat', 'Poppins', 'Helvetica Neue', system-ui, sans-serif";

export const C = {
  /* Fondos y superficies (tema claro DS) */
  bg: '#F5F6F7',          // fb-bg-soft
  bgCard: '#FFFFFF',
  bgAlt: '#EFF1F2',       // barras de filtros / headers de tabla
  bgDark: '#E2E5E7',      // tracks, toggles
  border: '#E2E5E7',      // fb-line
  borderLight: '#EEF0F1', // fb-line-soft

  /* Texto */
  text: '#0A0A0A',        // fb-ink
  textSec: '#454A51',     // grafito corporativo
  textMuted: '#6E7479',   // fb-mist

  /* Semantico OK / activo (verde corporativo — NO es el verde de marca) */
  primary: '#44BF00',
  primaryLight: '#DFF3D0',
  primaryDark: '#2E8500',
  primaryBg: '#F3FAEC',

  /* Neutro secundario */
  secondary: '#6E7479',
  secondaryLight: '#EEF0F1',

  /* Azul corporativo (info / etapas) */
  tertiary: '#0045C0',
  tertiaryLight: '#D6E1F7',
  tertiaryBg: '#EDF2FB',

  /* Peligro / alerta (rojo y ambar corporativos) */
  danger: '#FF004D',
  dangerLight: '#FFDBE6',
  warning: '#F2B600',
  warningLight: '#FCF0C8',
  warningBg: '#FFFAEA',

  /* Indigo corporativo → plan Premium */
  purple: '#5069B1',
  purpleLight: '#DDE3F2',

  /* Rosa corporativo ("descanso visual") → plan Basico */
  basico: '#C65F6B',
  basicoLight: '#F6E2E4',

  /* Marca Falabella (uso restringido: banderola, serie Grupos, chips de grupo) */
  brand: '#ADD500',       // Verde Falabella (Pantone 375 C)
  brandLight: '#E7F3B3',  // proyeccion / tinte
  brandDark: '#7C9A00',   // texto sobre blanco con identidad de marca
  brandNeon: '#00F400',   // Verde Neon (Pantone 802 C) — solo focos/acentos puntuales
  ink: '#0A0A0A',
} as const;

/* ────────────────────────────────────────────────────────────────────────────
   Formato numerico es-CL: miles con punto, decimales con coma.
   fmt     → compacto para dashboards ($1,2M · $990K)
   fmtFull → completo ($1.250.000)
   fmtPct  → porcentajes (25% · 42,5%)
   ──────────────────────────────────────────────────────────────────────────── */
export const fmt = (n: number): string => {
  const neg = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e6)
    return neg + '$' + (abs / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + 'M';
  if (abs >= 1e3) return neg + '$' + Math.round(abs / 1e3).toLocaleString('es-CL') + 'K';
  return neg + '$' + abs.toLocaleString('es-CL');
};

export const fmtFull = (n: number): string => '$' + n.toLocaleString('es-CL');

export const fmtPct = (p: number): string =>
  p.toLocaleString('es-CL', { maximumFractionDigits: 2 }) + '%';

/* ────────────────────────────────────────────────────────────────────────────
   CSS global de la app (se inyecta una vez en <style> desde App.tsx).
   Conserva toda la estructura responsive existente; solo cambia la piel.
   ──────────────────────────────────────────────────────────────────────────── */
export const CSS_STYLES =
  "@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Poppins:wght@400;500;600;700&display=swap');" +
  '@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}' +
  '@keyframes si{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}' +
  '@keyframes spin{to{transform:rotate(360deg)}}' +
  '*{box-sizing:border-box} body{margin:0} .fi{animation:fi .3s ease-out}.si{animation:si .2s ease-out}' +
  'select,input{background:#fff;border:1.5px solid #E2E5E7;color:#0A0A0A;padding:8px 12px;border-radius:6px;font-size:13px;outline:none;font-family:inherit;transition:border-color .15s, box-shadow .15s;max-width:100%}' +
  'select:focus,input:focus{border-color:#0A0A0A;box-shadow:0 0 0 3px rgba(0,244,0,.28)}' +
  '::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#D7DADD;border-radius:3px}' +
  '.row-hover{transition:background .12s}.row-hover:hover{background:#F5F6F7}' +
  /* Botones: pildoras. Primario negro (ley de marca: el verde no es boton). */
  '.btn{padding:8px 18px;border-radius:999px;font-size:13px;font-weight:700;cursor:pointer;border:1.5px solid transparent;transition:all .15s;font-family:inherit;white-space:nowrap;letter-spacing:.1px}' +
  '.btn:hover{transform:translateY(-1px)}.btn:active{transform:scale(.98)}' +
  '.btn:focus-visible{outline:2px solid #00F400;outline-offset:2px}' +
  '.btn-primary{background:#0A0A0A;color:#fff;box-shadow:0 2px 8px rgba(10,10,10,.18)}.btn-primary:hover{box-shadow:0 4px 14px rgba(10,10,10,.26)}' +
  '.btn-ghost{background:#fff;color:#454A51;border-color:#E2E5E7}.btn-ghost:hover{border-color:#0A0A0A;color:#0A0A0A}' +
  '.btn-sm{padding:4px 12px;font-size:11px}' +
  /* Superficies: radios contenidos (DS ortogonal) */
  '.card{background:#FFFFFF;border:1px solid #E2E5E7;border-radius:8px;box-shadow:0 1px 3px rgba(10,10,10,.05)}' +
  '.action-icon{color:#6E7479;cursor:pointer;transition:color .15s;font-size:14px;padding:2px 4px;border-radius:4px}.action-icon:hover{color:#0A0A0A}.del-icon:hover{color:#FF004D!important}' +
  '.month-cell{cursor:pointer;transition:background .15s;border-radius:4px}.month-cell:hover{filter:brightness(0.94)}' +
  /* Banderola: rectangulo duro, "f" minuscula negra sobre verde */
  ".fb-banderola{background:#ADD500;color:#000;display:flex;align-items:center;justify-content:center;border-radius:0;font-family:'Montserrat',sans-serif;font-weight:900;letter-spacing:-.04em;line-height:1;user-select:none}" +
  '.recharts-wrapper svg{overflow:visible!important}' +
  '.chart-scroll{width:100%;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}' +
  '.chart-scroll-inner{min-width:100%}' +
  /* === TABLET (max 1024px) === */
  '@media(max-width:1024px){' +
  '.grid-3{grid-template-columns:1fr 1fr!important}' +
  '.grid-2{grid-template-columns:1fr!important}' +
  '}' +
  /* === MOBILE (max 768px) === */
  '@media(max-width:768px){' +
  '.grid-3{grid-template-columns:1fr!important}' +
  '.header-wrap{padding:10px 14px!important}' +
  '.header-wrap h1{font-size:17px!important}' +
  '.tab-nav{width:100%;justify-content:space-between}' +
  '.tab-nav button{flex:1;padding:7px 4px!important;font-size:12px!important}' +
  /* KPI cards: 2 por fila */
  '.kpi-row > div{flex:1 1 calc(50% - 5px)!important;min-width:0!important;padding:12px 14px!important}' +
  '.kpi-row > div > div:last-child > div:first-child{white-space:normal!important}' +
  '.kpi-row > div > div:last-child > div:first-child{font-size:20px!important}' +
  /* Cards padding */
  '.card{border-radius:8px}' +
  /* Filter bar: input full width, botones en fila */
  '.filter-bar{padding:8px 10px!important;gap:6px!important}' +
  '.filter-bar > input{flex:1 1 100%!important;min-width:0!important}' +
  '.filter-bar > select{flex:1 1 calc(50% - 3px)!important;min-width:0!important;font-size:12px!important;padding:7px 8px!important}' +
  '.filter-bar > button{flex:1 1 calc(50% - 3px)!important;min-width:0!important}' +
  /* HEADERS de tabla ocultos en mobile */
  '.hunt-head,.sell-head{display:none!important}' +
  /* HUNT ROW como CARD */
  '.hunt-row{grid-template-columns:1fr!important;gap:8px!important;padding:14px!important;border-bottom:8px solid #EFF1F2!important;position:relative}' +
  '.hunt-row > div:nth-child(1){order:1}' +
  '.hunt-row > div:nth-child(2){order:2;display:flex!important;gap:8px;align-items:center;font-size:11px;color:#6E7479}' +
  '.hunt-row > div:nth-child(2) > div:last-child:before{content:"·";margin-right:4px}' +
  '.hunt-row > div:nth-child(3){order:3}' +
  '.hunt-row > div:nth-child(4){order:4;font-size:11px!important;color:#6E7479}' +
  '.hunt-row > div:nth-child(5){order:5;flex-wrap:wrap;gap:6px!important}' +
  /* SELL ROW como CARD - 2 columnas tipo "etiqueta:valor" */
  '.sell-row{grid-template-columns:1fr 1fr!important;gap:6px 12px!important;padding:14px!important;border-bottom:8px solid #EFF1F2!important;align-items:start!important}' +
  '.sell-row > div:nth-child(1){grid-column:1/-1;font-size:14px}' +
  '.sell-row > div:nth-child(2):before{content:"Categoría: ";color:#6E7479;font-size:10px;display:block;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}' +
  '.sell-row > div:nth-child(3):before{content:"Status";color:#6E7479;font-size:10px;display:block;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}' +
  '.sell-row > div:nth-child(4):before{content:"Plan";color:#6E7479;font-size:10px;display:block;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}' +
  '.sell-row > div:nth-child(5):before{content:"Tarifa";color:#6E7479;font-size:10px;display:block;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}' +
  '.sell-row > div:nth-child(6):before{content:"Dcto";color:#6E7479;font-size:10px;display:block;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}' +
  '.sell-row > div:nth-child(7):before{content:"Min";color:#6E7479;font-size:10px;display:block;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}' +
  '.sell-row > div:nth-child(8):before{content:"Contrato";color:#6E7479;font-size:10px;display:block;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}' +
  '.sell-row > div:nth-child(9){grid-column:1/-1;justify-content:flex-end;padding-top:6px;border-top:1px solid #EEF0F1}' +
  /* Charts: tipografia mas legible */
  '.recharts-cartesian-axis-tick text{font-size:10px!important}' +
  '.recharts-text.recharts-label{font-size:9px!important}' +
  '}' +
  /* === MOBILE PEQUEÑO (max 420px) === */
  '@media(max-width:420px){' +
  '.kpi-row > div{flex:1 1 100%!important}' +
  '.header-wrap{flex-direction:column!important;align-items:flex-start!important}' +
  '}';
