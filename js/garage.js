// Гараж: слоты, ремонт и продажа. Всё считается от меток времени (мс), а не от таймеров,
// поэтому состояние можно сохранить и продолжить после закрытия игры. Чистые функции без DOM.

import { argumentRub, roundTo } from './economy.js';
import { mulberry32 } from './rng.js';

const HOUR = 3600 * 1000;

export function newGarage() {
  return { cars: [], nextId: 1 };
}

/** Капитал = деньги + цена покупки машин в гараже. */
export function capitalOf(money, garage) {
  return money + garage.cars.reduce((s, c) => s + c.paid, 0);
}

export function slotsFor(capital, cfg) {
  let n = 0;
  for (const t of cfg.garage.slotCapitalThresholds) if (capital >= t) n += 1;
  return Math.min(n, cfg.garage.mvpMaxSlots);
}

export function freeSlots(garage, capital, cfg) {
  return Math.max(0, slotsFor(capital, cfg) - garage.cars.length);
}

/** Поставить купленную машину в гараж. ref — ссылка на объявление, found — найденные дефекты. */
export function parkCar(garage, { ref, listing, paid, found, now }) {
  const car = {
    id: garage.nextId,
    ref,
    name: `${listing.modelName}, ${listing.year}`,
    paid,
    boughtAt: now,
    found: [...found],
    repairing: {}, // defectId -> {startAt, endAt}
    repaired: [],
    repairSpent: 0,
    trap: listing.trap,
    sale: null,
  };
  return { garage: { cars: [...garage.cars, car], nextId: garage.nextId + 1 }, car };
}

export function replaceCar(garage, car) {
  return { ...garage, cars: garage.cars.map((c) => (c.id === car.id ? car : c)) };
}

export function removeCar(garage, carId) {
  return { ...garage, cars: garage.cars.filter((c) => c.id !== carId) };
}

// ---------------- ремонт ----------------

export function repairCostRub(ctx, listing, defectId) {
  const d = ctx.defectById[defectId];
  return argumentRub(d.repairPct, listing.v0True, ctx.config.economy);
}

/** Что можно чинить: найденные устранимые дефекты, которые ещё не починены и не в работе. */
export function repairableDefects(ctx, car) {
  return car.found.filter((id) => {
    const d = ctx.defectById[id];
    return d.type === 'fixable' && !car.repaired.includes(id) && !(id in car.repairing);
  });
}

/**
 * Запустить ремонты выбранных дефектов. Идут параллельно: у каждого свой таймер
 * (1, 3 или 8 часов по таблице). opts.durationMs и opts.cost нужны только для обучения.
 */
export function startRepairs(ctx, car, listing, defectIds, now, money, opts = {}) {
  const ok = new Set(repairableDefects(ctx, car));
  const ids = defectIds.filter((id) => ok.has(id));
  if (!ids.length) return { error: 'nothing' };
  const cost = opts.cost ?? ids.reduce((s, id) => s + repairCostRub(ctx, listing, id), 0);
  if (cost > money) return { error: 'money', cost };
  const c = structuredClone(car);
  for (const id of ids) {
    const d = ctx.defectById[id];
    c.repairing[id] = { startAt: now, endAt: now + (opts.durationMs ?? d.repairHours * HOUR * (ctx.config.repair?.timeScale ?? 1)) };
  }
  c.repairSpent += cost;
  return { car: c, cost };
}

/** Завершить ремонты, время которых вышло. */
export function tickRepairs(car, now) {
  const c = structuredClone(car);
  for (const [id, r] of Object.entries(c.repairing)) {
    if (r.endAt <= now) {
      c.repaired.push(id);
      delete c.repairing[id];
    }
  }
  return c;
}

/** Ускорение ремонтов на N миллисекунд (за рекламу). */
export function boostRepairs(car, ms, now) {
  const c = structuredClone(car);
  for (const r of Object.values(c.repairing)) r.endAt = Math.max(now, r.endAt - ms);
  return c;
}

export function repairsRunning(car) {
  return Object.keys(car.repairing).length;
}

export function nextRepairEnd(car) {
  const ends = Object.values(car.repairing).map((r) => r.endAt);
  return ends.length ? Math.min(...ends) : null;
}

// ---------------- продажа ----------------

/**
 * Базовая цена продажи. V = V0 × (1 − сумма неустранимых дефектов).
 * Непочиненный устранимый дефект снижает цену на свой аргумент.
 * Множитель 1,15 с отчётом Пробейки и 1,10 без него. V0 здесь настоящая стоимость (с бонусом редкости).
 */
export function salePriceBase(ctx, car, listing, usedReport) {
  const eco = ctx.config.economy;
  let unfixable = 0;
  let penalty = 0;
  for (const f of listing.findings) {
    const d = ctx.defectById[f.defectId];
    if (d.type === 'unfixable') unfixable += d.bargainPct;
    else if (d.type === 'fixable' && !car.repaired.includes(d.id)) penalty += argumentRub(d.bargainPct, listing.v0True, eco);
  }
  const V = listing.v0True * (1 - unfixable / 100);
  const mult = usedReport ? eco.saleMultiplierReport : eco.saleMultiplierNoReport;
  return Math.max(Math.round(listing.v0True * 0.2), mult * V - penalty);
}

/** Выставить на продажу. До 3 предложений с разбросом ±4%, каждое живёт 24 часа. */
export function listForSale(ctx, car, listing, strategyId, usedReport, now, seed) {
  const cfg = ctx.config;
  const eco = cfg.economy;
  const st = cfg.sale.strategies[strategyId];
  const base = salePriceBase(ctx, car, listing, usedReport) * (1 + st.mult);
  const rng = mulberry32(seed);
  const noOffers = rng() < st.noOfferChance;
  const offers = noOffers
    ? []
    : Array.from({ length: eco.maxOffers }, (_, i) => {
        const appearAt = now + (st.firstOfferHours + i * cfg.sale.offerGapHours) * HOUR;
        return {
          id: i,
          price: roundTo(base * (1 + (rng() * 2 - 1) * eco.offerSpread), eco.argRoundStep),
          appearAt,
          expireAt: appearAt + cfg.sale.offerLifeHours * HOUR,
        };
      });
  const c = structuredClone(car);
  c.sale = { strategy: strategyId, usedReport, listedAt: now, noOffers, offers };
  return c;
}

export function visibleOffers(sale, now) {
  if (!sale) return [];
  return sale.offers.filter((o) => o.appearAt <= now && now < o.expireAt);
}

/** waiting: ждём первое предложение; offers: есть; expired: все протухли; none: покупателей не нашлось. */
export function saleStatus(sale, now) {
  if (!sale) return 'none';
  if (sale.noOffers) return 'none';
  if (visibleOffers(sale, now).length) return 'offers';
  if (sale.offers.some((o) => o.appearAt > now)) return 'waiting';
  return 'expired';
}

export function nextOfferAt(sale, now) {
  if (!sale) return null;
  const next = sale.offers.filter((o) => o.appearAt > now).map((o) => o.appearAt);
  return next.length ? Math.min(...next) : null;
}

/** Снять с продажи (чтобы выставить заново с другой стратегией). */
export function cancelSale(car) {
  return { ...car, sale: null };
}

/** Скупщик берёт ловушку за 62% V0. */
export function scrapperPrice(ctx, listing) {
  const eco = ctx.config.economy;
  return roundTo(listing.v0True * eco.trapBuyerPct, eco.priceRoundStep);
}

/** Карточка сделки: «Взял за 115, продал за 190». */
export function dealCard(car, soldPrice) {
  return { name: car.name, paid: car.paid, sold: soldPrice, repairs: car.repairSpent, profit: soldPrice - car.paid - car.repairSpent };
}
