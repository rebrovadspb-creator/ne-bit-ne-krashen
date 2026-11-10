import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCtx } from './helpers.js';

const root = path.resolve(import.meta.dirname, '..');
const ctx = loadCtx();

test('все картинки моделей из models.json существуют', () => {
  for (const m of ctx.models) {
    for (const key of ['exterior', 'side', 'interior', 'rareExterior', 'rareSide']) {
      if (m.art[key]) assert.ok(fs.existsSync(path.join(root, m.art[key])), `${m.id}: нет файла ${m.art[key]}`);
    }
    assert.ok(m.art.ratio > 0 && m.art.interiorRatio > 0);
  }
});

test('зоны лежат внутри картинки и покрывают все дефекты с зонами', () => {
  for (const m of ctx.models) {
    for (const z of [...m.zones, ...m.interiorZones]) {
      assert.ok(z.x - z.w / 2 >= -1 && z.x + z.w / 2 <= 101, `${m.id}.${z.id} вылезает по x`);
      assert.ok(z.y - z.h / 2 >= -1 && z.y + z.h / 2 <= 101, `${m.id}.${z.id} вылезает по y`);
    }
  }
});

test('портреты продавцов и иконки интерфейса на месте', () => {
  for (const s of ['ded', 'family', 'taxi', 'perekup']) for (const mood of ['neutral', 'ok', 'no']) assert.ok(fs.existsSync(path.join(root, `assets/chars/${s}_${mood}.webp`)));
  for (const n of ['cash', 'star', 'tag', 'garage', 'gear', 'info', 'sound_on', 'sound_off', 'close', 'ad_play', 'share']) assert.ok(fs.existsSync(path.join(root, `assets/ui/${n}.webp`)), n);
  for (const n of ['good', 'explain', 'sad']) assert.ok(fs.existsSync(path.join(root, `assets/chars/pal_${n}.webp`)));
});
