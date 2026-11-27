/* ════════════════════════════════════════════════════════════════════════════
   CATEGORIAS — gerencias del programa (Electro, Moda, … Internacional SOF).
   Viven en la tabla `categorias` y un administrador las agrega desde
   Admin › Cupos y KAMs › gestionar categorías, sin volver a publicar la app.
   Los datos guardan el NOMBRE como texto (sellers.seccion, prospects.categoria,
   kams_cupos.gerencia), asi que una categoria no se renombra: se agrega o, si
   nadie la usa, se quita. La base aplica las mismas reglas (ver la migracion
   20261127140000_categorias_configurables.sql).
   Logica pura: sin React ni Supabase.
   ════════════════════════════════════════════════════════════════════════════ */

/** Las 5 de siempre. Respaldo si la tabla no existe todavia o no responde. */
export const CATEGORIAS_BASE: readonly string[] = ['Electro', 'Muebles/Hogar', 'Cat Dig', 'Moda', 'Belleza/Calzado'];

export const NOMBRE_CATEGORIA_MAX = 40;
/** 'Todos' es el valor del filtro de la app; 'NA' y '-' ya se usan como "sin dato". */
const RESERVADOS = ['todos', 'na', '-'];

export type CategoriaRow = { nombre: string; orden: number };

/** Saca caracteres invisibles (soft hyphen, zero-width) y espacios de mas. */
export const normalizarNombreCategoria = (s: string): string =>
  String(s ?? '')
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Clave para comparar nombres: sin mayusculas ni tildes ('Electró' = 'electro'). */
const clave = (s: string): string =>
  normalizarNombreCategoria(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Filas de la tabla → filas validas en el orden de la app (orden, luego nombre).
 *  El nombre se respeta tal cual viene: es la llave con la que cruzan los datos. */
export const filasCategorias = (rows: readonly unknown[] | null | undefined): CategoriaRow[] => {
  const vistas = new Set<string>();
  return (rows || [])
    .map((r) => {
      const o = (r || {}) as { nombre?: unknown; orden?: unknown };
      const orden = Number(o.orden);
      return { nombre: typeof o.nombre === 'string' ? o.nombre : '', orden: Number.isFinite(orden) ? orden : 0 };
    })
    .filter((r) => r.nombre.trim() !== '')
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'))
    .filter((r) => {
      const k = clave(r.nombre);
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    });
};

/** Nombres a mostrar. Sin filas (tabla vacia o sin migrar) → las 5 de siempre. */
export const nombresCategorias = (rows: readonly CategoriaRow[]): string[] =>
  rows.length > 0 ? rows.map((r) => r.nombre) : [...CATEGORIAS_BASE];

/** Por que no se puede crear esa categoria; null si se puede. */
export const problemaNuevaCategoria = (nombre: string, existentes: readonly string[]): string | null => {
  const n = normalizarNombreCategoria(nombre);
  if (n === '') return 'Escribe el nombre de la categoría';
  if (n.length < 2) return 'El nombre debe tener al menos 2 caracteres';
  if (n.length > NOMBRE_CATEGORIA_MAX) return 'El nombre puede tener hasta ' + NOMBRE_CATEGORIA_MAX + ' caracteres';
  if (RESERVADOS.includes(n.toLowerCase())) return '"' + n + '" no se puede usar como categoría';
  const igual = existentes.find((e) => clave(e) === clave(n));
  if (igual) return 'Ya existe la categoría "' + igual + '"';
  return null;
};

/** Una categoria nueva queda al final. */
export const siguienteOrden = (rows: readonly CategoriaRow[]): number =>
  rows.reduce((max, r) => Math.max(max, Number.isFinite(r.orden) ? r.orden : 0), 0) + 1;

/** Lo que usa una categoria: con cualquiera de estas cosas no se puede quitar
 *  (cuenta sellers en cualquier estado, igual que la base). */
export type UsoCategoria = { kams: number; sellers: number; prospectos: number };

export const usoDeCategoria = (
  nombre: string,
  data: {
    kams: readonly { gerencia: string }[];
    sellers: readonly { sec: string }[];
    prospectos: readonly { c: string }[];
  }
): UsoCategoria => ({
  kams: data.kams.filter((k) => k.gerencia === nombre).length,
  sellers: data.sellers.filter((s) => s.sec === nombre).length,
  prospectos: data.prospectos.filter((p) => p.c === nombre).length,
});

export const categoriaEnUso = (u: UsoCategoria): boolean => u.kams + u.sellers + u.prospectos > 0;

const contar = (n: number, uno: string, varios: string) => n + ' ' + (n === 1 ? uno : varios);

/** '2 KAMs · 28 sellers · 6 prospectos' (solo lo que tiene). */
export const describirUsoCategoria = (u: UsoCategoria): string =>
  [
    u.kams > 0 ? contar(u.kams, 'KAM', 'KAMs') : '',
    u.sellers > 0 ? contar(u.sellers, 'seller', 'sellers') : '',
    u.prospectos > 0 ? contar(u.prospectos, 'prospecto', 'prospectos') : '',
  ]
    .filter(Boolean)
    .join(' · ') || 'sin uso';

/** Error de Supabase → mensaje para el toast. */
export const mensajeErrorCategoria = (err: { code?: string; message?: string } | null | undefined): string => {
  const code = err?.code || '';
  if (code === '42501') return 'Solo un administrador puede agregar o quitar categorías';
  if (code === '23505') return 'Esa categoría ya existe';
  if (code === '23514') return 'Nombre de categoría no válido';
  if (code === '23503') return err?.message || 'La categoría está en uso: reasigna o quita eso primero';  const msg = err?.message || '';
  if (code === '42P01' || code === 'PGRST205' || (/categorias/i.test(msg) && /does not exist|schema cache/i.test(msg)))
    return 'Falta aplicar la migración de categorías en Supabase';
  return err?.message || 'Error al guardar la categoría';
};
