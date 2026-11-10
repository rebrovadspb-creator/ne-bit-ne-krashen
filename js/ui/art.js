// Картинки машин. view: 'main' (3/4, для осмотра) или 'side' (профиль, для списков).
// Редкая версия модели (listing.rarity !== 'common') берёт свой арт, если он есть.
import { h } from './dom.js';

/** Картинка с повторной загрузкой: если сервер или сеть моргнули, пробуем ещё до трёх раз. */
function imgEl(props) {
  const el = h('img', props);
  let n = 0;
  el.addEventListener('error', () => {
    if (n >= 3) return;
    n += 1;
    setTimeout(() => { el.src = `${props.src}${props.src.includes('?') ? '&' : '?'}retry=${n}`; }, 400 * n);
  });
  return el;
}

/** Заранее подгрузить все картинки машин, фоны и персонажей, чтобы они не мигали и не терялись. */
export function preloadArt(ctx) {
  const urls = new Set();
  for (const m of ctx.models) for (const k of ['exterior', 'side', 'interior', 'rareExterior', 'rareSide']) if (m.art[k]) urls.add(m.art[k]);
  for (const n of ['yard', 'market', 'board', 'workshop', 'garages_open', 'pal_garage']) urls.add(`assets/bg/${n}.webp`);
  for (const sId of ['ded', 'family', 'taxi', 'perekup']) for (const mood of ['neutral', 'ok', 'no']) urls.add(`assets/chars/${sId}_${mood}.webp`);
  for (const mood of ['explain', 'good', 'shock', 'stop', 'laugh', 'sad']) urls.add(`assets/chars/pal_${mood}.webp`);
  for (const u of urls) {
    const im = new Image();
    im.onerror = () => setTimeout(() => { new Image().src = `${u}?retry=1`; }, 500);
    im.src = u;
  }
}

export function carSrc(model, listing, view = 'main') {
  const a = model.art;
  const rare = listing && listing.rarity !== 'common';
  if (view === 'side') return (rare && a.rareSide) || a.side || a.exterior;
  return (rare && a.rareExterior) || a.exterior;
}

export function carImg(model, listing, view = 'side', extra = {}) {
  return imgEl({ src: carSrc(model, listing, view), alt: '', draggable: 'false', ...extra });
}

/** Иконка из assets/ui (размер в пикселях). */
export function ico(name, size = 20, extra = {}) {
  return imgEl({ class: 'ico-img', src: `assets/ui/${name}.webp`, alt: '', draggable: 'false', width: size, height: size, ...extra });
}

const PORTRAITS = new Set(['ded', 'family', 'taxi', 'perekup']);

/** Портрет продавца: mood = neutral | ok | no. Для салона портрета нет, показываем значок. */
export function portrait(sellerId, mood = 'neutral', size = 64) {
  if (!PORTRAITS.has(sellerId)) return ico('tag', size);
  return imgEl({ class: 'portrait', src: `assets/chars/${sellerId}_${mood}.webp`, alt: '', draggable: 'false', width: size, height: size });
}

/** Палыч: explain | good | shock | stop | laugh | sad. */
export function palych(mood = 'explain', size = 64) {
  return imgEl({ class: 'portrait', src: `assets/chars/pal_${mood}.webp`, alt: '', draggable: 'false', width: size, height: size });
}

const DEFECT_ICONS = {
  windshield_crack: 'windshield', dent: 'door_dent', paint_chip: 'paint', bumper_damage: 'bumper', sill_rust: 'sill_rust',
  shade_mismatch: 'repaint', putty: 'repaint', serious_accident: 'crash', headlight_crack: 'headlight', stoplight_dead: 'stoplight',
  ecu_errors: 'engine', ac_dead: 'tip', oil_leak: 'oil', blue_smoke: 'exhaust', engine_knock: 'engine', gearbox_jerk: 'gear',
  odometer_rollback: 'odometer', bald_tires: 'tire', worn_discs: 'brakes', shocks_dead: 'spring', smoky_interior: 'ashtray',
  torn_seat: 'seat_torn', drowned: 'flood', many_owners: 'user', duplicate_pts: 'duplicate', ex_taxi: 'taxi_door', pledge: 'pledge', wanted: 'wanted',
};

/** Значок дефекта по его id. */
export function defectIcon(id, size = 24) {
  return ico(DEFECT_ICONS[id] ?? 'tip', size);
}

/** Значок сегмента: buckets | workhorses | dream | premium. */
export function segIcon(id, size = 28) {
  const n = { buckets: 'seg_buckets', workhorses: 'seg_horses', dream: 'seg_dream', premium: 'seg_premium' }[id] ?? 'seg_buckets';
  return ico(n, size);
}

/** Аватар покупателя (8 штук), выбирается по номеру. */
export function buyer(n, size = 40) {
  return imgEl({ class: 'portrait', src: `assets/chars/buyer${(Math.abs(n) % 8) + 1}.webp`, alt: '', draggable: 'false', width: size, height: size });
}
