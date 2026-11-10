import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { generateListing } from '../js/listing.js';
import { startBargain, playCard, bluff, buy, leave, finalPrice, bluffOptions } from '../js/bargain.js';
import { newInspection } from '../js/inspection-core.js';
import { loadCtx, fixedRng } from './helpers.js';

const ctx = loadCtx();
const cfg = ctx.config;
const listing = generateListing(ctx, mulberry32(1), { forced: ctx.tutorial });
const card = (defectId, argRub, special = false) => ({ defectId, argRub, special });

test('торг начинается с цены объявления и полного терпения', () => {
  const s = startBargain(listing, ctx.sellerById.ded);
  assert.equal(s.price, 150000);
  assert.equal(s.patience, 4);
});

test('принял: цена минус аргумент; отказал: минус 1 терпение', () => {
  const seller = ctx.sellerById.ded; // уступчивость 0,5
  let r = playCard(startBargain(listing, seller), card('dent', 3000), seller, fixedRng(0.1));
  assert.equal(r.result.type, 'accept');
  assert.equal(r.state.price, 147000);
  r = playCard(startBargain(listing, seller), card('dent', 3000), seller, fixedRng(0.9));
  assert.equal(r.result.type, 'refuse');
  assert.equal(r.state.patience, 3);
  assert.equal(r.state.price, 150000);
});

test('терпение кончилось: продавец уходит', () => {
  const seller = ctx.sellerById.perekup; // терпение 2
  let s = startBargain(listing, seller);
  s = playCard(s, card('a', 1000), seller, fixedRng(0.99)).state;
  const r = playCard(s, card('b', 1000), seller, fixedRng(0.99));
  assert.equal(r.state.status, 'seller_left');
  assert.equal(r.result.left, true);
});

test('карта раскрытой схемы принимается всегда', () => {
  const seller = ctx.sellerById.perekup;
  const r = playCard(startBargain(listing, seller), card('odometer_rollback', 14300, true), seller, fixedRng(0.999));
  assert.equal(r.result.type, 'accept');
  assert.equal(r.state.price, 150000 - 14300);
});

test('одну карту нельзя сыграть дважды', () => {
  const seller = ctx.sellerById.family;
  let r = playCard(startBargain(listing, seller), card('dent', 3000), seller, fixedRng(0));
  r = playCard(r.state, card('dent', 3000), seller, fixedRng(0));
  assert.equal(r.result.type, 'already');
});

test('блеф: нет такой находки, минус 2 терпения (у деда 3)', () => {
  const ded = ctx.sellerById.ded;
  let r = bluff(startBargain(listing, ded), 'dent', false, listing, ctx, ded, fixedRng(0), cfg);
  assert.equal(r.result.type, 'bluff_fail');
  assert.equal(r.state.patience, 4 - 3);
  const fam = ctx.sellerById.family;
  r = bluff(startBargain(listing, fam), 'dent', false, listing, ctx, fam, fixedRng(0), cfg);
  assert.equal(r.state.patience, 3 - 2);
});

test('блеф: находка есть, работает как обычная карта', () => {
  const fam = ctx.sellerById.family; // 0,8
  const r = bluff(startBargain(listing, fam), 'windshield_crack', true, listing, ctx, fam, fixedRng(0.1), cfg);
  assert.equal(r.result.type, 'bluff_ok');
  assert.equal(r.state.price, 150000 - 2100);
});

test('у перекупа блеф не работает даже если находка есть', () => {
  const p = ctx.sellerById.perekup;
  const r = bluff(startBargain(listing, p), 'windshield_crack', true, listing, ctx, p, fixedRng(0), cfg);
  assert.equal(r.result.type, 'bluff_fail');
});

test('семья уступает ещё 5% при сделке за 3 карты или меньше', () => {
  const fam = ctx.sellerById.family;
  let s = startBargain(listing, fam);
  assert.equal(finalPrice(s, fam, cfg), 142500);
  for (const id of ['a', 'b', 'c']) s = playCard(s, card(id, 0), fam, fixedRng(0)).state;
  assert.equal(finalPrice(s, fam, cfg), 142500);
  s = playCard(s, card('d', 0), fam, fixedRng(0)).state;
  assert.equal(finalPrice(s, fam, cfg), 150000, 'четвёртая карта: бонуса нет');
});

test('покупка: хватает денег и не хватает', () => {
  const seller = ctx.sellerById.ded;
  const s = startBargain(listing, seller);
  assert.equal(buy(s, seller, 100000, cfg).ok, false);
  const ok = buy(s, seller, 200000, cfg);
  assert.equal(ok.ok, true);
  assert.equal(ok.state.status, 'bought');
  assert.equal(ok.state.paid, 150000);
  assert.equal(buy(ok.state, seller, 200000, cfg).ok, false, 'закрытую сделку не повторить');
});

test('уйти можно в любой момент', () => {
  assert.equal(leave(startBargain(listing, ctx.sellerById.ded)).status, 'player_left');
});

test('у салона торга нет', () => {
  const salon = ctx.sellerById.salon;
  const l = generateListing(ctx, mulberry32(2), { rep: 10, forced: { sellerId: 'salon', modelId: 'zubilo', scheme: null, defects: [] } });
  const s = startBargain(l, salon);
  assert.equal(playCard(s, card('a', 1000), salon, fixedRng(0)).result.type, 'blocked');
  assert.equal(buy(s, salon, 10 ** 9, cfg).price, l.ask);
});

test('доля принятых карт близка к уступчивости продавца', () => {
  for (const id of ['ded', 'family', 'taxi', 'perekup']) {
    const seller = ctx.sellerById[id];
    const rng = mulberry32(123);
    let accepted = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const r = playCard(startBargain(listing, seller), card('x', 1000), seller, rng);
      if (r.result.type === 'accept') accepted++;
    }
    assert.ok(Math.abs(accepted / N - seller.yield) < 0.03, `${id}: ${accepted / N}`);
  }
});

test('список для блефа: без ловушек, найденного и находок только для инструментов', () => {
  const insp = newInspection(cfg);
  insp.found.dent = { via: 'zone', special: false };
  const ids = bluffOptions(ctx, insp, ctx.modelById.zubilo).map((d) => d.id);
  assert.ok(!ids.includes('dent'));
  assert.ok(!ids.includes('pledge') && !ids.includes('drowned'));
  assert.ok(!ids.includes('putty') && !ids.includes('engine_knock'));
  assert.ok(ids.includes('sill_rust'));
  assert.ok(!ids.includes('blue_smoke'), 'у Зубила нет зоны выхлопа');
});
