import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { generateListing } from '../js/listing.js';
import {
  newInspection, inspectZone, inspectRow, useProbeika, probeikaReport,
  pickHintTarget, useHint, foundCount, totalArgumentsRub, bargainCards,
} from '../js/inspection-core.js';
import { loadCtx } from './helpers.js';

const ctx = loadCtx();
const tutorial = () => generateListing(ctx, mulberry32(1), { forced: ctx.tutorial });
const fresh = () => newInspection(ctx.config);

test('тап по зоне с находкой даёт аргумент в рублях от V0', () => {
  const l = tutorial();
  const { state, events } = inspectZone(fresh(), ctx, l, 'exterior', 'windshield');
  assert.equal(events[0].type, 'defect');
  assert.equal(events[0].defectId, 'windshield_crack');
  assert.equal(events[0].argRub, 2100); // 1,5% от 143 000
  assert.equal(foundCount(state), 1);
});

test('повторный тап и пустая зона', () => {
  const l = tutorial();
  let r = inspectZone(fresh(), ctx, l, 'exterior', 'windshield');
  r = inspectZone(r.state, ctx, l, 'exterior', 'windshield');
  assert.equal(r.events[0].type, 'repeat');
  const empty = inspectZone(fresh(), ctx, l, 'exterior', 'hood');
  assert.equal(empty.events[0].type, 'nothing');
});

test('исходное состояние не мутируется', () => {
  const l = tutorial();
  const s0 = fresh();
  inspectZone(s0, ctx, l, 'exterior', 'windshield');
  assert.equal(foundCount(s0), 0);
});

test('схема «скрученный пробег»: обе улики раскрывают её, карта особая', () => {
  const l = tutorial();
  let r = inspectRow(fresh(), ctx, l, 'service', 'last_service');
  assert.deepEqual(r.events.map((e) => e.type), ['reveal', 'clue']);
  assert.equal(foundCount(r.state), 0, 'одной улики мало');
  r = inspectRow(r.state, ctx, l, 'odometer', 'reading');
  const types = r.events.map((e) => e.type);
  assert.ok(types.includes('scheme'));
  const scheme = r.events.find((e) => e.type === 'scheme');
  assert.equal(scheme.defectId, 'odometer_rollback');
  assert.equal(scheme.argRub, 14300); // 10% от 143 000
  assert.equal(r.state.found.odometer_rollback.special, true);
  const card = bargainCards(r.state, ctx, l).find((c) => c.defectId === 'odometer_rollback');
  assert.equal(card.special, true);
});

test('находки в документах и строки без находок', () => {
  const l = tutorial();
  let r = inspectRow(fresh(), ctx, l, 'pts', 'owners');
  assert.equal(r.events.find((e) => e.type === 'defect').defectId, 'many_owners');
  r = inspectRow(r.state, ctx, l, 'pts', 'type');
  assert.equal(r.events.at(-1).type, 'nothing');
  r = inspectRow(r.state, ctx, l, 'pts', 'vin');
  assert.equal(r.events[0].type, 'repeat', 'VIN информационная строка, не проверяется');
});

test('Пробейка: находит базовые схемы без улик и тратится один раз', () => {
  const l = tutorial();
  const r = useProbeika(fresh(), ctx, l);
  assert.ok(r.state.found.odometer_rollback);
  assert.equal(r.state.found.odometer_rollback.special, false, 'через Пробейку карта обычная');
  assert.equal(useProbeika(r.state, ctx, l).events.length, 0);
  const rep = probeikaReport(ctx, l);
  assert.equal(rep.find((x) => x.id === 'odometer_rollback').hit, true);
  assert.equal(rep.find((x) => x.id === 'pledge').hit, false);
});

test('Пробейка видит залог, но не видит утопленника', () => {
  const pledge = generateListing(ctx, mulberry32(3), {
    forced: { modelId: 'zubilo', sellerId: 'ded', scheme: null, trap: 'pledge', defects: [] },
  });
  let r = useProbeika(fresh(), ctx, pledge);
  assert.equal(r.state.trapDetected, 'pledge');
  assert.equal(bargainCards(r.state, ctx, pledge).length, 0, 'ловушка не торгуется');

  const drowned = generateListing(ctx, mulberry32(3), {
    forced: { modelId: 'zubilo', sellerId: 'ded', scheme: 'drowned', noTrap: true, defects: [] },
  });
  r = useProbeika(fresh(), ctx, drowned);
  assert.equal(r.state.trapDetected, null);
  r = inspectZone(r.state, ctx, drowned, 'interior', 'mat');
  r = inspectRow(r.state, ctx, drowned, 'service', 'ecu_swap');
  assert.equal(r.events.find((e) => e.type === 'scheme').trap, true);
  assert.equal(r.state.trapDetected, 'drowned');
});

test('бывшее такси и скрытое ДТП раскрываются по двум уликам', () => {
  const taxi = generateListing(ctx, mulberry32(5), {
    forced: { modelId: 'zubilo', sellerId: 'taxi', scheme: 'ex_taxi', noTrap: true, defects: [] },
  });
  let r = inspectZone(fresh(), ctx, taxi, 'interior', 'seat');
  r = inspectRow(r.state, ctx, taxi, 'pts', 'owner_type');
  assert.equal(r.events.find((e) => e.type === 'scheme').defectId, 'ex_taxi');

  const acc = generateListing(ctx, mulberry32(5), {
    forced: { modelId: 'zubilo', sellerId: 'perekup', scheme: 'hidden_accident', noTrap: true, defects: [] },
  });
  const zone = acc.findings.find((f) => f.defectId === 'shade_mismatch').zoneId;
  r = inspectZone(fresh(), ctx, acc, 'exterior', zone);
  assert.ok(r.events.some((e) => e.type === 'defect' && e.defectId === 'shade_mismatch'));
  r = inspectRow(r.state, ctx, acc, 'service', 'body_repair');
  assert.equal(r.events.find((e) => e.type === 'scheme').defectId, 'serious_accident');
});

test('подсказка указывает на непроверенную зону или документ и заканчивается', () => {
  const l = tutorial();
  const rng = mulberry32(9);
  let s = fresh();
  assert.ok(pickHintTarget(s, l, rng));
  for (const view of ['exterior', 'interior']) {
    for (const zoneId of Object.keys(l.zones[view])) s = inspectZone(s, ctx, l, view, zoneId).state;
  }
  for (const [docId, doc] of Object.entries(l.docs)) {
    for (const row of doc.rows) s = inspectRow(s, ctx, l, docId, row.id).state;
  }
  assert.equal(pickHintTarget(s, l, rng), null);
  assert.equal(foundCount(s), 4 + 1, 'находок 4 + схема');
});

test('счётчик подсказок', () => {
  let s = fresh();
  assert.equal(s.hintsLeft, 2);
  s = useHint(useHint(useHint(s)));
  assert.equal(s.hintsLeft, 0);
});

test('сумма аргументов считается только по найденному', () => {
  const l = tutorial();
  let s = fresh();
  assert.equal(totalArgumentsRub(s, ctx, l), 0);
  s = inspectZone(s, ctx, l, 'exterior', 'sill').state; // 4% = 5 700
  s = inspectZone(s, ctx, l, 'exterior', 'under').state; // 3% = 4 300
  assert.equal(totalArgumentsRub(s, ctx, l), 5700 + 4300);
});
