// Сохранение v2. В сохранении лежат только сиды объявлений и метки времени, а не готовые объявления:
// так оно маленькое и влезает в лимиты облачного хранилища ВК (после сжатия в saveCodec.js).
// localStorage хранит то же самое как кэш; облако подключается через vk.js.

import { restoreLastSeen, nowMs, mskDayKey } from './clock.js';
import { probeikaDailyAllowance, repLevel } from './economy.js';
import { newInspections, syncInspections } from './limits.js';
import { newAdCounters } from './ads.js';
import { newGarage } from './garage.js';
import { encodeSave, decodeSave } from './saveCodec.js';
import { cloudSet } from './vk.js';

const PREFIX = 'nbnk2_';
const VERSION = 2;

export function defaultSave(config) {
  return {
    v: VERSION,
    playerSeed: (Math.random() * 4294967296) >>> 0,
    money: config.economy.startMoney,
    repXp: 0,
    tutorialDone: false,
    probeika: { tokens: config.probeika.freePerDay, dayKey: null },
    insp: newInspections(config),
    ad: newAdCounters(),
    feed: null,
    history: {},
    lastRareDay: -999,
    garage: newGarage(),
    segmentsSeen: ['buckets'],
    slotsSeen: 1,
    podrabotkaDay: null,
    settings: { sound: true },
    deals: [], // последние карточки сделок
    stats: { inspections: 0, purchases: 0, sales: 0, leaves: 0, schemes: 0, sessions: 0 },
    firstSessionAt: 0,
    lastSeen: 0,
  };
}

function readLocal() {
  try {
    const map = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(PREFIX)) map[k.slice(PREFIX.length)] = localStorage.getItem(k);
    }
    return decodeSave(map);
  } catch {
    return null;
  }
}

/** Выбрать сохранение: самое свежее из локального кэша и облака. Старый формат отбрасывается. */
export function loadSave(config, cloudMap = null) {
  const base = defaultSave(config);
  const candidates = [readLocal(), cloudMap ? decodeSave(cloudMap) : null].filter((s) => s && s.v === VERSION);
  candidates.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const raw = candidates[0];
  if (!raw) return base;
  const save = {
    ...base,
    ...raw,
    probeika: { ...base.probeika, ...raw.probeika },
    stats: { ...base.stats, ...raw.stats },
    settings: { ...base.settings, ...raw.settings },
    insp: { ...base.insp, ...raw.insp },
    ad: { ...base.ad, ...raw.ad },
    garage: { ...base.garage, ...raw.garage },
  };
  restoreLastSeen(save.lastSeen);
  return save;
}

let cloudTimer = null;

/** Записать локально сразу, а в облако с задержкой, чтобы не частить. */
export function persist(save) {
  save.lastSeen = nowMs();
  const map = encodeSave(save);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) {
        localStorage.removeItem(k);
        i--;
      }
    }
    for (const [k, v] of Object.entries(map)) localStorage.setItem(PREFIX + k, v);
  } catch {
    /* хранилище недоступно: играем без сохранения */
  }
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => cloudSet(map).catch(() => {}), 800);
}

export function resetSave() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('nbnk')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ничего */
  }
}

/** Начало сессии и новых суток: жетоны Пробейки и осмотры. Возвращает ключ суток по МСК. */
export function rollDay(save, config, now = nowMs()) {
  const key = mskDayKey(now);
  if (save.probeika.dayKey !== key) {
    const allowance = probeikaDailyAllowance(repLevel(save.repXp, config.reputation), config.probeika);
    save.probeika.tokens = Math.max(save.probeika.tokens, allowance);
    save.probeika.dayKey = key;
  }
  save.insp = syncInspections(save.insp, now, config);
  return key;
}
