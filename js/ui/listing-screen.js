// Экран объявления: что видит игрок до осмотра.

import { h } from './dom.js';
import { fmtRub, fmtKm } from '../economy.js';
import { carImg, portrait, palych } from './art.js';

export function mountListing(host, env) {
  const { ctx, listing, tutorial } = env;
  const model = ctx.modelById[listing.modelId];
  const seller = ctx.sellerById[listing.sellerId];

  const card = h('div', { class: 'lcard' },
    h('div', { class: 'photo' }, carImg(model, listing, 'main')),
    h('h2', {}, `${listing.modelName}, ${listing.year}`, listing.rarity !== 'common' ? h('span', { class: 'tag', text: '★ редкая' }) : null),
    h('div', { class: 'facts' },
      h('span', { class: 'fact', text: `Пробег: ${fmtKm(listing.statedMileage)}` }),
      h('span', { class: 'fact', text: listing.color }),
      h('span', { class: 'fact', text: model.epoch === 'soviet' ? 'Отечественная' : 'Иномарка' })),
    h('div', { class: 'price', text: fmtRub(listing.ask) }),
    h('div', { class: 'quote', text: `«${listing.text}»` }),
    h('div', { class: 'seller' },
      portrait(seller.id, 'neutral', 52),
      h('div', {}, h('b', { text: seller.name }), seller.trait)),
    listing.disclosed.length
      ? h('div', { class: 'disclosed', text: 'В объявлении указано: ' + listing.disclosed.map((id) => ctx.defectById[id].name.toLowerCase()).join(', ') })
      : null);

  const full = env.garageFull;
  const go = h('button', { class: 'btn', disabled: full, text: full ? 'Гараж полон: освободите место' : `Осмотреть (${Math.round(ctx.config.inspection.durationSec / 60)} мин)`, onClick: () => env.onStart() });
  const root = h('section', { class: 'screen listing' },
    tutorial ? h('div', { class: 'banner pal' }, palych('explain', 56), h('div', {}, h('b', { text: 'Палыч: ' }), 'Первая машина на мне. Продавец просит чуть больше рынка, это нормально. Давай осмотрим и сбросим цену.')) : null,
    card,
    h('div', { class: 'stage' },
      go,
      env.onBack ? h('button', { class: 'btn secondary', style: { marginTop: '8px' }, text: '← К ленте', onClick: () => env.onBack() }) : null));
  host.append(root);
  return { destroy: () => root.remove() };
}
