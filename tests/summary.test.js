import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { generateListing } from '../js/listing.js';
import { newInspection, inspectZone, inspectRow, useProbeika } from '../js/inspection-core.js';
import { buildSummary } from '../js/summary.js';
import { loadCtx } from './helpers.js';

const ctx = loadCtx();
const tutorial = () => generateListing(ctx, mulberry32(1), { forced: ctx.tutorial });

test('итог: найденное, пропущенное и то, что показала бы Пробейка', () => {
  const l = tutorial();
  let insp = inspectZone(newInspection(ctx.config), ctx, l, 'exterior', 'windshield').state;
  const s = buildSummary(ctx, l, insp, { status: 'player_left' });
  assert.equal(s.found.length, 1);
  assert.deepEqual(s.probeika.map((x) => x.defectId), ['odometer_rollback']);
  assert.deepEqual(s.missed.map((x) => x.defectId).sort(), ['many_owners', 'oil_leak', 'sill_rust']);
  assert.equal(s.paid, null);
  assert.equal(s.mileageConfirmedKm, null);
});

test('итог покупки: скидка к объявлению и подтверждение скрутки', () => {
  const l = tutorial();
  let insp = inspectRow(newInspection(ctx.config), ctx, l, 'service', 'last_service').state;
  insp = inspectRow(insp, ctx, l, 'odometer', 'reading').state;
  const s = buildSummary(ctx, l, insp, { status: 'bought', price: 130000 });
  assert.equal(s.paid, 130000);
  assert.equal(s.discount, 20000);
  assert.equal(s.mileageConfirmedKm, 40000);
  assert.equal(s.trapBought, null);
});

test('купленная ловушка: продаётся только скупщику за 62% V0', () => {
  const l = generateListing(ctx, mulberry32(3), { forced: { modelId: 'zubilo', sellerId: 'perekup', scheme: null, trap: 'pledge', defects: [] } });
  const insp = useProbeika(newInspection(ctx.config), ctx, l).state;
  const s = buildSummary(ctx, l, insp, { status: 'bought', price: 100000 });
  assert.equal(s.trapBought, 'pledge');
  assert.equal(s.trapSalePrice, Math.round((l.v0 * 0.62) / 1000) * 1000);
});
