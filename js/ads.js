// Политика рекламы. Показ идёт только по кнопке игрока (награда) либо в разрешённые моменты (межстраничная).
// Здесь только правила и счётчики; сам показ делает vk.js. Чистые функции.

/** Счётчики рекламы за сутки по МСК. */
export function newAdCounters() {
  return { dayKey: null, c: {}, lastInterAt: 0 };
}

function fresh(ad, dayKey) {
  return ad.dayKey === dayKey ? ad : { ...ad, dayKey, c: {} };
}

export function adRemaining(ad, placement, dayKey, cfg) {
  const limit = cfg.ads.placements[placement]?.limit ?? 0;
  return Math.max(0, limit - (fresh(ad, dayKey).c[placement] ?? 0));
}

export function adWatched(ad, placement, dayKey) {
  const a = fresh(ad, dayKey);
  return { ...a, c: { ...a.c, [placement]: (a.c[placement] ?? 0) + 1 } };
}

/**
 * Межстраничная реклама: только при загрузке следующего объявления после завершённой сделки,
 * не чаще раза в 3 минуты, не в обучении и не в первой сессии.
 */
export function interstitialAllowed(ad, now, cfg, { tutorial, firstSession, afterDeal }) {
  if (tutorial || firstSession || !afterDeal) return false;
  return now - ad.lastInterAt >= cfg.ads.interstitialMinGapSec * 1000;
}

export function interstitialShown(ad, now) {
  return { ...ad, lastInterAt: now };
}
