// Лента объявлений: 5 объявлений в сутки по Москве + 1 «закрытое» из следующего сегмента.
// Лента воспроизводится из сидов (в сохранении лежат только сиды, не объявления целиком).
// Чистые функции без DOM.

import { mulberry32 } from './rng.js';
import { generateListing, listingKey, listingFromRef } from './listing.js';

export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Номер суток (целое) по ключу «2026-11-06». */
export function dayIndex(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Сегменты, открытые при данном капитале (и в которых есть модели). */
export function unlockedSegments(ctx, capital) {
  return ctx.config.segments
    .filter((s) => capital >= s.unlockCapital && ctx.models.some((m) => m.segment === s.id))
    .map((s) => s.id);
}

/** Ближайший закрытый сегмент с моделями, либо null. */
export function nextClosedSegment(ctx, capital) {
  return ctx.config.segments.find((s) => capital < s.unlockCapital && ctx.models.some((m) => m.segment === s.id)) ?? null;
}

export function listingFromEntry(ctx, entry) {
  return listingFromRef(ctx, entry);
}

/**
 * Собрать ленту на сутки.
 * input: { dayKey, playerSeed, capital, rep, history (ключ → номер суток), lastRareDay, refreshN }
 * Возвращает { dayKey, refreshN, entries, teaser, keys, hasRare }.
 */
export function buildFeed(ctx, input) {
  const cfg = ctx.config;
  const { dayKey, playerSeed, capital, rep, history = {}, lastRareDay = -999, refreshN = 0 } = input;
  const day = dayIndex(dayKey);
  const segs = unlockedSegments(ctx, capital);
  const rng = mulberry32(hash32(`${playerSeed}|${dayKey}|${refreshN}`));
  const needRare = day - lastRareDay >= cfg.rarity.guaranteeDays - 1;

  const entries = [];
  const keys = [];
  const used = new Set();
  let hasRare = false;
  let tries = 0;
  while (entries.length < cfg.feed.size) {
    const seed = Math.floor(rng() * 4294967296) >>> 0;
    const lastSlot = entries.length === cfg.feed.size - 1;
    const forceRare = needRare && !hasRare && lastSlot;
    const entry = { seed, rep, seg: segs, rar: forceRare ? 'any_rare' : null, st: 'new' };
    const listing = listingFromEntry(ctx, entry);
    const key = listingKey(listing);
    const recent = history[key] !== undefined && day - history[key] < cfg.feed.noRepeatDays;
    if ((recent || used.has(key)) && tries < 80) {
      tries++;
      continue;
    }
    used.add(key);
    keys.push(key);
    if (listing.rarity !== 'common') hasRare = true;
    entries.push(entry);
  }

  let teaser = null;
  const next = nextClosedSegment(ctx, capital);
  if (next) {
    const seed = Math.floor(rng() * 4294967296) >>> 0;
    teaser = { seed, rep, seg: [next.id], rar: null, st: 'locked', unlockCapital: next.unlockCapital, segmentName: next.name };
  }
  return { dayKey, refreshN, entries, teaser, keys, hasRare };
}

/** Запомнить показанные комбинации и день последней редкой машины; забыть старше noRepeatDays. */
export function updateHistory(ctx, history, feed, lastRareDay) {
  const day = dayIndex(feed.dayKey);
  const next = {};
  for (const [k, d] of Object.entries(history)) if (day - d < ctx.config.feed.noRepeatDays) next[k] = d;
  for (const k of feed.keys) next[k] = day;
  return { history: next, lastRareDay: feed.hasRare ? day : lastRareDay };
}
