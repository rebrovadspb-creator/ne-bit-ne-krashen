// «Итог покупки». Деньги и репутацию уже учла main.js, здесь только показ.

import { h } from './dom.js';
import { fmtRub, fmtKm } from '../economy.js';
import { track } from '../track.js';
import { defectIcon } from './art.js';

export function mountSummary(host, env) {
  const { ctx, listing, summary, outcome, gain, save } = env;
  const bought = outcome.status === 'bought';
  const kids = [];

  if (summary.trapBought) {
    const def = ctx.defectById[summary.trapBought];
    kids.push(h('div', { class: 'rcard trap' },
      h('div', { class: 'l', text: 'Вы купили ловушку' }),
      h('div', { style: { fontSize: '15px', lineHeight: 1.45 }, html: `<b>${def.name}.</b> Такую машину уже не продать как обычную: только скупщику за ${fmtRub(summary.trapSalePrice)} (62% рыночной цены).` })));
  } else if (bought) {
    kids.push(h('div', { class: 'rcard good' },
      h('div', { class: 'l', text: `Куплено: ${listing.modelName}, ${listing.year}` }),
      h('div', { class: 'amt', text: fmtRub(summary.paid) }),
      h('div', { style: { fontSize: '12.5px', color: 'var(--text2)', marginTop: '4px' }, text: `Скидка к объявлению: ${fmtRub(summary.discount)}. Рыночная цена: около ${fmtRub(summary.marketPrice)}` })));
  } else {
    const why = outcome.status === 'seller_left' ? 'Продавец ушёл' : outcome.status === 'trap_exit' ? 'Вы ушли от ловушки' : 'Вы ушли без покупки';
    kids.push(h('div', { class: 'rcard neutral' },
      h('div', { class: 'l', text: why }),
      h('div', { style: { fontSize: '14px', color: 'var(--text2)' }, text: `${listing.modelName}, ${listing.year}: цена в объявлении была ${fmtRub(summary.ask)}` })));
  }

  if (summary.mileageConfirmedKm) {
    kids.push(h('div', { class: 'confirm', text: `✓ Пробейка подтвердила: пробег скручен на ${fmtKm(summary.mileageConfirmedKm)}` }));
  }

  const foundList = h('ul', { class: 'list' }, summary.found.map((x) =>
    h('li', {}, h('b', {}, defectIcon(x.defectId, 20), ' ', x.name), h('em', { text: x.type === 'trap' ? 'ловушка' : `−${fmtRub(x.argRub)}` }))));
  kids.push(h('div', { class: 'rcard neutral' },
    h('div', { class: 'l', text: `Найдено: ${summary.found.length}` }),
    summary.found.length ? foundList : h('div', { style: { fontSize: '13px', color: 'var(--text2)' }, text: 'Ничего не нашли' })));

  if (summary.missed.length) {
    kids.push(h('div', { class: 'rcard bad' },
      h('div', { class: 'l', text: `Пропущено: ${summary.missed.length}` }),
      h('ul', { class: 'list miss' }, summary.missed.map((x) => h('li', {}, h('b', {}, defectIcon(x.defectId, 20), ' ', x.name), h('em', { text: `−${fmtRub(x.argRub)}` }))))));
  }

  if (summary.probeika.length) {
    const label = summary.probeikaUsed ? 'Пробейка показала бы сразу' : 'Без Пробейки не увидеть';
    kids.push(h('div', { class: 'rcard bad' },
      h('div', { class: 'l', text: `${label}: ${summary.probeika.length}` }),
      h('ul', { class: 'list miss' }, summary.probeika.map((x) =>
        h('li', {}, h('b', {}, defectIcon(x.defectId, 20), ' ', x.name), h('em', { text: x.type === 'trap' ? 'ловушка' : `−${fmtRub(x.argRub)}` }))))));
  }

  if (gain.xp) kids.push(h('div', { class: 'rep', text: `+${gain.xp} к репутации` }));
  kids.push(h('div', { class: 'actions' },
    bought
      ? h('button', { class: 'btn', text: 'В гараж →', onClick: () => { track('summary_next', { to: 'garage' }); env.onNext('garage'); } })
      : h('button', { class: 'btn', text: 'К ленте →', onClick: () => { track('summary_next', { to: 'feed' }); env.onNext('feed'); } }),
    bought && !env.tutorial ? h('div', { class: 'rep', style: { color: 'var(--text2)' }, text: 'Починить и продать машину можно в гараже' }) : null));

  const root = h('section', { class: 'screen summary' }, kids);
  host.append(root);
  return { destroy: () => root.remove() };
}
