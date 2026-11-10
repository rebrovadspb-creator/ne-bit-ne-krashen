// Симуляция экономики: N прогонов по D дней, три профиля игрока.
// Запуск: node tools/simulate.js [прогонов=200] [дней=60]
// Считает маржу сделок (прибыль / цена покупки) и день, когда капитал дошёл до 350 000
// (открытие 2-го сегмента). Баланс правится в data/config.json (коэффициенты 1,05 и 1,15, уступчивость продавцов).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCtx, DATA_FILES } from '../js/data.js';
import { deepMerge } from '../js/config.js';
import { mulberry32, shuffle } from '../js/rng.js';
import { listingFromEntry, buildFeed, updateHistory } from '../js/feed.js';
import { listingFromRef } from '../js/listing.js';
import { newInspection, inspectZone, inspectRow, useProbeika, bargainCards } from '../js/inspection-core.js';
import { startBargain, playCard, finalPrice, buy } from '../js/bargain.js';
import * as G from '../js/garage.js';
import { repLevel, probeikaDailyAllowance } from '../js/economy.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const raw = {};
for (const n of DATA_FILES) raw[n] = JSON.parse(readFileSync(`${root}data/${n}.json`, 'utf8'));
// Подстановка параметров для подбора баланса: node tools/simulate.js 100 60 '{"economy":{"saleMultiplierReport":1.2}}'
const override = process.argv[4] ? JSON.parse(process.argv[4]) : null;
if (override) raw.config = deepMerge(raw.config, override);
if (override?.sellers) override.sellers.forEach((o) => Object.assign(raw.sellers.find((x) => x.id === o.id), o));
const ctx = buildCtx(raw);
const cfg = ctx.config;
const REPAIR_POLICY = process.env.REPAIR ?? 'all'; // all | none
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
// Часы заходов в игру в течение дня (число заходов: SESSIONS=1..4). Покупка раз в день в 13:00, ремонты и продажа проверяются при каждом заходе.
const SESSION_HOURS = { 1: [], 2: [19], 3: [9, 19], 4: [9, 16, 21] }[Number(process.env.SESSIONS ?? 3)] ?? [9, 19];

export const PROFILES = {
  novice: { label: 'Новичок', find: 0.5, play: 0.5, probeika: 0, threshold: -0.02 },
  medium: { label: 'Средний', find: 0.75, play: 0.7, probeika: 0.5, threshold: 0.03 },
  pro: { label: 'Профи', find: 0.95, play: 1, probeika: 1, threshold: 0.05 },
};

function dayKeyOf(day) {
  return new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
}

/** Игрок тапает по зонам и строкам документов; каждую находку замечает с вероятностью profile.find. */
function inspect(listing, profile, rng, wantProbeika) {
  let insp = newInspection(cfg);
  for (const view of ['exterior', 'interior']) {
    for (const zoneId of Object.keys(listing.zones[view])) {
      if (rng() < profile.find) insp = inspectZone(insp, ctx, listing, view, zoneId).state;
    }
  }
  for (const [docId, doc] of Object.entries(listing.docs)) {
    for (const row of doc.rows) if (!row.info && rng() < profile.find) insp = inspectRow(insp, ctx, listing, docId, row.id).state;
  }
  if (wantProbeika) insp = useProbeika(insp, ctx, listing).state;
  return insp;
}

function estimate(listing, insp, price) {
  const eco = cfg.economy;
  const v0 = listing.ask / eco.askMultiplier;
  let unfixable = 0;
  let repair = 0;
  for (const id of Object.keys(insp.found)) {
    const d = ctx.defectById[id];
    if (d.type === 'unfixable') unfixable += d.bargainPct;
    if (d.type === 'fixable') repair += (d.repairPct / 100) * v0;
  }
  const mult = insp.probeikaUsed ? eco.saleMultiplierReport : eco.saleMultiplierNoReport;
  return (mult * v0 * (1 - unfixable / 100) - price - repair) / price;
}

function runOne(profile, seed, days) {
  const rng = mulberry32(seed);
  let money = cfg.economy.startMoney;
  let garage = G.newGarage();
  let history = {};
  let lastRareDay = -999;
  let repXp = 0;
  let tokens = 1;
  let feed = null;
  let reach350 = null;
  const taken = new Set();
  const deals = [];
  const stats = { inspections: 0, bought: 0, traps: 0 };

  // гараж: ремонты, продажа. Игрок заходит несколько раз в день (SESSIONS), как в настоящей игре
  const garageStep = (now, day) => {
    for (const car0 of garage.cars) {
      let car = G.tickRepairs(car0, now);
      const listing = listingFromRef(ctx, car.ref);
      if (G.repairsRunning(car) === 0 && !car.sale) {
        if (car.trap) {
          money += G.scrapperPrice(ctx, listing);
          deals.push({ margin: (G.scrapperPrice(ctx, listing) - car.paid - car.repairSpent) / car.paid, trap: true });
          garage = G.removeCar(garage, car.id);
          continue;
        }
        car = G.listForSale(ctx, car, listing, 'market', Boolean(car.usedReport), now, seed * 1000 + day);
      }
      const offers = G.visibleOffers(car.sale, now);
      if (offers.length) {
        const best = offers.reduce((a, b) => (b.price > a.price ? b : a));
        money += best.price;
        const card = G.dealCard(car, best.price);
        deals.push({ margin: card.profit / card.paid, trap: false });
        if (car.usedReport) repXp += cfg.reputation.saleReport;
        garage = G.removeCar(garage, car.id);
      } else {
        garage = G.replaceCar(garage, car);
      }
    }
  };

  for (let day = 0; day < days; day++) {
    const now = day * DAY + 13 * HOUR;
    const level = repLevel(repXp, cfg.reputation);
    tokens = Math.max(tokens, probeikaDailyAllowance(level, cfg.probeika));

    for (const h of SESSION_HOURS.filter((x) => x < 13)) garageStep(day * DAY + h * HOUR, day);
    garageStep(now, day);
    for (const h of SESSION_HOURS.filter((x) => x > 13)) garageStep(day * DAY + h * HOUR, day);

    // 2. новая лента на сутки
    const capital = G.capitalOf(money, garage);
    if (capital >= 350000 && reach350 === null) reach350 = day;
    feed = buildFeed(ctx, { dayKey: dayKeyOf(day), playerSeed: seed, capital, rep: level, history, lastRareDay, refreshN: 0 });
    ({ history, lastRareDay } = updateHistory(ctx, history, feed, lastRareDay));

    // 3. осмотры (до 3 в день), если есть свободный слот
    if (G.freeSlots(garage, capital, cfg) <= 0) continue;
    const candidates = shuffle(rng, feed.entries).filter((e) => listingFromEntry(ctx, e).ask <= money).slice(0, cfg.inspections.perDay);
    const options = [];
    for (const entry of candidates) {
      const listing = listingFromEntry(ctx, entry);
      const seller = ctx.sellerById[listing.sellerId];
      const wantProbeika = tokens > 0 && rng() < profile.probeika;
      if (wantProbeika) tokens -= 1;
      stats.inspections += 1;
      const insp = inspect(listing, profile, rng, wantProbeika);
      if (insp.trapDetected) continue;
      let b = startBargain(listing, seller);
      const cards = bargainCards(insp, ctx, listing);
      const n = Math.ceil(cards.length * profile.play);
      for (const c of cards.slice(0, n)) {
        if (b.status !== 'active') break;
        b = playCard(b, c, seller, rng).state;
      }
      if (b.status === 'seller_left') continue;
      const price = finalPrice(b, seller, cfg);
      if (price > money) continue;
      options.push({ entry, listing, insp, bargain: b, seller, price, est: estimate(listing, insp, price) });
    }
    options.sort((a, b) => b.est - a.est);
    const pick = options[0];
    if (!pick || pick.est < profile.threshold) continue;

    // 4. покупка и ремонт найденного
    const r = buy(pick.bargain, pick.seller, money, cfg);
    if (!r.ok) continue;
    money -= r.price;
    stats.bought += 1;
    if (pick.listing.trap) stats.traps += 1;
    const ref = { seed: pick.entry.seed, rep: pick.entry.rep, seg: pick.entry.seg, rar: pick.entry.rar };
    let { garage: g2, car } = G.parkCar(garage, { ref, listing: pick.listing, paid: r.price, found: Object.keys(pick.insp.found), now });
    car = { ...car, usedReport: pick.insp.probeikaUsed };
    const rep = REPAIR_POLICY === 'none' ? {} : G.startRepairs(ctx, car, pick.listing, G.repairableDefects(ctx, car), now, money);
    if (rep.car) {
      car = { ...rep.car, usedReport: car.usedReport };
      money -= rep.cost;
    }
    garage = G.replaceCar(g2, car);
    repXp += cfg.reputation.deal;
  }
  return { deals, reach350, finalCapital: G.capitalOf(money, garage), stats };
}

export function simulate(runs = 200, days = 60) {
  const result = {};
  for (const [id, profile] of Object.entries(PROFILES)) {
    const margins = [];
    const reach = [];
    const capitals = [];
    let dealsTotal = 0;
    let trapsBought = 0;
    for (let r = 0; r < runs; r++) {
      const res = runOne(profile, 1000 + r, days);
      const own = res.deals.filter((d) => !d.trap).map((d) => d.margin);
      if (own.length) margins.push(own.reduce((a, b) => a + b, 0) / own.length);
      if (res.reach350 !== null) reach.push(res.reach350);
      capitals.push(res.finalCapital);
      dealsTotal += res.deals.length;
      trapsBought += res.stats.traps;
    }
    reach.sort((a, b) => a - b);
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    result[id] = {
      profile: profile.label,
      avgMarginPct: Math.round(mean(margins) * 1000) / 10,
      day350kMedian: reach.length ? reach[Math.floor(reach.length / 2)] : null,
      reached350kPct: Math.round((reach.length / runs) * 100),
      capitalDay60: Math.round(mean(capitals)),
      dealsPerRun: Math.round((dealsTotal / runs) * 10) / 10,
      trapsPerRun: Math.round((trapsBought / runs) * 100) / 100,
    };
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runs = Number(process.argv[2] ?? 200);
  const days = Number(process.argv[3] ?? 60);
  console.log(`Симуляция: ${runs} прогонов × ${days} дней`);
  console.table(simulate(runs, days));
}
