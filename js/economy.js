// Экономика: цены, аргументы, репутация, жетоны. Чистые функции, без DOM.
// Все коэффициенты приходят из config.json.

import { randRange } from './rng.js';

export function roundTo(x, step) {
  return Math.round(x / step) * step;
}

/** Рыночная цена V0 = средняя цена модели × коэффициент 0,7–1,3. */
export function generateV0(rng, model, eco) {
  return roundTo(model.avgPrice * randRange(rng, eco.v0Min, eco.v0Max), eco.priceRoundStep);
}

/** Цена в объявлении: V0 × множитель продавца (по умолчанию 1,05). */
export function askPrice(v0, seller, eco) {
  const mult = seller?.askMultiplier ?? eco.askMultiplier;
  return roundTo(v0 * mult, eco.priceRoundStep);
}

/** Аргумент в торге в рублях: процент от V0. */
export function argumentRub(pct, v0, eco) {
  return roundTo((v0 * pct) / 100, eco.argRoundStep);
}

/** Формат рублей: 150 000 ₽ */
export function fmtRub(n) {
  const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return s + ' ₽';
}

export function fmtKm(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' км';
}

/** Уровень репутации по опыту: уровень N требует xpPerLevel × N опыта. */
export function repLevel(xp, repCfg) {
  let level = 0;
  let need = 0;
  while (level < repCfg.maxLevel) {
    need += repCfg.xpPerLevel * (level + 1);
    if (xp >= need) level++;
    else break;
  }
  return level;
}

/** Суточное число жетонов Пробейки: 1 бесплатный и бонусы за уровни репутации. */
export function probeikaDailyAllowance(level, cfg) {
  let n = cfg.freePerDay;
  for (const lvl of cfg.bonusAtRep) if (level >= lvl) n += 1;
  return n;
}
