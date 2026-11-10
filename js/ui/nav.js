// Нижняя навигация главных экранов: Лента, Гараж, Меню.
import { h } from './dom.js';
import { ico } from './art.js';

export function navBar(active, app) {
  const tab = (id, icon, label, fn) => h('button', { class: `navtab ${active === id ? 'on' : ''}`, onClick: () => { app.sound('click'); fn(); } },
    h('span', { class: 'ico' }, ico(icon, 26)), h('span', { text: label }));
  return h('nav', { class: 'nav' },
    tab('feed', 'tag', 'Лента', () => app.show.feed()),
    tab('garage', 'garage', 'Гараж', () => app.show.garage()),
    tab('menu', 'gear', 'Меню', () => app.show.menu()));
}
