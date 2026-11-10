import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSave, loadSave, rollDay } from '../js/store.js';
import { encodeSave, decodeSave } from '../js/saveCodec.js';
import { parkCar, startRepairs, listForSale, capitalOf } from '../js/garage.js';
import { listingFromRef } from '../js/listing.js';
import { buildFeed, updateHistory } from '../js/feed.js';
import { loadCtx } from './helpers.js';

const ctx = loadCtx();
const cfg = ctx.config;
const DAY = 86400000;

test('новое сохранение: стартовые деньги, 3 осмотра, 1 жетон Пробейки', () => {
  const s = defaultSave(cfg);
  assert.equal(s.money, cfg.economy.startMoney);
  assert.equal(s.insp.n, 3);
  assert.equal(s.probeika.tokens, 1);
  assert.equal(s.tutorialDone, false);
});

test('сохранение с гаражом, лентой и историей проходит через облачный формат и влезает в лимит ВК', () => {
  const s = defaultSave(cfg);
  const t0 = Date.UTC(2026, 10, 6, 12);
  let history = {};
  let lastRare = -999;
  // 30 дней ленты: самая тяжёлая история
  for (let d = 0; d < 30; d++) {
    const dayKey = new Date(t0 + d * DAY).toISOString().slice(0, 10);
    const feed = buildFeed(ctx, { dayKey, playerSeed: s.playerSeed, capital: 500000, rep: 3, history, lastRareDay: lastRare });
    const u = updateHistory(ctx, history, feed, lastRare);
    history = u.history;
    lastRare = u.lastRareDay;
    s.feed = feed;
  }
  s.history = history;
  s.lastRareDay = lastRare;
  const entry = s.feed.entries[0];
  const ref = { seed: entry.seed, rep: entry.rep, seg: entry.seg, rar: entry.rar };
  const listing = listingFromRef(ctx, ref);
  const found = listing.findings.map((f) => f.defectId);
  const parked = parkCar(s.garage, { ref, listing, paid: listing.ask, found, now: t0 });
  s.garage = parked.garage;
  const parts = encodeSave(s);
  for (const [k, v] of Object.entries(parts)) {
    if (k !== 'sv_n') assert.ok(v.length < 4096, `${k} длиннее лимита VKWebAppStorageSet`);
  }
  assert.ok(Object.keys(parts).length <= 1000);
  assert.deepEqual(decodeSave(parts), JSON.parse(JSON.stringify(s)));
  assert.equal(capitalOf(s.money, s.garage), s.money + listing.ask);
});

test('loadSave берёт более свежее из облака и локального кэша; чужой формат отбрасывает', () => {
  const old = defaultSave(cfg);
  old.money = 111;
  old.lastSeen = 1000;
  const fresh = defaultSave(cfg);
  fresh.money = 222;
  fresh.lastSeen = 2000;
  const got = loadSave(cfg, encodeSave(fresh));
  assert.equal(got.money, 222);
  const bad = loadSave(cfg, encodeSave({ v: 1, money: 5 }));
  assert.equal(bad.money, cfg.economy.startMoney);
  assert.equal(loadSave(cfg, { sv_n: '1', sv_0: 'мусор' }).money, cfg.economy.startMoney);
  void old;
});

test('rollDay: новые сутки по МСК дают жетон и осмотры за время', () => {
  const s = defaultSave(cfg);
  const t0 = Date.UTC(2026, 10, 6, 9);
  rollDay(s, cfg, t0);
  s.probeika.tokens = 0;
  s.insp = { ...s.insp, n: 0, regenAt: t0 + 4 * 3600000 };
  const key = rollDay(s, cfg, t0 + DAY);
  assert.ok(s.probeika.tokens >= 1);
  assert.equal(s.probeika.dayKey, key);
  assert.equal(s.insp.n, 3);
});

test('ремонт и продажа: таймеры считаются от меток времени и переживают сохранение', () => {
  const s = defaultSave(cfg);
  const t0 = Date.UTC(2026, 10, 6, 9);
  const ref = { seed: 5, rep: 0, seg: ['buckets'], rar: null };
  const listing = listingFromRef(ctx, ref);
  const found = listing.findings.map((f) => f.defectId);
  let car = parkCar(s.garage, { ref, listing, paid: listing.ask, found, now: t0 }).car;
  const fix = found.filter((id) => ctx.defectById[id].type === 'fixable');
  if (fix.length) {
    const r = startRepairs(ctx, car, listing, fix, t0, 10_000_000);
    car = r.car;
    assert.ok(Object.values(car.repairing).every((x) => x.endAt > t0));
  }
  car = listForSale(ctx, car, listing, 'market', false, t0, 42);
  const back = JSON.parse(JSON.stringify(decodeSave(encodeSave({ car }))));
  assert.deepEqual(back.car, JSON.parse(JSON.stringify(car)));
});
