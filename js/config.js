// Конфиг экономики. Базовый data/config.json лежит в сборке («вшитый»).
// Если задан удалённый адрес, поверх него накладывается свежий конфиг,
// так баланс можно менять без новой сборки. Если сеть недоступна, берём
// последний удачно полученный удалённый конфиг из кэша, а потом вшитый.

// Адрес удалённого config.json. Пока пусто: подключим перед модерацией.
export const REMOTE_CONFIG_URL = '';

const CACHE_KEY = 'nbnk_remote_config_v1';

export function deepMerge(base, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over)) {
    out[k] = k in out && typeof out[k] === 'object' && !Array.isArray(out[k]) ? deepMerge(out[k], over[k]) : over[k];
  }
  return out;
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function mergeConfig(bundled, remoteUrl) {
  if (!remoteUrl) return bundled;
  try {
    const remote = await fetchWithTimeout(remoteUrl, 2500);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(remote));
    } catch {
      /* кэш необязателен */
    }
    return deepMerge(bundled, remote);
  } catch {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached) return deepMerge(bundled, cached);
    } catch {
      /* пойдём на вшитый */
    }
    return bundled;
  }
}
