import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeConfig, deepMerge } from '../js/config.js';
import { loadCtx } from './helpers.js';

const ctx = loadCtx();

test('данные проходят проверку ссылок', () => {
  assert.ok(ctx.defects.length >= 28);
  assert.equal(ctx.schemes.length, 4);
  assert.equal(ctx.sellers.length, 5);
});

test('таблица дефектов совпадает с ТЗ (проценты от V0)', () => {
  const d = ctx.defectById;
  assert.equal(d.sill_rust.bargainPct, 4);
  assert.equal(d.sill_rust.repairPct, 2.5);
  assert.equal(d.sill_rust.repairHours, 3);
  assert.equal(d.blue_smoke.bargainPct, 8);
  assert.equal(d.engine_knock.bargainPct, 12);
  assert.equal(d.odometer_rollback.bargainPct, 10);
  assert.equal(d.serious_accident.bargainPct, 10);
  assert.equal(d.ex_taxi.bargainPct, 5);
  assert.equal(d.shade_mismatch.type, 'unfixable');
  for (const id of ['drowned', 'pledge', 'wanted']) assert.equal(d[id].type, 'trap');
});

test('доли продавцов в ленте: 25 / 20 / 20 / 25 / 10', () => {
  assert.deepEqual(ctx.sellers.map((s) => s.share), [25, 20, 20, 25, 10]);
});

test('config: удалённые значения накладываются поверх вшитых', () => {
  const merged = deepMerge(ctx.config, { economy: { askMultiplier: 1.1 } });
  assert.equal(merged.economy.askMultiplier, 1.1);
  assert.equal(merged.economy.v0Min, 0.7, 'остальное сохраняется');
});

test('config: без адреса или без сети остаётся вшитый', async () => {
  assert.equal(await mergeConfig(ctx.config, ''), ctx.config);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    assert.equal(await mergeConfig(ctx.config, 'https://example.invalid/config.json'), ctx.config);
  } finally {
    globalThis.fetch = origFetch;
  }
});
