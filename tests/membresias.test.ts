import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateStatus,
  kamCollision,
  newMembershipProblem,
  sellerAccessEvent,
  sellersByAggregateStatus,
  uniqueSellerCount,
  type MembershipLike,
} from '../src/lib/membresias.ts';

const m = (sid: string, kam: string, status = 'Iniciado', tipo = 'Full'): MembershipLike => ({
  sid,
  sellerId: sid.replace(/-\d+$/, ''),
  seller: 'Seller',
  kam,
  status,
  tipo,
});

describe('Avisos a Teams por seller, no por membresia', () => {
  it('con una sola membresia se comporta igual que antes', () => {
    assert.equal(sellerAccessEvent([], ['Iniciado'], true), 'created');
    assert.equal(sellerAccessEvent(['Iniciado'], ['Fuga'], false), 'fuga');
    assert.equal(sellerAccessEvent(['Pausa'], ['Fuga'], false), 'fuga');
    assert.equal(sellerAccessEvent(['Iniciado'], ['Pausa'], false), 'pausa');
    assert.equal(sellerAccessEvent(['Fuga'], ['Pausa'], false), 'pausa');
    assert.equal(sellerAccessEvent(['Pausa'], ['Iniciado'], false), 'reactivacion');
    assert.equal(sellerAccessEvent(['Fuga'], ['Iniciado'], false), null);
    assert.equal(sellerAccessEvent(['Iniciado'], ['Iniciado'], false), null);
  });

  it('una 2ª membresia de un seller activo no pide crear cuentas de nuevo', () => {
    assert.equal(sellerAccessEvent(['Iniciado'], ['Iniciado', 'Iniciado'], true), null);
  });

  it('pausar o dar de baja una membresia no corta el acceso si otra sigue activa', () => {
    assert.equal(sellerAccessEvent(['Iniciado', 'Iniciado'], ['Iniciado', 'Pausa'], false), null);
    assert.equal(sellerAccessEvent(['Iniciado', 'Iniciado'], ['Iniciado', 'Fuga'], false), null);
  });

  it('el aviso sale cuando cambia el estado del seller completo', () => {
    assert.equal(sellerAccessEvent(['Fuga', 'Iniciado'], ['Fuga', 'Fuga'], false), 'fuga');
    assert.equal(sellerAccessEvent(['Pausa', 'Pausa'], ['Pausa', 'Iniciado'], false), 'reactivacion');
    assert.equal(sellerAccessEvent(['Fuga'], ['Fuga', 'Iniciado'], true), 'created');
  });

  it('estado agregado: activo si alguna membresia esta activa', () => {
    assert.equal(aggregateStatus([]), null);
    assert.equal(aggregateStatus(['Fuga', 'Iniciado']), 'Iniciado');
    assert.equal(aggregateStatus(['Fuga', 'Pausa']), 'Pausa');
    assert.equal(aggregateStatus(['Fuga', 'Fuga']), 'Fuga');
  });
});

describe('Reglas de una nueva membresia', () => {
  const existentes = [m('SC1', 'KAM A')];

  it('se permite con otro KAM en plan Full', () => {
    assert.equal(newMembershipProblem(existentes, { tipo: 'Full', kam: 'KAM B', esMulticuenta: false }), null);
  });

  it('se bloquea con el mismo KAM, sin plan Full o como multicuenta', () => {
    assert.match(newMembershipProblem(existentes, { tipo: 'Full', kam: 'KAM A', esMulticuenta: false }) ?? '', /KAM A/);
    assert.match(newMembershipProblem(existentes, { tipo: 'Premium', kam: '-', esMulticuenta: false }) ?? '', /Full/);
    assert.match(newMembershipProblem(existentes, { tipo: 'Full', kam: 'KAM B', esMulticuenta: true }) ?? '', /multicuenta/);
  });

  it('una membresia en Fuga libera su KAM', () => {
    assert.equal(newMembershipProblem([m('SC1', 'KAM A', 'Fuga')], { tipo: 'Full', kam: 'KAM A', esMulticuenta: false }), null);
  });

  it('al editar, otra membresia vigente con el mismo KAM choca', () => {
    const otras = [m('SC1-2', 'KAM B')];
    assert.equal(kamCollision(otras, { kam: 'KAM B', status: 'Iniciado', tipo: 'Full' })?.sid, 'SC1-2');
    assert.equal(kamCollision(otras, { kam: 'KAM A', status: 'Iniciado', tipo: 'Full' }), null);
    assert.equal(kamCollision(otras, { kam: 'KAM B', status: 'Fuga', tipo: 'Full' }), null);
  });
});

describe('KPIs de sellers', () => {
  const filas = [m('SC1', 'KAM A'), m('SC1-2', 'KAM B'), m('SC2', 'KAM A', 'Pausa'), m('SC3', 'KAM C', 'Fuga'), m('SC4', 'KAM C', 'Fuga'), m('SC4-2', 'KAM D')];

  it('un seller con dos membresias cuenta una vez', () => {
    assert.equal(uniqueSellerCount(filas), 4);
    assert.deepEqual(sellersByAggregateStatus(filas), { Iniciado: 2, Pausa: 1, Fuga: 1 });
  });
});
