import { readFileSync } from 'node:fs';
import { buildCtx, DATA_FILES } from '../js/data.js';

export function loadCtx() {
  const raw = {};
  for (const n of DATA_FILES) {
    raw[n] = JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf8'));
  }
  return buildCtx(raw);
}

/** ГСЧ, возвращающий заданную последовательность (для проверки веток торга). */
export function fixedRng(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
