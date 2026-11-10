import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../tools/simulate.js';

// Охранная проверка баланса: профили игрока должны упорядочиваться по мастерству,
// а маржа держаться в разумных коридорах. Точные цели по профилям и сравнение с ТЗ: npm run sim и README.
test('симуляция экономики: новичок < средний < профи, маржа в коридорах', () => {
  const r = simulate(60, 40);
  assert.ok(r.novice.avgMarginPct < r.medium.avgMarginPct, 'средний зарабатывает больше новичка');
  assert.ok(r.medium.avgMarginPct < r.pro.avgMarginPct, 'профи зарабатывает больше среднего');
  assert.ok(r.novice.avgMarginPct > -3 && r.novice.avgMarginPct < 8, `новичок ${r.novice.avgMarginPct}`);
  assert.ok(r.medium.avgMarginPct > 7 && r.medium.avgMarginPct < 22, `средний ${r.medium.avgMarginPct}`);
  assert.ok(r.pro.avgMarginPct > 12 && r.pro.avgMarginPct < 28, `профи ${r.pro.avgMarginPct}`);
  assert.ok(r.pro.capitalDay60 > r.medium.capitalDay60 && r.medium.capitalDay60 > r.novice.capitalDay60);
});
