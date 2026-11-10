// Загрузка данных игры из JSON и сборка контекста.
// buildCtx работает и в браузере, и в Node (для тестов): ему всё равно, откуда пришёл JSON.

import { REMOTE_CONFIG_URL, mergeConfig } from './config.js';

export const DATA_FILES = ['config', 'models', 'defects', 'schemes', 'sellers', 'texts', 'tutorial'];

function indexById(list) {
  const map = {};
  for (const x of list) map[x.id] = x;
  return map;
}

/** Сборка контекста из «сырых» JSON и проверка ссылок между ними. */
export function buildCtx(raw) {
  const ctx = {
    config: raw.config,
    models: raw.models,
    defects: raw.defects,
    schemes: raw.schemes,
    sellers: raw.sellers,
    texts: raw.texts,
    tutorial: raw.tutorial,
  };
  ctx.defectById = indexById(ctx.defects);
  ctx.modelById = indexById(ctx.models);
  ctx.schemeById = indexById(ctx.schemes);
  ctx.sellerById = indexById(ctx.sellers);
  validate(ctx);
  return ctx;
}

/** Все допустимые id зон. У конкретной модели части зон может не быть. */
export const ALL_EXTERIOR_ZONES = [
  'windshield', 'hood', 'bumper', 'headlight', 'fender', 'door',
  'sill', 'wheel_front', 'wheel_rear', 'stoplight', 'exhaust', 'under',
];
export const ALL_INTERIOR_ZONES = ['steering', 'pedals', 'seat', 'mat', 'ashtray'];

export function validate(ctx) {
  const errors = [];
  const known = new Set([...ALL_EXTERIOR_ZONES, ...ALL_INTERIOR_ZONES]);
  for (const s of ctx.schemes) {
    if (!ctx.defectById[s.result]) errors.push(`схема ${s.id}: нет дефекта ${s.result}`);
  }
  for (const d of ctx.defects) {
    for (const z of d.zones ?? []) if (!known.has(z)) errors.push(`дефект ${d.id}: неизвестная зона ${z}`);
  }
  for (const m of ctx.models) {
    for (const z of m.zones) if (!ALL_EXTERIOR_ZONES.includes(z.id)) errors.push(`модель ${m.id}: неизвестная зона ${z.id}`);
    for (const z of m.interiorZones ?? []) if (!ALL_INTERIOR_ZONES.includes(z.id)) errors.push(`модель ${m.id}: неизвестная зона салона ${z.id}`);
  }
  for (const sel of ctx.sellers) {
    if (!ctx.texts.ads[sel.id]) errors.push(`нет текстов объявлений для ${sel.id}`);
  }
  if (errors.length) throw new Error('Ошибки данных:\n' + errors.join('\n'));
}

/** Браузерная загрузка: config.json (с удалённым оверрайдом) и остальные файлы. */
export async function loadAll() {
  const get = async (name) => {
    const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Не удалось загрузить data/${name}.json`);
    return res.json();
  };
  const entries = await Promise.all(DATA_FILES.map(async (n) => [n, await get(n)]));
  const raw = Object.fromEntries(entries);
  raw.config = await mergeConfig(raw.config, REMOTE_CONFIG_URL);
  return buildCtx(raw);
}
