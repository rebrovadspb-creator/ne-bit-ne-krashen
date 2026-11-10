// Главное меню: логотип, статистика, звук, правила.
import { h } from './dom.js';
import { fmtRub, repLevel } from '../economy.js';
import { navBar } from './nav.js';
import { ico } from './art.js';
import { rulesSheet } from './sheets.js';

export function mountMenu(host, app) {
  const { ctx, save } = app;
  const body = h('div', { class: 'hub-body' });
  const root = h('section', { class: 'screen hub menu-bg' }, body, navBar('menu', app));
  host.append(root);

  function render() {
    const level = repLevel(save.repXp, ctx.config.reputation);
    const row = (em, title, sub, fn) => h('button', { class: 'mrow', onClick: () => { app.sound('click'); fn(); } }, h('span', { class: 'em' }, ico(em, 30)), h('span', {}, title, sub ? h('small', { text: sub }) : null));
    body.replaceChildren(
      h('div', { class: 'logo' }, h('h1', { text: 'Не бит, не крашен' }), h('p', { text: 'Игра про перекупов. Палыч подскажет' })),
      h('div', { class: 'statrow' },
        h('div', { class: 'stat' }, h('div', { class: 'l' }, ico('trophy', 16), ' Репутация'), h('div', { class: 'v', text: `ур. ${level}` })),
        h('div', { class: 'stat' }, h('div', { class: 'l', text: 'Сделок' }), h('div', { class: 'v', text: String(save.stats.sales) })),
        h('div', { class: 'stat' }, h('div', { class: 'l', text: 'Деньги' }), h('div', { class: 'v', style: { color: 'var(--money)', fontSize: '14px' }, text: fmtRub(save.money) }))),
      h('div', { class: 'menu-list' },
        row('tag', 'К ленте объявлений', 'Выбрать машину для осмотра', () => app.show.feed()),
        row('garage', 'Мой гараж', 'Ремонт и продажа', () => app.show.garage()),
        row('info', 'Как играть', 'Короткие правила', () => rulesSheet()),
        row(save.settings.sound ? 'sound_on' : 'sound_off', save.settings.sound ? 'Звук включён' : 'Звук выключен', 'Нажмите, чтобы переключить', () => { app.toggleSound(); render(); }),
        row('close', 'Начать заново', 'Сбросит весь прогресс', () => app.confirmReset())));
  }
  render();
  return { destroy: () => root.remove() };
}
