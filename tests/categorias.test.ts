import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIAS_BASE,
  categoriaEnUso,
  describirUsoCategoria,
  filasCategorias,
  mensajeErrorCategoria,
  nombresCategorias,
  normalizarNombreCategoria,
  problemaNuevaCategoria,
  siguienteOrden,
  usoDeCategoria,
} from '../src/lib/categorias.ts';

const BASE = [...CATEGORIAS_BASE];

describe('Lista de categorias desde la tabla', () => {
  it('sin tabla o sin filas se usan las 5 de siempre, en su orden', () => {
    assert.deepEqual(nombresCategorias(filasCategorias(null)), BASE);
    assert.deepEqual(nombresCategorias(filasCategorias([])), BASE);
    assert.deepEqual(BASE, ['Electro', 'Muebles/Hogar', 'Cat Dig', 'Moda', 'Belleza/Calzado']);
  });

  it('respeta el orden de la tabla y una nueva queda al final', () => {
    const rows = filasCategorias([
      { nombre: 'Internacional SOF', orden: 6 },
      { nombre: 'Moda', orden: 4 },
      { nombre: 'Electro', orden: 1 },
      { nombre: 'Belleza/Calzado', orden: 5 },
      { nombre: 'Cat Dig', orden: 3 },
      { nombre: 'Muebles/Hogar', orden: 2 },
    ]);
    assert.deepEqual(nombresCategorias(rows), [...BASE, 'Internacional SOF']);
  });

  it('el nombre se usa tal cual (es la llave que cruza con sellers.seccion)', () => {
    const rows = filasCategorias([{ nombre: 'Cat Dig', orden: 1 }]);
    assert.equal(rows[0].nombre, 'Cat Dig');
  });

  it('descarta filas vacias o mal formadas y duplicados sin importar mayusculas ni tildes', () => {
    const rows = filasCategorias([
      { nombre: 'Moda', orden: 1 },
      { nombre: '', orden: 2 },
      { nombre: '   ', orden: 3 },
      { orden: 4 },
      null,
      { nombre: 'MODA', orden: 5 },
      { nombre: 'Módá', orden: 6 },
      { nombre: 'Electro', orden: 'x' },
    ]);
    assert.deepEqual(nombresCategorias(rows), ['Electro', 'Moda']);
  });

  it('a igual orden, ordena por nombre', () => {
    const rows = filasCategorias([
      { nombre: 'Zeta', orden: 0 },
      { nombre: 'Alfa', orden: 0 },
    ]);
    assert.deepEqual(nombresCategorias(rows), ['Alfa', 'Zeta']);
  });
});

describe('Crear una categoria', () => {
  it('acepta un nombre nuevo', () => {
    assert.equal(problemaNuevaCategoria('Internacional SOF', BASE), null);
  });

  it('limpia espacios de mas y caracteres invisibles', () => {
    assert.equal(normalizarNombreCategoria('  Internacional   SOF '), 'Internacional SOF');
    assert.equal(normalizarNombreCategoria('Inter\u00ADnacional\u200B SOF'), 'Internacional SOF');
    assert.equal(normalizarNombreCategoria('Inter\u00A0SOF'), 'Inter SOF');
  });

  it('rechaza vacio, muy corto o muy largo', () => {
    assert.match(problemaNuevaCategoria('   ', BASE) || '', /Escribe/);
    assert.match(problemaNuevaCategoria('X', BASE) || '', /al menos 2/);
    assert.match(problemaNuevaCategoria('x'.repeat(41), BASE) || '', /hasta 40/);
    assert.equal(problemaNuevaCategoria('x'.repeat(40), BASE), null);
  });

  it('rechaza duplicados aunque cambien mayusculas, tildes o espacios', () => {
    assert.match(problemaNuevaCategoria('electro', BASE) || '', /Ya existe la categoría "Electro"/);
    assert.match(problemaNuevaCategoria('  CAT   dig ', BASE) || '', /"Cat Dig"/);
    assert.match(problemaNuevaCategoria('Electró', BASE) || '', /"Electro"/);
  });

  it('rechaza nombres reservados de la app', () => {
    assert.match(problemaNuevaCategoria('Todos', BASE) || '', /no se puede usar/);
    assert.match(problemaNuevaCategoria('na', BASE) || '', /no se puede usar/);
  });

  it('una categoria nueva queda despues de la ultima', () => {
    assert.equal(siguienteOrden([]), 1);
    assert.equal(siguienteOrden([{ nombre: 'Moda', orden: 4 }, { nombre: 'Electro', orden: 1 }]), 5);
  });
});

describe('Quitar una categoria', () => {
  const data = {
    kams: [{ gerencia: 'Moda' }, { gerencia: 'Moda' }, { gerencia: 'Electro' }],
    sellers: [{ sec: 'Moda' }, { sec: 'Electro' }, { sec: 'NA' }],
    prospectos: [{ c: 'Moda' }],
  };

  it('cuenta KAMs, sellers (en cualquier estado) y prospectos', () => {
    const u = usoDeCategoria('Moda', data);
    assert.deepEqual(u, { kams: 2, sellers: 1, prospectos: 1 });
    assert.equal(categoriaEnUso(u), true);
    assert.equal(describirUsoCategoria(u), '2 KAMs · 1 seller · 1 prospecto');
  });

  it('una categoria sin nada se puede quitar', () => {
    const u = usoDeCategoria('Internacional SOF', data);
    assert.equal(categoriaEnUso(u), false);
    assert.equal(describirUsoCategoria(u), 'sin uso');
  });

  it('solo menciona lo que tiene', () => {
    assert.equal(describirUsoCategoria({ kams: 0, sellers: 3, prospectos: 0 }), '3 sellers');
    assert.equal(describirUsoCategoria({ kams: 1, sellers: 0, prospectos: 2 }), '1 KAM · 2 prospectos');
  });
});

describe('Errores de Supabase', () => {
  it('traduce los codigos conocidos', () => {
    assert.match(mensajeErrorCategoria({ code: '42501', message: 'new row violates row-level security policy' }), /administrador/);
    assert.match(mensajeErrorCategoria({ code: '23505', message: 'duplicate key' }), /ya existe/);
    assert.match(mensajeErrorCategoria({ code: '23514', message: 'check' }), /no válido/);
    assert.match(mensajeErrorCategoria({ code: '42P01', message: 'relation "public.categorias" does not exist' }), /migración/);
    assert.match(mensajeErrorCategoria({ code: 'PGRST205', message: "Could not find the table 'public.categorias' in the schema cache" }), /migración/);
  });

  it('una categoria en uso muestra el detalle que manda la base', () => {
    const msg = 'La categoria "Moda" esta en uso (2 KAM(s), 21 seller(s)): reasigna o quita eso primero.';
    assert.equal(mensajeErrorCategoria({ code: '23503', message: msg }), msg);
  });

  it('cualquier otro error muestra su mensaje', () => {
    assert.equal(mensajeErrorCategoria({ code: 'XX', message: 'boom' }), 'boom');
    assert.equal(mensajeErrorCategoria(null), 'Error al guardar la categoría');
  });
});
