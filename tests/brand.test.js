// Проверка «Шага 1»: в коде и ассетах игры не должно остаться чужих брендов.
// Ищем: autoteka, автотек, avito, авито, т-банк, tinkoff, тинькофф, lada, VIN на XTA, цену 219.
//
// XTA ищем именно как VIN-шаблон (XTA + 14 знаков), а не как подстроку: подстрока «xta»
// легко даст ложное срабатывание в обычном коде (например, «contextAction»).
// «lada» и «219» ищем как отдельные слова и числа, «хвостов» (например, 0.219) не считаем.
// Папка docs/ не сканируется: там описана история проекта. vendor/ — чужая библиотека без изменений.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'docs', 'tests', 'vendor']);
const TEXT_EXT = new Set(['.html', '.css', '.js', '.json', '.svg', '.py']);
const BIN_EXT = new Set(['.png', '.webp', '.jpg', '.jpeg']);

const BRANDS = /autoteka|автотек|avito|авито|т-банк|тбанк|t-bank|tinkoff|тинькофф/i;
const LADA = /\blada\b|\bлада\b/i;
const VIN_XTA = /\bXTA[0-9A-HJ-NPR-Z]{14}\b/;
const PRICE_219 = /(?<![\d.,])219(?![\d.,])/;
const BIN_BRANDS = /avito|autoteka|tinkoff/i; // для бинарников только длинные слова

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else out.push(p);
  }
  return out;
}

const files = walk(ROOT);

test('сканируем хотя бы код и ассеты', () => {
  assert.ok(files.some((f) => f.endsWith('index.html')));
  assert.ok(files.some((f) => BIN_EXT.has(extname(f))));
});

test('в коде и данных нет чужих брендов, цены 219 и вымышленный VIN не на XTA', () => {
  const hits = [];
  for (const f of files) {
    if (!TEXT_EXT.has(extname(f))) continue;
    const text = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f);
    for (const [name, re] of [['бренд', BRANDS], ['lada', LADA], ['VIN XTA', VIN_XTA], ['цена 219', PRICE_219]]) {
      const m = text.match(re);
      if (m) hits.push(`${rel}: ${name}: «${m[0]}»`);
    }
  }
  assert.deepEqual(hits, []);
});

test('в метаданных картинок нет чужих брендов', () => {
  const hits = [];
  for (const f of files) {
    if (!BIN_EXT.has(extname(f))) continue;
    const m = readFileSync(f).toString('latin1').match(BIN_BRANDS);
    if (m) hits.push(`${relative(ROOT, f)}: «${m[0]}»`);
  }
  assert.deepEqual(hits, []);
});
