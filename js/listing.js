// Генератор объявлений. Чистая функция: на входе данные и ГСЧ, на выходе JSON-объект.
// Документы, зоны и улики собираются под находки, чтобы всё сходилось между собой
// (например, при скрутке пробега в книжке ТО на пробеге больше, чем на одометре).

import { randInt, pick, pickWeighted, shuffle, mulberry32 } from './rng.js';
import { roundTo, generateV0, askPrice, fmtKm } from './economy.js';

const PART_GEN = { hood: 'капота', fender: 'крыла', door: 'двери' };
const VIN_CHARS = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';
// Вымышленный VIN: префикс Z7N не принадлежит реальным производителям.
const VIN_PREFIX = 'Z7N';

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few;
  return many;
}

function indexById(list) {
  const map = {};
  for (const x of list) map[x.id] = x;
  return map;
}

export function generateListing(ctx, rng, opts = {}) {
  const { models, defects, schemes, sellers, config, texts } = ctx;
  const eco = config.economy;
  const defectById = ctx.defectById ?? indexById(defects);
  const sellerById = ctx.sellerById ?? indexById(sellers);
  const modelById = ctx.modelById ?? indexById(models);
  const forced = opts.forced ?? null;
  const rep = opts.rep ?? 0;

  // --- продавец и модель ---
  const sellerPool = sellers.filter((s) => (s.minRep ?? 0) <= rep);
  const seller = forced?.sellerId
    ? sellerById[forced.sellerId]
    : pickWeighted(rng, sellerPool, (s) => s.share);
  // --- модель и редкость ---
  let model;
  let rarity = 'common';
  if (forced?.modelId) {
    model = modelById[forced.modelId];
    rarity = model.rarity ?? 'common';
  } else {
    const inSegment = (opts.models ?? models).filter((m) => !opts.segments || opts.segments.includes(m.segment));
    const pool = inSegment.length ? inSegment : models;
    const collectors = pool.filter((m) => m.rarity === 'collector');
    const commons = pool.filter((m) => !m.rarity);
    const wanted = opts.rarity ?? rollRarity(rng, config.rarity);
    if ((wanted === 'collector' || wanted === 'any_rare') && collectors.length && (wanted === 'collector' || rng() < 0.25)) {
      model = pick(rng, collectors);
      rarity = 'collector';
    } else {
      model = pick(rng, commons.length ? commons : pool);
      rarity = wanted === 'rare' || wanted === 'any_rare' || wanted === 'legendary' || wanted === 'collector' ? 'rare' : 'common';
    }
  }
  const valueBonus = config.rarity?.[rarity]?.valueBonus ?? 0;

  const v0 = forced?.v0 ?? generateV0(rng, model, eco);
  // Продавец редкой машины просит цену обычной: настоящая стоимость выше на valueBonus.
  const v0True = roundTo(v0 * (1 + valueBonus), eco.priceRoundStep);
  const ask = askPrice(v0, seller, eco);
  const year = forced?.year ?? randInt(rng, model.years[0], model.years[1]);
  const age = Math.max(1, config.gameYear - year);
  const color = forced?.color ?? pick(rng, model.colors);

  // --- ловушка и схема ---
  let trapKind = null;
  if (forced && 'trap' in forced) {
    trapKind = forced.trap;
  } else if (!seller.noTraps && !forced?.noTrap) {
    const p = seller.trapChance ?? eco.trapChance;
    if (rng() < p) trapKind = pick(rng, ['drowned', 'pledge', 'wanted']);
  }
  let schemeId = null;
  if (forced && 'scheme' in forced) schemeId = forced.scheme;
  else if (trapKind === 'drowned') schemeId = 'drowned';
  else if (rng() < (seller.schemeChance ?? eco.schemeChance)) {
    const pool = schemes.filter((s) => s.id !== 'drowned');
    const picked = pickWeighted(rng, pool, (s) => seller.schemeWeights?.[s.id] ?? 1);
    schemeId = picked ? picked.id : null;
  }

  // --- пробег ---
  let realMileage =
    forced?.realMileage ??
    roundTo(randInt(rng, model.mileage[0], model.mileage[1]) * (seller.mileageMultiplier ?? 1), 1000);
  const serviceAgo = forced ? 2 : randInt(rng, 1, 3);
  let rollbackKm = 0;

  // --- состояние сборки ---
  const free = {
    exterior: new Set(model.zones.map((z) => z.id)),
    interior: new Set((model.interiorZones ?? []).map((z) => z.id)),
  };
  const zones = { exterior: {}, interior: {} };
  const clues = {};
  const findings = [];
  const rows = { pts: {}, service: {}, odometer: {} };
  const extraServiceRows = [];

  const putZone = (view, zoneId, content) => {
    free[view].delete(zoneId);
    zones[view][zoneId] = { ...(zones[view][zoneId] ?? {}), ...content };
  };
  const addFinding = (defectId, place) => findings.push({ defectId, ...place });

  // --- схема ---
  if (schemeId === 'hidden_accident') {
    const cands = ['hood', 'fender', 'door'].filter((z) => free.exterior.has(z));
    if (!cands.length) schemeId = null;
  }
  if (schemeId === 'ex_taxi' && !(free.interior.has('seat') && free.interior.has('steering'))) schemeId = null;
  if (schemeId === 'drowned' && !free.interior.has('mat')) schemeId = null;
  if (!schemeId && trapKind === 'drowned') trapKind = null;

  let statedMileage = realMileage;
  let lastServiceKm;

  if (schemeId === 'mileage_rollback') {
    rollbackKm = forced?.rollbackKm ?? randInt(rng, 5, 14) * 5000;
    if (realMileage < rollbackKm + 30000) realMileage = rollbackKm + 30000 + randInt(rng, 0, 6) * 5000;
    statedMileage = realMileage - rollbackKm;
    // В учебном объявлении последнее ТО ровно на реальном пробеге (130 000 → 90 000).
    lastServiceKm = forced ? realMileage : realMileage - randInt(rng, 2, 8) * 1000;
    if (lastServiceKm <= statedMileage) lastServiceKm = statedMileage + 5000;
  } else {
    lastServiceKm = Math.max(5000, statedMileage - randInt(rng, 4, 15) * 1000);
  }
  const serviceText = `Последнее ТО: ${serviceAgo} ${plural(serviceAgo, 'год', 'года', 'лет')} назад, пробег ${fmtKm(lastServiceKm)}`;
  const odometerText = `На одометре сейчас: ${fmtKm(statedMileage)}`;

  if (schemeId === 'mileage_rollback') {
    clues.mr_service = { id: 'mr_service', schemeId, text: serviceText };
    clues.mr_odometer = { id: 'mr_odometer', schemeId, text: odometerText };
    rows.service.last_service = { clueId: 'mr_service' };
    rows.odometer.reading = { clueId: 'mr_odometer' };
    addFinding('odometer_rollback', { kind: 'scheme' });
  } else if (schemeId === 'ex_taxi') {
    clues.tx_seat = { id: 'tx_seat', schemeId, text: 'Затёртое сиденье водителя и руль: так не ездят в личной машине' };
    clues.tx_pts = { id: 'tx_pts', schemeId, text: 'Собственник по ПТС: юрлицо (такси / лизинг)' };
    putZone('interior', 'seat', { clueId: 'tx_seat' });
    putZone('interior', 'steering', { clueId: 'tx_seat' });
    rows.pts.owner_type = { clueId: 'tx_pts', value: 'Юридическое лицо (такси / лизинг)' };
    addFinding('ex_taxi', { kind: 'scheme' });
  } else if (schemeId === 'hidden_accident') {
    const part = pick(rng, ['hood', 'fender', 'door'].filter((z) => free.exterior.has(z)));
    clues.ha_shade = { id: 'ha_shade', schemeId, text: 'Деталь другого оттенка: её красили отдельно' };
    clues.ha_service = { id: 'ha_service', schemeId, text: `В книжке запись: замена ${PART_GEN[part]} после повреждения` };
    putZone('exterior', part, { defectId: 'shade_mismatch', clueId: 'ha_shade' });
    addFinding('shade_mismatch', { kind: 'zone', view: 'exterior', zoneId: part });
    extraServiceRows.push({ id: 'body_repair', label: 'Кузовной ремонт', value: `Замена ${PART_GEN[part]} после повреждения`, clueId: 'ha_service' });
    addFinding('serious_accident', { kind: 'scheme' });
  } else if (schemeId === 'drowned') {
    clues.dr_mat = { id: 'dr_mat', schemeId, text: 'Под ковриком ил и песок' };
    clues.dr_ecu = { id: 'dr_ecu', schemeId, text: 'В книжке: замена блока управления и проводки' };
    putZone('interior', 'mat', { clueId: 'dr_mat', decal: 'mud' });
    extraServiceRows.push({ id: 'ecu_swap', label: 'Электрика', value: 'Замена блока управления и проводки', clueId: 'dr_ecu' });
    addFinding('drowned', { kind: 'scheme' });
  }
  if ((trapKind === 'pledge' || trapKind === 'wanted') && !findings.some((f) => f.defectId === trapKind)) {
    addFinding(trapKind, { kind: 'probeika' });
  }

  // --- независимые находки ---
  const chosen = new Set(findings.map((f) => f.defectId));

  const canPlace = (def) => {
    if (def.foundBy.includes('zone')) return def.zones.some((z) => free.exterior.has(z));
    if (def.foundBy.includes('interior')) return def.zones.some((z) => free.interior.has(z));
    if (def.foundBy.includes('document')) return !rows[def.doc.doc][def.doc.row];
    return false;
  };

  const tryPlace = (def) => {
    if (!canPlace(def)) return false;
    if (def.foundBy.includes('zone')) {
      const z = pick(rng, def.zones.filter((id) => free.exterior.has(id)));
      putZone('exterior', z, { defectId: def.id });
      addFinding(def.id, { kind: 'zone', view: 'exterior', zoneId: z });
    } else if (def.foundBy.includes('interior')) {
      const z = pick(rng, def.zones.filter((id) => free.interior.has(id)));
      putZone('interior', z, { defectId: def.id });
      addFinding(def.id, { kind: 'zone', view: 'interior', zoneId: z });
    } else {
      let value;
      if (def.id === 'many_owners') {
        const n = forced?.manyOwners?.n ?? randInt(rng, 4, 6);
        const years = forced?.manyOwners?.years ?? randInt(rng, 2, 4);
        value = `${n} ${plural(n, 'владелец', 'владельца', 'владельцев')} за ${years} ${plural(years, 'год', 'года', 'лет')}`;
      } else if (def.id === 'duplicate_pts') {
        value = 'Дубликат ПТС вместо оригинала';
      } else {
        value = def.name;
      }
      rows[def.doc.doc][def.doc.row] = { defectId: def.id, value };
      addFinding(def.id, { kind: 'document', doc: def.doc.doc, row: def.doc.row });
    }
    chosen.add(def.id);
    return true;
  };

  if (forced?.defects) {
    for (const id of forced.defects) {
      const def = defectById[id];
      if (def && !chosen.has(id)) tryPlace(def);
    }
  } else {
    const target = randInt(rng, eco.findingsMin, eco.findingsMax);
    let argSum = findings.reduce((s, f) => s + defectById[f.defectId].bargainPct, 0);
    const pool = defects.filter(
      (d) => d.type !== 'trap' && d.foundBy.some((m) => m === 'zone' || m === 'interior' || m === 'document'),
    );
    while (findings.length < target) {
      const avail = pool.filter((d) => !chosen.has(d.id) && argSum + d.bargainPct <= eco.maxArgSumPct && canPlace(d));
      if (!avail.length) break;
      const def = pickWeighted(rng, avail, (d) => d.weight ?? 1);
      if (!def) break;
      if (tryPlace(def)) argSum += def.bargainPct;
      else chosen.add(def.id);
    }
  }

  // --- документы ---
  const row = (id, label, normalValue, ov) => ({
    id,
    label,
    value: ov?.value ?? normalValue,
    defectId: ov?.defectId ?? null,
    clueId: ov?.clueId ?? null,
    info: false,
  });

  const vin = VIN_PREFIX + Array.from({ length: 14 }, () => VIN_CHARS[Math.floor(rng() * VIN_CHARS.length)]).join('');
  const normalOwners = randInt(rng, 1, 3);
  const ownersNormal =
    normalOwners === 1
      ? '1 владелец'
      : `${normalOwners} ${plural(normalOwners, 'владелец', 'владельца', 'владельцев')} за ${age} ${plural(age, 'год', 'года', 'лет')}`;

  const lastYear = config.gameYear - serviceAgo;
  const to2 = Math.max(8000, lastServiceKm - randInt(rng, 14, 26) * 1000);
  const to1 = Math.max(3000, to2 - randInt(rng, 12, 22) * 1000);
  const serviceRows = [
    row('to_1', `${Math.max(year, lastYear - 2)} · ТО-1`, `${fmtKm(to1)}, замена масла и фильтров`, rows.service.to_1),
    row('to_2', `${Math.max(year, lastYear - 1)} · ТО-2`, `${fmtKm(to2)}, замена масла, колодки`, rows.service.to_2),
  ];
  for (const ex of extraServiceRows) serviceRows.push(row(ex.id, ex.label, ex.value, ex));
  serviceRows.push(row('last_service', 'Последняя запись', serviceText, rows.service.last_service));

  const docs = {
    pts: {
      title: 'ПТС',
      rows: [
        { id: 'vin', label: 'VIN', value: vin, defectId: null, clueId: null, info: true },
        row('owners', 'Владельцы', ownersNormal, rows.pts.owners),
        row('type', 'Тип документа', 'Оригинал', rows.pts.type),
        row('owner_type', 'Текущий собственник', 'Физическое лицо', rows.pts.owner_type),
      ],
    },
    service: { title: 'Сервисная книжка', rows: serviceRows },
    odometer: { title: 'Одометр', rows: [row('reading', 'Показания одометра', odometerText, rows.odometer.reading)] },
  };

  // --- текст объявления ---
  let text = forced?.adText ?? pick(rng, texts.ads[seller.id] ?? texts.ads.ded);
  let adNote = null;
  if (seller.honestAd && !forced) {
    const noted = findings.map((f) => defectById[f.defectId]).filter((d) => d.adNote);
    if (noted.length) {
      adNote = pick(rng, noted).adNote;
      text += ` Честно: ${adNote}.`;
    }
  }
  const disclosed =
    seller.id === 'salon'
      ? findings.filter((f) => f.kind !== 'scheme' && f.kind !== 'probeika').map((f) => f.defectId)
      : [];

  return {
    modelId: model.id,
    modelName: model.name,
    year,
    color,
    v0,
    ask,
    sellerId: seller.id,
    rarity,
    valueBonus,
    v0True,
    realMileage,
    statedMileage,
    rollbackKm,
    text,
    adNote,
    disclosed,
    trap: schemeId === 'drowned' ? 'drowned' : trapKind,
    schemeId,
    findings,
    zones,
    clues,
    docs,
    vin,
    tutorial: Boolean(forced),
  };
}

/** Бросок редкости: легендарная 0,5%, коллекционная 2%, редкая 8%, иначе обычная. */
export function rollRarity(rng, rarCfg) {
  const r = rng();
  const leg = rarCfg.legendary.chance;
  const col = leg + rarCfg.collector.chance;
  const rare = col + rarCfg.rare.chance;
  if (r < leg) return 'legendary';
  if (r < col) return 'collector';
  if (r < rare) return 'rare';
  return 'common';
}

/** Ключ комбинации (модель, продавец, схема, набор находок) для правила «не чаще раза в 30 дней». */
export function listingKey(listing) {
  const raw = `${listing.modelId}|${listing.sellerId}|${listing.schemeId ?? '-'}|${listing.findings.map((f) => f.defectId).sort().join(',')}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Порядок документов на полке. */
export const DOC_ORDER = ['pts', 'service', 'odometer'];

/** Сколько всего находок в объявлении (для обучения и стенда диагностики). */
export function totalFindings(listing) {
  return listing.findings.length;
}

/**
 * Объявление по ссылке-источнику {seed, rep, seg, rar} (так хранятся объявления в ленте и гараже).
 * {tutorial: true} даёт учебное объявление. В сохранении лежит только ссылка, не всё объявление.
 */
export function listingFromRef(ctx, ref) {
  if (ref.tutorial) return generateListing(ctx, mulberry32(ref.seed), { forced: ctx.tutorial });
  return generateListing(ctx, mulberry32(ref.seed), { rep: ref.rep, segments: ref.seg, rarity: ref.rar ?? undefined });
}
