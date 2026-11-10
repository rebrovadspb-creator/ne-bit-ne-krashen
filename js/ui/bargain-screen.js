// Экран торга. Правила и расчёты в bargain.js, здесь только интерфейс.

import { h } from './dom.js';
import { portrait, defectIcon } from './art.js';
import { show, toast } from './layer.js';
import { fmtRub } from '../economy.js';
import { pick } from '../rng.js';
import { bargainCards } from '../inspection-core.js';
import { startBargain, playCard, bluff, buy, leave, finalPrice, bluffOptions } from '../bargain.js';
import { track } from '../track.js';

export function mountBargain(host, env) {
  const { ctx, listing, insp, save, rng } = env;
  const cfg = ctx.config;
  const seller = ctx.sellerById[listing.sellerId];
  const cards = bargainCards(insp, ctx, listing);
  let b = startBargain(listing, seller);
  let say = env.tutorial
    ? { text: 'Палыч подсказывает: выложи найденный дефект как аргумент, продавец уступит.', kind: '' }
    : { text: seller.noBargain ? 'Цена окончательная. Торга у нас нет.' : 'Ну, посмотрели? Что скажешь?', kind: '' };

  const root = h('section', { class: 'screen bargain' });
  host.append(root);

  function sellerBox() {
    const pips = [];
    for (let i = 0; i < b.patienceMax; i++) pips.push(h('div', { class: `pip ${i < b.patience ? '' : 'off'}` }));
    return h('div', { class: 'sellerbox' },
      portrait(seller.id, say.kind === 'ok' ? 'ok' : say.kind === 'no' ? 'no' : 'neutral', 104),
      h('div', { style: { flex: 1 } },
        h('b', { text: seller.name }),
        h('small', { text: seller.trait }),
        b.patienceMax ? h('div', { class: 'pips' }, pips) : null));
  }

  function render() {
    const price = finalPrice(b, seller, cfg);
    const short = save.money < price;
    const noRoom = env.garageFull;
    const trap = insp.trapDetected ? ctx.defectById[insp.trapDetected] : null;
    const bonusLive = seller.fewCardsBonus && !b.noBargain && b.played.length <= seller.fewCardsBonus.maxCards;

    const kids = [sellerBox(),
      h('div', { class: 'pricebox' },
        h('div', { class: 'l', text: 'Цена сейчас' }),
        h('div', { class: 'big', text: fmtRub(price) }),
        price !== b.ask ? h('s', { text: `в объявлении ${fmtRub(b.ask)}` }) : null),
      h('div', { class: `say ${say.kind}`, text: say.text })];

    if (trap) {
      kids.push(h('div', { class: 'trapbox', html: `<b>Ловушка: ${trap.name}.</b> Торговаться тут нельзя: такую машину лучше не брать. За то, что вы это заметили, дадим ${cfg.reputation.trapAvoided} репутации.` }));
    } else if (b.noBargain) {
      kids.push(h('div', { class: 'empty', text: 'Салон не торгуется. Берите по цене или уходите.' }));
    } else {
      kids.push(h('div', { class: 'cardsH', text: cards.length ? 'Ваши аргументы: тапните, чтобы выложить' : 'Аргументов нет' }));
      if (cards.length) {
        kids.push(h('div', { class: 'cards' }, cards.map((c) => {
          const played = b.played.includes(c.defectId);
          return h('button', { class: `acard ${c.special ? 'special' : ''} ${played ? 'played' : ''}`, onClick: () => onCard(c) },
            h('span', { class: 'withico' }, defectIcon(c.defectId, 28), h('span', {}, c.special ? h('small', { text: '★ схема · продавец примет всегда' }) : null, c.name)),
            h('em', { text: `−${fmtRub(c.argRub)}` }));
        })));
      } else {
        kids.push(h('div', { class: 'empty', text: 'Вы ничего не нашли. Можно рискнуть блефом или купить по цене объявления.' }));
      }
      if (bonusLive) kids.push(h('div', { class: 'rep', text: `Спешат: ещё −${seller.fewCardsBonus.pct}% при покупке за ${seller.fewCardsBonus.maxCards} карты или меньше` }));
      kids.push(h('button', { class: 'btn secondary small', text: 'Блеф: заявить находку без проверки', onClick: openBluff }));
    }

    const actions = h('div', { class: 'actions' });
    if (trap) {
      actions.append(h('button', { class: 'btn danger', text: `Уйти (+${cfg.reputation.trapAvoided} репутации)`, onClick: onLeave }));
    } else {
      actions.append(
        h('button', { class: 'btn', disabled: short || noRoom, text: noRoom ? 'Нет места в гараже' : short ? `Не хватает ${fmtRub(price - save.money)}` : `Купить за ${fmtRub(price)}`, onClick: onBuy }),
        h('button', { class: 'btn secondary', text: 'Уйти', onClick: onLeave }));
    }
    kids.push(actions);
    root.replaceChildren(...kids);
  }

  function reaction(result) {
    switch (result.type) {
      case 'accept':
        if (env.tutorial) return { text: `Дед сдаётся: «Ладно, давай ${fmtRub(cfg.tutorial.scriptedPrice)}, и по рукам»`, kind: 'ok' };
        return { text: `«${pick(rng, ctx.texts.sellerAccept)}» −${fmtRub(result.amount)}`, kind: 'ok' };
      case 'bluff_ok':
        return { text: `Угадали! «${pick(rng, ctx.texts.sellerAccept)}» −${fmtRub(result.amount)}`, kind: 'ok' };
      case 'bluff_fail':
        return { text: `Блеф не прошёл: −${result.cost} терпения`, kind: 'no' };
      case 'refuse':
        return { text: `«${pick(rng, ctx.texts.sellerRefuse)}» −1 терпение`, kind: 'no' };
      default:
        return null;
    }
  }

  function after(res, tag) {
    b = res.state;
    const r = reaction(res.result);
    if (r) say = r;
    track('bargain_card', { type: res.result.type, tag });
    if (b.status === 'seller_left') {
      track('seller_left', { seller: seller.id });
      render();
      const ov = h('div', { class: 'overlay', style: { zIndex: 82 } },
        h('div', { class: 'ico' }, portrait(seller.id, 'no', 150)),
        h('h1', { text: ctx.texts.sellerLeave }),
        h('p', { text: 'Терпение продавца кончилось. Машина ушла.' }),
        env.adSellerReturn ? h('button', { class: 'btn secondary', style: { marginBottom: '10px' }, onClick: () => env.adSellerReturn(() => {
          close();
          b = startBargain(listing, seller);
          say = { text: 'Ладно, давай ещё раз. Но без глупостей.', kind: '' };
          render();
        }) }) : null,
        h('button', { class: 'btn', text: 'Дальше', onClick: () => { close(); env.onDone({ status: 'seller_left', bargain: b }); } }));
      const close = show(ov);
      return;
    }
    render();
  }

  function onCard(card) {
    if (env.tutorial) {
      const res = playCard(b, card, seller, () => 0);
      res.state = { ...res.state, price: cfg.tutorial.scriptedPrice };
      after(res, 'card');
      return;
    }
    after(playCard(b, card, seller, rng), 'card');
  }

  function openBluff() {
    const opts = bluffOptions(ctx, insp, ctx.modelById[listing.modelId]);
    const sheet = h('div', { class: 'sheet' });
    const wrap = h('div', { class: 'sheet-wrap' }, sheet);
    const close = show(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    const cost = seller.bluffPatienceCost ?? cfg.bargain.bluffFailPatience;
    sheet.append(
      h('div', { class: 'sheet-head' }, h('h2', { text: 'Блеф' }), h('button', { class: 'x', text: '✕', onClick: close })),
      h('p', { style: { margin: '0 0 10px', fontSize: '12.5px', color: 'var(--text2)' },
        text: seller.bluffAlwaysFails ? 'Этот продавец блефу не верит. Не рискуйте.' : `Если такой находки нет — минус ${cost} терпения. Если есть — сработает как обычный аргумент.` }),
      ...opts.map((d) => h('button', { class: 'opt', text: d.name, onClick: () => {
        close();
        const existing = listing.findings.some((f) => f.defectId === d.id);
        after(bluff(b, d.id, existing, listing, ctx, seller, rng, cfg), 'bluff');
      } })));
  }

  function onBuy() {
    const r = buy(b, seller, save.money, cfg);
    if (!r.ok) {
      toast('Не хватает денег', 2000);
      return;
    }
    b = r.state;
    track('purchase_attempt', { price: r.price, v0: listing.v0 });
    env.onDone({ status: 'bought', price: r.price, bargain: b });
  }

  function onLeave() {
    b = leave(b);
    env.onDone({ status: insp.trapDetected ? 'trap_exit' : 'player_left', bargain: b });
  }

  render();
  return { destroy: () => root.remove() };
}
