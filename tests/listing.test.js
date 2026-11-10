import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../js/rng.js';
import { generateListing } from '../js/listing.js';
import { loadCtx } from './helpers.js';

const ctx = loadCtx();
const SAMPLES = 3000;

function gen(seed, opts) {
  return generateListing(ctx, mulberry32(seed), opts);
}

function kmFrom(text) {
  const m = text.match(/пробег ([\d  ]+) ?км/);
  return parseInt(m[1].replace(/\D/g, ''), 10);
}

test('объявление воспроизводимо по сиду', () => {
  assert.deepEqual(gen(7), gen(7));
});

test('3–6 находок, зоны и находки согласованы', () => {
  for (let seed = 1; seed <= SAMPLES; seed++) {
    const l = gen(seed);
    assert.ok(l.findings.length >= 3 && l.findings.length <= 6, `seed ${seed}: находок ${l.findings.length}`);
    const ids = l.findings.map((f) => f.defectId);
    assert.equal(new Set(ids).size, ids.length, `seed ${seed}: дубликаты находок`);
    for (const f of l.findings) {
      const def = ctx.defectById[f.defectId];
      assert.ok(def, 'неизвестный дефект ' + f.defectId);
      assert.ok(!def.foundBy.every((m) => m === 'tool'), 'в MVP нет находок только для инструментов');
      if (f.kind === 'zone') {
        assert.equal(l.zones[f.view][f.zoneId].defectId, f.defectId);
        const model = ctx.modelById[l.modelId];
        const list = f.view === 'interior' ? model.interiorZones : model.zones;
        assert.ok(list.some((z) => z.id === f.zoneId), 'зоны нет у модели');
        assert.ok(def.zones.includes(f.zoneId));
      }
      if (f.kind === 'document') {
        const row = l.docs[f.doc].rows.find((r) => r.id === f.row);
        assert.equal(row.defectId, f.defectId);
      }
    }
  }
});

test('схема целиком достижима: обе улики лежат в зонах или строках документов', () => {
  let withScheme = 0;
  for (let seed = 1; seed <= SAMPLES; seed++) {
    const l = gen(seed);
    if (!l.schemeId) continue;
    withScheme++;
    const scheme = ctx.schemeById[l.schemeId];
    assert.equal(scheme.clues.length, 2);
    for (const clueId of scheme.clues) {
      assert.ok(l.clues[clueId], `seed ${seed}: нет улики ${clueId}`);
      const inZone = ['exterior', 'interior'].some((v) => Object.values(l.zones[v]).some((c) => c.clueId === clueId));
      const inDoc = Object.values(l.docs).some((d) => d.rows.some((r) => r.clueId === clueId));
      assert.ok(inZone || inDoc, `seed ${seed}: улика ${clueId} нигде не лежит`);
    }
    assert.ok(l.findings.some((f) => f.defectId === scheme.result), 'результат схемы не в находках');
  }
  assert.ok(withScheme > SAMPLES * 0.2, 'схем слишком мало: ' + withScheme);
});

test('пробег: при скрутке в книжке ТО на пробеге больше, чем на одометре; иначе меньше', () => {
  for (let seed = 1; seed <= SAMPLES; seed++) {
    const l = gen(seed);
    const last = l.docs.service.rows.find((r) => r.id === 'last_service');
    const km = kmFrom(last.value);
    if (l.schemeId === 'mileage_rollback') {
      assert.ok(l.rollbackKm >= 25000, 'скрутка слишком мала');
      assert.equal(l.realMileage - l.statedMileage, l.rollbackKm);
      assert.ok(km > l.statedMileage, `seed ${seed}: ТО ${km} не больше одометра ${l.statedMileage}`);
    } else {
      assert.equal(l.realMileage, l.statedMileage);
      assert.ok(km < l.statedMileage, `seed ${seed}: ТО ${km} не меньше одометра ${l.statedMileage}`);
    }
  }
});

test('ловушки у ~8% машин, у салона их нет', () => {
  let traps = 0;
  for (let seed = 1; seed <= SAMPLES * 2; seed++) {
    if (gen(seed).trap) traps++;
  }
  const rate = traps / (SAMPLES * 2);
  assert.ok(rate > 0.06 && rate < 0.1, `доля ловушек ${rate}`);
  for (let seed = 1; seed <= 300; seed++) {
    const l = gen(seed, { rep: 10, forced: { sellerId: 'salon', modelId: 'zubilo', scheme: null, defects: [] } });
    assert.equal(l.trap, null);
  }
});

test('салон открывается только с 10 уровня репутации', () => {
  for (let seed = 1; seed <= 600; seed++) assert.notEqual(gen(seed, { rep: 0 }).sellerId, 'salon');
  const seen = new Set();
  for (let seed = 1; seed <= 600; seed++) seen.add(gen(seed, { rep: 10 }).sellerId);
  assert.ok(seen.has('salon'));
});

test('сумма аргументов в среднем до 30% V0', () => {
  let total = 0;
  for (let seed = 1; seed <= SAMPLES; seed++) {
    const l = gen(seed);
    total += l.findings.reduce((s, f) => s + ctx.defectById[f.defectId].bargainPct, 0);
  }
  const avg = total / SAMPLES;
  assert.ok(avg <= 30, `среднее ${avg}`);
  assert.ok(avg >= 8, `слишком мало аргументов: ${avg}`);
});

test('VIN вымышленный, 17 знаков', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const l = gen(seed);
    assert.match(l.vin, /^Z7N[0-9A-HJ-NPR-Z]{14}$/);
    assert.equal(l.docs.pts.rows[0].value, l.vin);
  }
});

test('цена в объявлении = 1,05 × V0 (у салона 1,08)', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const l = gen(seed, { rep: 10 });
    const mult = l.sellerId === 'salon' ? 1.08 : 1.05;
    assert.ok(Math.abs(l.ask - l.v0 * mult) <= 500, `seed ${seed}`);
  }
});

test('учебное объявление: Зубило за 150 000, скрутка 130 000 → 90 000 км', () => {
  const l = generateListing(ctx, mulberry32(1), { forced: ctx.tutorial });
  assert.equal(l.ask, 150000);
  assert.equal(l.realMileage, 130000);
  assert.equal(l.statedMileage, 90000);
  assert.equal(l.findings.length, 5);
  assert.equal(l.zones.exterior.windshield.defectId, 'windshield_crack');
  assert.equal(l.zones.exterior.under.defectId, 'oil_leak');
  assert.equal(l.zones.exterior.sill.defectId, 'sill_rust');
  assert.match(l.docs.pts.rows.find((r) => r.id === 'owners').value, /^4 владельца за 3 года$/);
  assert.match(l.docs.service.rows.find((r) => r.id === 'last_service').value.replace(/ /g, ' '), /2 года назад, пробег 130 000 км/);
  assert.match(l.docs.odometer.rows[0].value.replace(/ /g, ' '), /90 000 км/);
});

test('у «Зубила» нет зоны выхлопа, поэтому синего дыма не бывает', () => {
  for (let seed = 1; seed <= SAMPLES; seed++) {
    assert.ok(!gen(seed).findings.some((f) => f.defectId === 'blue_smoke'));
  }
});
