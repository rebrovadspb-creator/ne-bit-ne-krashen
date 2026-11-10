// Лимиты осмотров: максимум 3 в день, +1 каждые 4 часа, +2 в день за рекламу.
// Время считается от меток (миллисекунды), не от таймеров. Чистые функции.

const HOUR = 3600 * 1000;

export function newInspections(cfg) {
  return { n: cfg.inspections.perDay, regenAt: null, adDay: null, adUsed: 0 };
}

/** Начислить осмотры за прошедшее время. */
export function syncInspections(st, now, cfg) {
  const max = cfg.inspections.perDay;
  const regen = cfg.inspections.regenHours * HOUR;
  const s = { ...st };
  if (s.n >= max) {
    s.regenAt = null;
    return s;
  }
  if (s.regenAt == null) s.regenAt = now + regen;
  while (s.n < max && s.regenAt != null && s.regenAt <= now) {
    s.n += 1;
    s.regenAt = s.n < max ? s.regenAt + regen : null;
  }
  return s;
}

export function spendInspection(st, now, cfg) {
  if (st.n <= 0) return null;
  const s = { ...st, n: st.n - 1 };
  if (s.regenAt == null) s.regenAt = now + cfg.inspections.regenHours * HOUR;
  return s;
}

/** Осмотр за рекламу: до adPerDay в сутки. dayKey — сутки по МСК. */
export function addByAd(st, dayKey, cfg) {
  const s = { ...st };
  if (s.adDay !== dayKey) {
    s.adDay = dayKey;
    s.adUsed = 0;
  }
  if (s.adUsed >= cfg.inspections.adPerDay) return null;
  s.adUsed += 1;
  s.n += 1;
  return s;
}

export function msToNextInspection(st, now) {
  return st.regenAt == null ? 0 : Math.max(0, st.regenAt - now);
}
