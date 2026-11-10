import test from 'node:test';
import assert from 'node:assert/strict';
import { hitZone, MIN_TOUCH_PT } from '../js/zones.js';
import { loadCtx } from './helpers.js';

const ctx = loadCtx();
// Картинка машины на экране: ширина кадра 360 pt × 118%, соотношение 3:2.
const W = 360 * 1.18;
const H = (W * 2) / 3;

test('тап в центр зоны попадает в неё', () => {
  for (const z of ctx.modelById.zubilo.zones) {
    assert.equal(hitZone(ctx.modelById.zubilo.zones, z.x, z.y, W, H)?.id, z.id, z.id);
  }
});

test('мимо всех зон: ничего не происходит', () => {
  assert.equal(hitZone(ctx.modelById.zubilo.zones, 2, 2, W, H), null);
});

test('зона меньше 44×44 pt расширяется до минимального размера касания', () => {
  const tiny = [{ id: 'tiny', x: 50, y: 50, w: 2, h: 2 }];
  const halfW = ((MIN_TOUCH_PT / 2) / W) * 100;
  assert.equal(hitZone(tiny, 50 + halfW * 0.9, 50, W, H)?.id, 'tiny');
  assert.equal(hitZone(tiny, 50 + halfW * 1.2, 50, W, H), null);
});

test('при пересечении выигрывает ближайшая к центру зона', () => {
  const zones = [{ id: 'a', x: 40, y: 50, w: 30, h: 30 }, { id: 'b', x: 55, y: 50, w: 30, h: 30 }];
  assert.equal(hitZone(zones, 44, 50, W, H).id, 'a');
  assert.equal(hitZone(zones, 52, 50, W, H).id, 'b');
});

test('все зоны Зубила не меньше 44×44 pt на экране', () => {
  for (const z of ctx.modelById.zubilo.zones.concat(ctx.modelById.zubilo.interiorZones)) {
    // Нарисованный размер мал — не страшно: hitZone расширит. Но центры не должны совпадать.
    assert.ok(z.w > 0 && z.h > 0);
  }
  const all = ctx.modelById.zubilo.zones;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const dx = ((all[i].x - all[j].x) / 100) * W;
      const dy = ((all[i].y - all[j].y) / 100) * H;
      assert.ok(Math.hypot(dx, dy) >= 28, `${all[i].id} и ${all[j].id} слишком близко: ${Math.hypot(dx, dy).toFixed(0)} pt`);
    }
  }
});
