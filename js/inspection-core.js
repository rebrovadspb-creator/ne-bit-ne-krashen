// Состояние осмотра: находки, улики, схемы, Пробейка, подсказки.
// Чистые функции без DOM: принимают состояние и возвращают {state, events}.
// Состояние: простой JSON-объект, его можно сохранять.

import { argumentRub } from './economy.js';
import { pick } from './rng.js';

export function newInspection(config) {
  return {
    found: {}, // defectId -> { via, special }
    clues: {}, // clueId -> true
    solved: {}, // schemeId -> true
    tappedZones: { exterior: {}, interior: {} },
    tappedRows: {}, // "doc.row" -> true
    probeikaUsed: false,
    hintsLeft: config.inspection.hintsPerInspection,
    trapDetected: null, // defectId ловушки, если найдена
  };
}

const defOf = (ctx, id) => ctx.defectById[id];
const rub = (ctx, listing, defectId) =>
  argumentRub(defOf(ctx, defectId).bargainPct, listing.v0, ctx.config.economy);

function markFound(s, ctx, listing, defectId, via, events, special = false) {
  if (s.found[defectId]) {
    if (special) s.found[defectId].special = true;
    return false;
  }
  s.found[defectId] = { via, special };
  const def = defOf(ctx, defectId);
  const isTrap = def.type === 'trap';
  if (isTrap) s.trapDetected = defectId;
  events.push({ type: 'defect', defectId, argRub: isTrap ? 0 : rub(ctx, listing, defectId), trap: isTrap, via });
  return true;
}

function checkSchemes(s, ctx, listing, events) {
  const id = listing.schemeId;
  if (!id || s.solved[id]) return;
  const scheme = ctx.schemeById[id];
  if (!scheme.clues.every((c) => s.clues[c])) return;
  s.solved[id] = true;
  const def = defOf(ctx, scheme.result);
  const wasFound = Boolean(s.found[scheme.result]);
  if (!wasFound) s.found[scheme.result] = { via: 'scheme', special: true };
  else s.found[scheme.result].special = true;
  if (def.type === 'trap') s.trapDetected = scheme.result;
  events.push({
    type: 'scheme',
    schemeId: id,
    defectId: scheme.result,
    argRub: def.type === 'trap' ? 0 : rub(ctx, listing, scheme.result),
    trap: def.type === 'trap',
  });
}

function applyContent(s, ctx, listing, content, via, events) {
  if (content.defectId) markFound(s, ctx, listing, content.defectId, via, events);
  if (content.clueId && !s.clues[content.clueId]) {
    s.clues[content.clueId] = true;
    events.push({ type: 'clue', clueId: content.clueId, text: listing.clues[content.clueId].text });
  }
  checkSchemes(s, ctx, listing, events);
}

/** Тап по зоне машины или салона. view: 'exterior' | 'interior'. */
export function inspectZone(state, ctx, listing, view, zoneId) {
  if (state.tappedZones[view][zoneId]) return { state, events: [{ type: 'repeat' }] };
  const s = structuredClone(state);
  s.tappedZones[view][zoneId] = true;
  const events = [];
  const content = listing.zones[view][zoneId];
  if (!content || (!content.defectId && !content.clueId)) {
    events.push({ type: 'nothing' });
    return { state: s, events };
  }
  applyContent(s, ctx, listing, content, view === 'interior' ? 'interior' : 'zone', events);
  return { state: s, events };
}

/** Тап по строке документа. */
export function inspectRow(state, ctx, listing, docId, rowId) {
  const key = `${docId}.${rowId}`;
  const row = listing.docs[docId].rows.find((r) => r.id === rowId);
  if (!row || row.info || state.tappedRows[key]) return { state, events: [{ type: 'repeat' }] };
  const s = structuredClone(state);
  s.tappedRows[key] = true;
  const events = [{ type: 'reveal', docId, rowId, value: row.value }];
  applyContent(s, ctx, listing, { defectId: row.defectId, clueId: row.clueId }, 'document', events);
  if (!row.defectId && !row.clueId) events.push({ type: 'nothing' });
  return { state: s, events };
}

/** Пробейка: показывает то, что находится по базам. Улик не требует, утопленника не видит. */
export function useProbeika(state, ctx, listing) {
  if (state.probeikaUsed) return { state, events: [] };
  const s = structuredClone(state);
  s.probeikaUsed = true;
  const events = [];
  for (const f of listing.findings) {
    const def = defOf(ctx, f.defectId);
    if (def.foundBy.includes('probeika')) markFound(s, ctx, listing, def.id, 'probeika', events);
  }
  return { state: s, events };
}

/** Строки отчёта Пробейки: что проверяли и что нашли. */
export function probeikaReport(ctx, listing) {
  const has = (id) => listing.findings.some((f) => f.defectId === id);
  return [
    { id: 'pledge', label: 'Залог у банка', hit: has('pledge'), text: has('pledge') ? 'Есть: машина в залоге' : 'Чисто' },
    { id: 'wanted', label: 'Розыск и ограничения', hit: has('wanted'), text: has('wanted') ? 'Есть: наложены ограничения' : 'Чисто' },
    { id: 'serious_accident', label: 'ДТП', hit: has('serious_accident'), text: has('serious_accident') ? 'Есть: серьёзное ДТП' : 'Серьёзных ДТП нет' },
    { id: 'ex_taxi', label: 'Такси', hit: has('ex_taxi'), text: has('ex_taxi') ? 'Есть: работала в такси' : 'В такси не работала' },
    {
      id: 'odometer_rollback',
      label: 'Пробег по записям',
      hit: has('odometer_rollback'),
      text: has('odometer_rollback')
        ? `По записям ${Math.round(listing.realMileage / 1000)} тыс. км, на одометре ${Math.round(listing.statedMileage / 1000)} тыс.`
        : 'Сходится с одометром',
    },
  ];
}

/** Выбрать цель подсказки: непроверенная зона с находкой или документ со строкой-находкой. */
export function pickHintTarget(state, listing, rng) {
  const targets = [];
  for (const view of ['exterior', 'interior']) {
    for (const [zoneId, c] of Object.entries(listing.zones[view])) {
      if ((c.defectId || c.clueId) && !state.tappedZones[view][zoneId]) targets.push({ kind: 'zone', view, id: zoneId });
    }
  }
  for (const [docId, doc] of Object.entries(listing.docs)) {
    const open = doc.rows.some((r) => !r.info && (r.defectId || r.clueId) && !state.tappedRows[`${docId}.${r.id}`]);
    if (open) targets.push({ kind: 'doc', id: docId });
  }
  return targets.length ? pick(rng, targets) : null;
}

export function useHint(state) {
  if (state.hintsLeft <= 0) return state;
  return { ...state, hintsLeft: state.hintsLeft - 1 };
}

export function foundCount(state) {
  return Object.keys(state.found).length;
}

/** Сумма аргументов в торге (рубли) по найденному. */
export function totalArgumentsRub(state, ctx, listing) {
  let sum = 0;
  for (const id of Object.keys(state.found)) {
    const def = defOf(ctx, id);
    if (def.type === 'trap') continue;
    sum += rub(ctx, listing, id);
  }
  return sum;
}

/** Карты для торга: каждая найденная не-ловушка. Раскрытая схема даёт особую карту. */
export function bargainCards(state, ctx, listing) {
  const cards = [];
  for (const [id, info] of Object.entries(state.found)) {
    const def = defOf(ctx, id);
    if (def.type === 'trap') continue;
    cards.push({ defectId: id, name: def.name, argRub: rub(ctx, listing, id), special: Boolean(info.special) });
  }
  cards.sort((a, b) => Number(b.special) - Number(a.special) || b.argRub - a.argRub);
  return cards;
}
