// «Итог покупки»: что нашли, что пропустили, что показала бы Пробейка.
// Чистая функция без DOM.

import { argumentRub } from './economy.js';

/**
 * outcome: { status: 'bought' | 'player_left' | 'seller_left' | 'trap_exit', price?: number }
 */
export function buildSummary(ctx, listing, insp, outcome) {
  const eco = ctx.config.economy;
  const found = [];
  const missed = [];
  const probeika = []; // не найдено, но Пробейка показала бы сразу

  for (const f of listing.findings) {
    const def = ctx.defectById[f.defectId];
    const argRub = def.type === 'trap' ? 0 : argumentRub(def.bargainPct, listing.v0, eco);
    const item = { defectId: def.id, name: def.name, argRub, type: def.type };
    if (insp.found[def.id]) found.push(item);
    else if (def.foundBy.includes('probeika')) probeika.push(item);
    else missed.push(item);
  }

  const bought = outcome.status === 'bought';
  const paid = bought ? outcome.price : null;
  const trapBought = bought && listing.trap ? listing.trap : null;
  const rollbackFound = Boolean(insp.found.odometer_rollback);

  return {
    found,
    missed,
    probeika,
    totalFoundRub: found.reduce((s, x) => s + x.argRub, 0),
    paid,
    ask: listing.ask,
    discount: bought ? listing.ask - paid : 0,
    marketPrice: listing.v0,
    trapBought,
    trapSalePrice: trapBought ? Math.round((listing.v0 * 0.62) / 1000) * 1000 : null,
    mileageConfirmedKm: rollbackFound && listing.rollbackKm ? listing.rollbackKm : null,
    probeikaUsed: insp.probeikaUsed,
  };
}
