import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { roundTo, generateV0, askPrice, argumentRub, repLevel, probeikaDailyAllowance, fmtRub } from '../js/economy.js';
import { mskDayKey, msUntilMskMidnight } from '../js/clock.js';
import { loadCtx } from './helpers.js';

const ctx = loadCtx();
const eco = ctx.config.economy;

test('ГСЧ воспроизводим по сиду', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('V0 лежит в коридоре 0,7–1,3 от средней цены', () => {
  const rng = mulberry32(1);
  const model = ctx.modelById.zubilo;
  for (let i = 0; i < 500; i++) {
    const v0 = generateV0(rng, model, eco);
    assert.ok(v0 >= model.avgPrice * 0.7 - 1000 && v0 <= model.avgPrice * 1.3 + 1000);
    assert.equal(v0 % eco.priceRoundStep, 0);
  }
});

test('цена в объявлении: 1,05 × V0, у салона 1,08', () => {
  assert.equal(askPrice(143000, ctx.sellerById.ded, eco), 150000);
  assert.equal(askPrice(100000, ctx.sellerById.salon, eco), 108000);
});

test('аргумент: процент от V0, округление до 100 ₽', () => {
  assert.equal(argumentRub(10, 143000, eco), 14300);
  assert.equal(argumentRub(1.5, 143000, eco), 2100);
  assert.equal(argumentRub(0, 143000, eco), 0);
});

test('формат рублей', () => {
  assert.equal(fmtRub(150000).replace(/ /g, ' '), '150 000 ₽');
});

test('репутация: уровень N требует 50 × N опыта, максимум 20', () => {
  const r = ctx.config.reputation;
  assert.equal(repLevel(0, r), 0);
  assert.equal(repLevel(49, r), 0);
  assert.equal(repLevel(50, r), 1);
  assert.equal(repLevel(149, r), 1);
  assert.equal(repLevel(150, r), 2);
  assert.equal(repLevel(10 ** 9, r), 20);
});

test('жетоны Пробейки в день: 1 + бонусы на 2, 5 и 12 уровне', () => {
  const p = ctx.config.probeika;
  assert.equal(probeikaDailyAllowance(0, p), 1);
  assert.equal(probeikaDailyAllowance(2, p), 2);
  assert.equal(probeikaDailyAllowance(5, p), 3);
  assert.equal(probeikaDailyAllowance(12, p), 4);
});

test('сутки по МСК меняются в 00:00 по Москве', () => {
  const before = Date.UTC(2026, 10, 6, 20, 59, 0); // 23:59 МСК
  const after = Date.UTC(2026, 10, 6, 21, 0, 0); // 00:00 МСК, уже 7 ноября
  assert.equal(mskDayKey(before), '2026-11-06');
  assert.equal(mskDayKey(after), '2026-11-07');
  assert.equal(msUntilMskMidnight(before), 60 * 1000);
});

test('roundTo', () => {
  assert.equal(roundTo(150150, 1000), 150000);
});
