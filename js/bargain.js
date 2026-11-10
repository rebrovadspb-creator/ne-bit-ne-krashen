// Торг. Чистые функции без DOM. ГСЧ передаётся снаружи, поэтому всё воспроизводимо в тестах.
// Правила: продавец просит 1,05 × V0. Каждая найденная находка — карта.
// Обычную карту продавец принимает с вероятностью, равной его уступчивости.
// Принял: цена минус аргумент. Отказал: минус 1 терпение. Терпение кончилось: продавец уходит.
// Карта раскрытой схемы принимается всегда. Блеф: если находка есть, работает как обычная карта,
// если нет, минус 2 терпения (у деда 3, у перекупа блеф не работает вообще).

import { roundTo, argumentRub } from './economy.js';

export function startBargain(listing, seller) {
  return {
    sellerId: seller.id,
    ask: listing.ask,
    price: listing.ask,
    patience: seller.patience ?? 0,
    patienceMax: seller.patience ?? 0,
    noBargain: Boolean(seller.noBargain),
    played: [], // defectId сыгранных карт (включая отказы)
    accepted: 0,
    status: 'active', // active | bought | seller_left | player_left
    paid: null,
  };
}

function applyAccept(s, amount) {
  s.price = Math.max(0, s.price - amount);
  s.accepted += 1;
}

function applyRefuse(s, cost) {
  s.patience -= cost;
  if (s.patience <= 0) {
    s.patience = 0;
    s.status = 'seller_left';
  }
}

/** Сыграть карту найденной находки. card: {defectId, argRub, special}. */
export function playCard(state, card, seller, rng) {
  if (state.status !== 'active' || state.noBargain) return { state, result: { type: 'blocked' } };
  if (state.played.includes(card.defectId)) return { state, result: { type: 'already' } };
  const s = structuredClone(state);
  s.played.push(card.defectId);
  const ok = card.special || rng() < seller.yield;
  if (ok) {
    applyAccept(s, card.argRub);
    return { state: s, result: { type: 'accept', amount: card.argRub, special: Boolean(card.special) } };
  }
  applyRefuse(s, 1);
  return { state: s, result: { type: 'refuse', left: s.status === 'seller_left' } };
}

/**
 * Блеф: заявить находку без проверки.
 * existing — есть ли такая находка на машине (знает только игра, не игрок).
 */
export function bluff(state, defectId, existing, listing, ctx, seller, rng, config) {
  if (state.status !== 'active' || state.noBargain) return { state, result: { type: 'blocked' } };
  if (state.played.includes(defectId)) return { state, result: { type: 'already' } };
  const s = structuredClone(state);
  s.played.push(defectId);
  const failCost = seller.bluffPatienceCost ?? config.bargain.bluffFailPatience;
  if (seller.bluffAlwaysFails || !existing) {
    applyRefuse(s, failCost);
    return { state: s, result: { type: 'bluff_fail', cost: failCost, left: s.status === 'seller_left' } };
  }
  const amount = argumentRub(ctx.defectById[defectId].bargainPct, listing.v0, config.economy);
  if (rng() < seller.yield) {
    applyAccept(s, amount);
    return { state: s, result: { type: 'bluff_ok', amount } };
  }
  applyRefuse(s, 1);
  return { state: s, result: { type: 'refuse', left: s.status === 'seller_left' } };
}

/** Итоговая цена с бонусом семьи за быструю сделку. */
export function finalPrice(state, seller, config) {
  let price = state.price;
  const bonus = seller.fewCardsBonus;
  if (bonus && !state.noBargain && state.played.length <= bonus.maxCards) {
    price = price * (1 - bonus.pct / 100);
  }
  return roundTo(price, config.economy.argRoundStep);
}

export function buy(state, seller, money, config) {
  if (state.status !== 'active') return { state, ok: false, reason: 'closed' };
  const price = finalPrice(state, seller, config);
  if (money < price) return { state, ok: false, reason: 'money', price };
  const s = structuredClone(state);
  s.status = 'bought';
  s.paid = price;
  return { state: s, ok: true, price };
}

export function leave(state) {
  if (state.status !== 'active') return state;
  return { ...state, status: 'player_left' };
}

/**
 * Какие находки можно «заблефовать»: не ловушки, не только для инструментов, ещё не найденные,
 * и такие, которые вообще возможны у этой модели (например, нет зоны выхлопа: нет синего дыма).
 */
export function bluffOptions(ctx, inspection, model) {
  const have = new Set([...(model?.zones ?? []), ...(model?.interiorZones ?? [])].map((z) => z.id));
  return ctx.defects.filter(
    (d) =>
      d.type !== 'trap' &&
      !inspection.found[d.id] &&
      d.foundBy.some((m) => m === 'zone' || m === 'interior' || m === 'document' || m === 'scheme') &&
      (!model || !d.zones.length || d.zones.some((z) => have.has(z))),
  );
}
