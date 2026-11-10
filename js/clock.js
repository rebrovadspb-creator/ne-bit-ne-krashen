// Время. Бэкенда в MVP нет, поэтому считаем от времени устройства
// с защитой от перевода часов назад: «сейчас» никогда не уменьшается.

const MSK_OFFSET_MS = 3 * 3600 * 1000;
let lastSeen = 0;

/** Восстановить последнюю известную метку времени из сохранения. */
export function restoreLastSeen(ts) {
  if (Number.isFinite(ts)) lastSeen = Math.max(lastSeen, ts);
}

/** Монотонное «сейчас» в миллисекундах. */
export function nowMs() {
  lastSeen = Math.max(lastSeen, Date.now());
  return lastSeen;
}

export function getLastSeen() {
  return lastSeen;
}

/** Ключ суток по Москве: «2026-11-06». Смена ключа происходит в 00:00 МСК. */
export function mskDayKey(ts) {
  return new Date(ts + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Сколько миллисекунд до ближайшей полуночи по Москве. */
export function msUntilMskMidnight(ts) {
  const d = new Date(ts + MSK_OFFSET_MS);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return next - (ts + MSK_OFFSET_MS);
}
