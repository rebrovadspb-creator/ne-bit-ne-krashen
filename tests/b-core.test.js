import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { generateListing, listingFromRef, listingKey } from '../js/listing.js';
import { buildFeed, updateHistory, dayIndex, unlockedSegments, nextClosedSegment, listingFromEntry } from '../js/feed.js';
import { newInspections, syncInspections, spendInspection, addByAd, msToNextInspection } from '../js/limits.js';
import { newAdCounters, adRemaining, adWatched, interstitialAllowed, interstitialShown } from '../js/ads.js';
import * as G from '../js/garage.js';
import { compress, decompress, encodeSave, decodeSave } from '../js/saveCodec.js';
import { loadCtx } from './helpers.js';

const ctx = loadCtx();
const cfg = ctx.config;
const HOUR = 3600 * 1000;

// ---------- сжатие ----------
test('сжатие сохранения: туда и обратно без потерь', () => {
  const obj = { money: 123456, text: 'Зубило «Не бит» 🚗', arr: Array.from({ length: 500 }, (_, i) => ({ i, k: 'defect_' + (i % 7) })) };
  assert.deepEqual(decompress(compress(obj)), obj);
});

test('сохранение режется на куски не длиннее лимита и собирается обратно', () => {
  const obj = { history: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [(i * 7919).toString(36), 20000 + (i % 30)])) };
  const parts = encodeSave(obj, 1000);
  for (const [k, v] of Object.entries(parts)) if (k !== 'sv_n') assert.ok(v.length <= 1000);
  assert.deepEqual(decodeSave(parts), obj);
  assert.equal(decodeSave({}), null);
  assert.equal(decodeSave({ sv_n: '2', sv_0: 'x' }), null);
});

// ---------- лента ----------
const baseFeed = (over = {}) => ({ dayKey: '2026-11-06', playerSeed: 7, capital: 200000, rep: 0, history: {}, lastRareDay: dayIndex('2026-11-06'), refreshN: 0, ...over });

test('лента: 5 объявлений и закрытое из следующего сегмента', () => {
  const f = buildFeed(ctx, baseFeed());
  assert.equal(f.entries.length, 5);
  assert.equal(f.teaser.segmentName, 'Рабочие лошадки');
  assert.equal(f.teaser.unlockCapital, 350000);
  for (const e of f.entries) assert.deepEqual(e.seg, ['buckets']);
  const l = listingFromEntry(ctx, f.teaser);
  assert.equal(ctx.modelById[l.modelId].segment, 'workhorses');
});

test('лента воспроизводится из сида, а обновление даёт другую', () => {
  const a = buildFeed(ctx, baseFeed());
  assert.deepEqual(buildFeed(ctx, baseFeed()), a);
  assert.notDeepEqual(buildFeed(ctx, baseFeed({ refreshN: 1 })).entries.map((e) => e.seed), a.entries.map((e) => e.seed));
  assert.notDeepEqual(buildFeed(ctx, baseFeed({ dayKey: '2026-11-07' })).entries.map((e) => e.seed), a.entries.map((e) => e.seed));
});

test('сегмент 2 открывается с капиталом 350 000, закрытых сегментов с моделями больше нет', () => {
  assert.deepEqual(unlockedSegments(ctx, 349999), ['buckets']);
  assert.deepEqual(unlockedSegments(ctx, 350000), ['buckets', 'workhorses']);
  assert.equal(nextClosedSegment(ctx, 350000), null, 'у сегментов 3 и 4 пока нет моделей');
});

test('одна комбинация не повторяется чаще раза в 30 дней (по возможности)', () => {
  let history = {};
  let lastRareDay = -999;
  const seenDay = {};
  for (let d = 0; d < 20; d++) {
    const dayKey = new Date(Date.UTC(2026, 10, 1 + d)).toISOString().slice(0, 10);
    const f = buildFeed(ctx, baseFeed({ dayKey, history, lastRareDay, capital: 400000 }));
    for (const k of f.keys) {
      if (seenDay[k] !== undefined) assert.fail(`комбинация ${k} повторилась через ${d - seenDay[k]} дн.`);
      seenDay[k] = d;
    }
    ({ history, lastRareDay } = updateHistory(ctx, history, f, lastRareDay));
  }
});

test('редкая машина появляется хотя бы раз в 5 дней', () => {
  let history = {};
  let lastRareDay = -999;
  let since = 0;
  let worst = 0;
  for (let d = 0; d < 120; d++) {
    const dayKey = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    const f = buildFeed(ctx, baseFeed({ dayKey, history, lastRareDay, capital: 400000, playerSeed: 3 }));
    const rare = f.entries.some((e) => listingFromEntry(ctx, e).rarity !== 'common');
    since = rare ? 0 : since + 1;
    worst = Math.max(worst, since);
    ({ history, lastRareDay } = updateHistory(ctx, history, f, lastRareDay));
  }
  assert.ok(worst <= 4, `дней без редкой подряд: ${worst}`);
});

test('история забывает комбинации старше 30 дней', () => {
  const f = buildFeed(ctx, baseFeed());
  const h = updateHistory(ctx, { old: dayIndex('2026-11-06') - 40, fresh: dayIndex('2026-11-06') - 5 }, f, 0).history;
  assert.equal(h.old, undefined);
  assert.equal(h.fresh, dayIndex('2026-11-06') - 5);
  for (const k of f.keys) assert.equal(h[k], dayIndex('2026-11-06'));
});

test('доли редкости: редкая около 8%, коллекционная около 2%', () => {
  const n = 6000;
  let rare = 0;
  let collector = 0;
  for (let s = 1; s <= n; s++) {
    const l = generateListing(ctx, mulberry32(s), { segments: ['workhorses'] });
    if (l.rarity === 'rare') rare++;
    if (l.rarity === 'collector') collector++;
  }
  assert.ok(Math.abs(rare / n - 0.075) < 0.025, `редкая ${rare / n}`);
  assert.ok(Math.abs(collector / n - 0.02) < 0.012, `коллекционная ${collector / n}`);
});

test('редкая машина: продавец просит цену обычной, настоящая стоимость выше на 15%', () => {
  const l = generateListing(ctx, mulberry32(1), { rarity: 'rare', segments: ['buckets'] });
  assert.equal(l.rarity, 'rare');
  assert.equal(l.valueBonus, 0.15);
  assert.ok(Math.abs(l.v0True - l.v0 * 1.15) <= 500);
  assert.ok(Math.abs(l.ask - l.v0 * 1.05) <= 500, 'цена в объявлении как у обычной');
  const c = generateListing(ctx, mulberry32(1), { rarity: 'collector', segments: ['workhorses'] });
  assert.equal(c.modelId, 'bukhanka');
  assert.equal(c.valueBonus, 0.35);
});

test('listingFromRef воспроизводит объявление, учебное тоже', () => {
  const ref = { seed: 99, rep: 0, seg: ['buckets'], rar: null };
  assert.deepEqual(listingFromRef(ctx, ref), listingFromRef(ctx, ref));
  assert.equal(listingFromRef(ctx, { seed: 1, tutorial: true }).ask, 150000);
  assert.equal(listingKey(listingFromRef(ctx, ref)), listingKey(listingFromRef(ctx, ref)));
});

// ---------- лимиты осмотров ----------
test('осмотры: 3 в день, +1 каждые 4 часа, считаем от меток времени', () => {
  const t0 = 1_000_000_000_000;
  let s = newInspections(cfg);
  assert.equal(s.n, 3);
  s = spendInspection(s, t0, cfg);
  s = spendInspection(s, t0, cfg);
  s = spendInspection(s, t0, cfg);
  assert.equal(s.n, 0);
  assert.equal(spendInspection(s, t0, cfg), null, 'без осмотров нельзя');
  assert.equal(msToNextInspection(s, t0), 4 * HOUR);
  assert.equal(syncInspections(s, t0 + 4 * HOUR - 1, cfg).n, 0);
  assert.equal(syncInspections(s, t0 + 4 * HOUR, cfg).n, 1);
  assert.equal(syncInspections(s, t0 + 9 * HOUR, cfg).n, 2);
  assert.equal(syncInspections(s, t0 + 100 * HOUR, cfg).n, 3, 'не больше максимума');
  assert.equal(syncInspections(s, t0 + 100 * HOUR, cfg).regenAt, null);
});

test('осмотры за рекламу: до 2 в сутки, на следующие сутки снова', () => {
  let s = { ...newInspections(cfg), n: 0 };
  s = addByAd(s, '2026-11-06', cfg);
  s = addByAd(s, '2026-11-06', cfg);
  assert.equal(s.n, 2);
  assert.equal(addByAd(s, '2026-11-06', cfg), null);
  assert.equal(addByAd(s, '2026-11-07', cfg).n, 3);
});

// ---------- реклама ----------
test('реклама: лимиты по местам и сброс в новые сутки', () => {
  let ad = newAdCounters();
  assert.equal(adRemaining(ad, 'repair_boost', 'd1', cfg), 3);
  ad = adWatched(adWatched(ad, 'repair_boost', 'd1'), 'seller_return', 'd1');
  assert.equal(adRemaining(ad, 'repair_boost', 'd1', cfg), 2);
  assert.equal(adRemaining(ad, 'seller_return', 'd1', cfg), 0);
  assert.equal(adRemaining(ad, 'repair_boost', 'd2', cfg), 3);
  assert.equal(adRemaining(ad, 'нет_такого', 'd1', cfg), 0);
});

test('межстраничная: не в обучении, не в первой сессии, только после сделки, не чаще раза в 3 минуты', () => {
  let ad = newAdCounters();
  const t = 10_000_000;
  const ok = { tutorial: false, firstSession: false, afterDeal: true };
  assert.equal(interstitialAllowed(ad, t, cfg, ok), true);
  assert.equal(interstitialAllowed(ad, t, cfg, { ...ok, tutorial: true }), false);
  assert.equal(interstitialAllowed(ad, t, cfg, { ...ok, firstSession: true }), false);
  assert.equal(interstitialAllowed(ad, t, cfg, { ...ok, afterDeal: false }), false);
  ad = interstitialShown(ad, t);
  assert.equal(interstitialAllowed(ad, t + 179_000, cfg, ok), false);
  assert.equal(interstitialAllowed(ad, t + 180_000, cfg, ok), true);
});

// ---------- гараж ----------
function carWith(foundIds, seed = 5) {
  const ref = { seed, tutorial: true };
  const listing = listingFromRef(ctx, ref);
  const { garage, car } = G.parkCar(G.newGarage(), { ref, listing, paid: 115000, found: foundIds, now: 0 });
  return { garage, car, listing };
}

test('слоты по капиталу: 1, затем 2 при 400 000; в MVP не больше двух', () => {
  assert.equal(G.slotsFor(200000, cfg), 1);
  assert.equal(G.slotsFor(400000, cfg), 2);
  assert.equal(G.slotsFor(5_000_000, cfg), 2);
  const { garage } = carWith([]);
  assert.equal(G.freeSlots(garage, G.capitalOf(85000, garage), cfg), 0, 'гараж занят');
  assert.equal(G.capitalOf(85000, garage), 200000, 'капитал = деньги + цена покупки');
});

test('ремонт: дефекты идут параллельно, у каждого свой таймер, считаем от меток', () => {
  const { car, listing } = carWith(['oil_leak', 'sill_rust', 'many_owners']);
  assert.deepEqual(G.repairableDefects(ctx, car).sort(), ['oil_leak', 'sill_rust'], 'неустранимое не чинится');
  const t0 = 1000;
  const scale = cfg.repair.timeScale; // ремонт сокращён: часы из таблицы дефектов × timeScale
  const T = 3 * HOUR * scale;
  const r = G.startRepairs(ctx, car, listing, ['oil_leak', 'sill_rust'], t0, 100000);
  assert.equal(r.cost, G.repairCostRub(ctx, listing, 'oil_leak') + G.repairCostRub(ctx, listing, 'sill_rust'));
  assert.equal(G.repairCostRub(ctx, listing, 'oil_leak'), 2100, '1,5% от 143 000');
  assert.equal(r.car.repairing.oil_leak.endAt, t0 + T);
  assert.equal(r.car.repairing.sill_rust.endAt, t0 + T);
  assert.equal(G.tickRepairs(r.car, t0 + T - 1).repaired.length, 0);
  const done = G.tickRepairs(r.car, t0 + T);
  assert.deepEqual(done.repaired.sort(), ['oil_leak', 'sill_rust']);
  assert.equal(G.repairsRunning(done), 0);
  assert.equal(G.startRepairs(ctx, car, listing, ['oil_leak'], t0, 10).error, 'money');
  assert.equal(G.startRepairs(ctx, done, listing, ['oil_leak'], t0, 10 ** 6).error, 'nothing', 'починенное не чинится дважды');
});

test('ускорение ремонта на 4 часа за рекламу, но не раньше «сейчас»', () => {
  const { car, listing } = carWith(['sill_rust', 'oil_leak']);
  const r = G.startRepairs(ctx, car, listing, ['sill_rust', 'oil_leak'], 0, 10 ** 6).car;
  const b = G.boostRepairs(r, 4 * HOUR, 1 * HOUR);
  assert.equal(b.repairing.sill_rust.endAt, 1 * HOUR, 'ремонт на 3 часа ускорен до «сейчас»');
});

test('продажа: множитель 1,15 с отчётом и 1,10 без, неустранимые и непочиненные снижают цену', () => {
  const { car, listing } = carWith(['oil_leak', 'sill_rust']);
  const v0 = listing.v0True; // 143 000
  const unfixable = 10 + 3; // скрутка 10% + много владельцев 3%
  const V = v0 * (1 - unfixable / 100);
  let base = G.salePriceBase(ctx, car, listing, false);
  const pen = Math.round((v0 * (3 + 4 + 1.5)) / 100 / 100) * 100;
  assert.ok(Math.abs(base - (1.1 * V - pen)) < 400, `без отчёта ${base}`);
  const rep = G.salePriceBase(ctx, car, listing, true);
  assert.ok(rep > base);
  // после ремонта двух дефектов штраф исчезает
  const fixed = { ...car, repaired: ['oil_leak', 'sill_rust'] };
  const afterFix = G.salePriceBase(ctx, fixed, listing, false);
  assert.ok(afterFix > base);
  // трещина лобового (1,5% = 2 100 ₽) в «найденных» не числится, но на машине есть и цену снижает
  assert.ok(Math.abs(afterFix - (1.1 * V - 2100)) < 400, `после ремонта: ${afterFix}`);
});

test('стратегии продажи: быстро −5% через 1 ч, рынок через 4 ч, дорого +7% через 10 ч и 40% без предложений', () => {
  const { car, listing } = carWith([]);
  const t0 = 5 * HOUR;
  const base = G.salePriceBase(ctx, car, listing, false);
  const fast = G.listForSale(ctx, car, listing, 'fast', false, t0, 1).sale;
  const market = G.listForSale(ctx, car, listing, 'market', false, t0, 1).sale;
  assert.equal(fast.offers[0].appearAt, t0 + 1 * HOUR);
  assert.equal(market.offers[0].appearAt, t0 + 4 * HOUR);
  assert.equal(fast.offers.length, 3);
  for (const o of market.offers) {
    assert.ok(Math.abs(o.price / base - 1) <= 0.0401 + 0.001, 'разброс ±4%');
    assert.equal(o.expireAt - o.appearAt, 24 * HOUR);
  }
  for (const o of fast.offers) assert.ok(Math.abs(o.price / (base * 0.95) - 1) <= 0.045);
  let none = 0;
  const N = 3000;
  for (let s = 0; s < N; s++) if (G.listForSale(ctx, car, listing, 'premium', false, t0, s).sale.noOffers) none++;
  assert.ok(Math.abs(none / N - 0.4) < 0.04, `без предложений ${none / N}`);
  const prem = G.listForSale(ctx, car, listing, 'premium', false, t0, 4).sale;
  if (!prem.noOffers) assert.equal(prem.offers[0].appearAt, t0 + 10 * HOUR);
});

test('предложения: появляются по времени, живут 24 часа, статусы продажи', () => {
  const { car, listing } = carWith([]);
  const t0 = 0;
  const c = G.listForSale(ctx, car, listing, 'market', false, t0, 2);
  assert.equal(G.saleStatus(c.sale, t0 + 1 * HOUR), 'waiting');
  assert.equal(G.visibleOffers(c.sale, t0 + 4 * HOUR).length, 1);
  assert.equal(G.visibleOffers(c.sale, t0 + 5 * HOUR).length, 3);
  assert.equal(G.saleStatus(c.sale, t0 + 5 * HOUR), 'offers');
  assert.equal(G.visibleOffers(c.sale, t0 + 4 * HOUR + 24 * HOUR).length, 2, 'первое протухло');
  assert.equal(G.saleStatus(c.sale, t0 + 100 * HOUR), 'expired');
  assert.equal(G.nextOfferAt(c.sale, t0 + 4 * HOUR), t0 + 4.5 * HOUR);
});

test('скупщик берёт ловушку за 62% V0; карточка сделки считает прибыль', () => {
  const { car, listing } = carWith([]);
  assert.equal(G.scrapperPrice(ctx, listing), Math.round((listing.v0True * 0.62) / 1000) * 1000);
  const card = G.dealCard({ ...car, repairSpent: 15000 }, 190000);
  assert.deepEqual(card, { name: car.name, paid: 115000, sold: 190000, repairs: 15000, profit: 60000 });
});
