// Слой поверх экранов: всплывающие карточки, тосты, оверлеи.
// Координаты всплывашек считаются из getBoundingClientRect() элемента-якоря
// ДО любых изменений DOM (иначе у удалённого элемента будут нули).

import { h } from './dom.js';

const layer = () => document.getElementById('layer');

/** Якорь по точке на экране (клиентские координаты). */
export function anchorAt(clientX, clientY) {
  return { x: clientX, y: clientY };
}

export function anchorOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top };
}

/** Всплывающая карточка рядом с якорем. kind: '' | 'clue' | 'bad' | 'mute'. */
export function popup(anchor, { title, sub, kind = '' }, stack = 0) {
  const box = layer().getBoundingClientRect();
  const x = Math.min(Math.max(anchor.x - box.left, 95), box.width - 95);
  const y = Math.min(Math.max(anchor.y - box.top - stack * 56, 70), box.height - 60);
  const el = h('div', { class: `popup ${kind}`, style: { left: x + 'px', top: y + 'px' } },
    h('div', { class: 't', text: title }),
    sub ? h('div', { class: 's', text: sub }) : null);
  layer().append(el);
  setTimeout(() => el.remove(), kind === 'mute' ? 1100 : 2200);
  return el;
}

/** Тост внизу экрана. Возвращает промис, который выполнится после скрытия. */
export function toast(text, ms = 2500) {
  return new Promise((resolve) => {
    const n = layer().querySelectorAll('.toast').length;
    const el = h('div', { class: 'toast', text, style: { bottom: 150 + n * 58 + 'px' } });
    layer().append(el);
    setTimeout(() => {
      el.remove();
      resolve();
    }, ms);
  });
}

/** Подсказка-стрелка (в обучении). left/top в клиентских координатах. */
export function tip(text, clientX, clientTop) {
  const box = layer().getBoundingClientRect();
  const el = h('div', { class: 'tip', text, style: {
    left: Math.min(Math.max(clientX - box.left, 120), box.width - 120) + 'px',
    top: Math.max(clientTop - box.top - 62, 62) + 'px' } });
  layer().append(el);
  return el;
}

/** Показать узел поверх экрана; вернуть функцию закрытия. */
export function show(node) {
  layer().append(node);
  return () => node.remove();
}

export function flash() {
  const el = h('div', { class: 'flash' });
  layer().append(el);
  setTimeout(() => el.remove(), 520);
}

export function clearLayer() {
  layer().replaceChildren();
}
