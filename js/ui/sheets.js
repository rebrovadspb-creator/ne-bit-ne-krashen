// Шторки и карточки поверх экранов: ремонт, продажа, карточка сделки, правила, предложение рекламы.

import { h, fmtDuration } from './dom.js';
import { ico, defectIcon } from './art.js';
import { show } from './layer.js';
import { fmtRub } from '../economy.js';
import {
  repairableDefects, repairCostRub, startRepairs, salePriceBase, listForSale, tickRepairs, removeCar, replaceCar, scrapperPrice,
} from '../garage.js';
import { listingFromRef } from '../listing.js';
import { adRemaining } from '../ads.js';
import { mskDayKey } from '../clock.js';

/** Универсальная шторка. Возвращает {body, close}. */
export function openSheet(title, { onClose } = {}) {
  const body = h('div', { class: 'page' });
  const sheet = h('div', { class: 'sheet' });
  const wrap = h('div', { class: 'sheet-wrap' }, sheet);
  const remove = show(wrap);
  const close = () => {
    remove();
    onClose?.();
  };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  sheet.append(h('div', { class: 'sheet-head' }, h('h2', { text: title }), h('button', { class: 'x', text: '✕', 'aria-label': 'Закрыть', onClick: close })), body);
  return { body, sheet, wrap, close };
}

/** Предложение посмотреть рекламу за награду. onDone вызывается всегда, когда окно и реклама закончились. */
export function adPrompt(app, placement, { title, text, button }, onReward, onDone) {
  const left = adRemaining(app.save.ad, placement, mskDayKey(app.now()), app.ctx.config);
  let started = false;
  const { body, close, wrap } = openSheet(title, { onClose: () => { if (!started) onDone?.(); } });
  wrap.style.zIndex = 88; // выше оверлеев «продавец ушёл» (82) и паузы (85)
  body.style.padding = '14px';
  body.append(h('p', { style: { margin: '0 0 12px', fontSize: '14px', lineHeight: 1.45 }, text }));
  if (left > 0) {
    body.append(h('button', { class: 'btn', onClick: async () => {
      started = true;
      close();
      if (await app.ads.rewarded(placement)) onReward();
      onDone?.();
    } }, ico('ad_play', 22), `${button} (осталось ${left})`));
  } else {
    body.append(h('div', { class: 'empty', text: 'Лимит рекламы на сегодня исчерпан. Всё восстановится само.' }));
  }
  return close;
}

/** Ремонт: выбор дефектов, у каждого свой таймер, идут параллельно. */
/** 0,25 ч → «15 мин», 2 ч → «2 ч». */
function fmtRepairTime(hours) {
  const min = Math.round(hours * 60);
  return min < 60 ? `${min} мин` : `${Math.round((min / 60) * 10) / 10} ч`;
}

export function repairSheet(app, carId, onDone) {
  const { ctx, save } = app;
  const car = save.garage.cars.find((c) => c.id === carId);
  const listing = listingFromRef(ctx, car.ref);
  const items = repairableDefects(ctx, car);
  const chosen = new Set(items);
  const { body, close } = openSheet('Ремонт');

  function render() {
    const total = [...chosen].reduce((s, id) => s + repairCostRub(ctx, listing, id), 0);
    const tut = car.ref.tutorial && app.tutorialRepair;
    const cost = tut ? ctx.config.tutorial.scriptedRepairCost : total;
    body.replaceChildren(
      h('div', { class: 'cards' }, items.length ? items.map((id) => {
        const d = ctx.defectById[id];
        const on = chosen.has(id);
        return h('button', { class: `acard ${on ? 'special' : ''}`, onClick: () => { on ? chosen.delete(id) : chosen.add(id); render(); } },
          h('span', { class: 'withico' }, defectIcon(id, 28), h('span', {}, h('small', { text: `${on ? '☑' : '☐'} ${tut ? Math.round(ctx.config.tutorial.repairSec) + ' сек' : fmtRepairTime(d.repairHours * (ctx.config.repair.timeScale ?? 1))}` }), d.name)),
          h('em', { text: fmtRub(tut ? Math.round(ctx.config.tutorial.scriptedRepairCost / items.length) : repairCostRub(ctx, listing, id)) }));
      }) : h('div', { class: 'empty', text: 'Чинить нечего: вы не нашли устранимых дефектов или всё уже в работе.' })),
      items.length ? h('div', { style: { padding: '12px 4px 4px' } },
        h('div', { class: 'rep', style: { color: 'var(--text2)', marginBottom: '8px' }, text: `Итого: ${fmtRub(cost)}. Дефекты чинятся одновременно.` }),
        h('button', { class: 'btn', disabled: !chosen.size || cost > save.money, text: cost > save.money ? `Не хватает ${fmtRub(cost - save.money)}` : 'Начать ремонт', onClick: () => {
          const res = startRepairs(ctx, car, listing, [...chosen], app.now(), save.money, tut ? { cost, durationMs: ctx.config.tutorial.repairSec * 1000 } : {});
          if (res.error) return;
          save.money -= res.cost;
          save.garage = replaceCar(save.garage, res.car);
          app.moneyChanged();
          app.track('repair_start', { n: chosen.size, cost: res.cost });
          app.persist();
          close();
          onDone?.();
        } })) : null);
  }
  render();
}

/** Продажа: три стратегии, отчёт Пробейки, ориентир цены. */
export function saleSheet(app, carId, onDone) {
  const { ctx, save } = app;
  const cfg = ctx.config;
  const car0 = save.garage.cars.find((c) => c.id === carId);
  const car = tickRepairs(car0, app.now());
  const listing = listingFromRef(ctx, car.ref);
  const { body, close } = openSheet(`Продажа: ${car.name}`);
  let strategy = 'market';
  let useReport = Boolean(car.usedReport);
  const canAttach = !car.usedReport && save.probeika.tokens > 0;

  function render() {
    const base = salePriceBase(ctx, car, listing, useReport);
    const row = (id) => {
      const st = cfg.sale.strategies[id];
      const price = Math.round((base * (1 + st.mult)) / 1000) * 1000;
      const hint = id === 'premium' ? `через ${st.firstOfferHours} ч, ${Math.round(st.noOfferChance * 100)}% — предложений не будет` : `первое предложение через ${st.firstOfferHours} ч`;
      return h('button', { class: `acard ${strategy === id ? 'special' : ''}`, onClick: () => { strategy = id; render(); } },
        h('span', { class: 'withico' }, ico({ fast: 'rabbit', market: 'scales', premium: 'coins_up' }[id], 30), h('span', {}, h('small', { text: `${strategy === id ? '◉' : '○'} ${st.mult ? (st.mult > 0 ? '+' : '') + Math.round(st.mult * 100) + '% к цене' : 'рыночная цена'}` }), `${st.name} · ${hint}`)),
        h('em', { text: `≈ ${fmtRub(price)}` }));
    };
    body.replaceChildren(
      h('div', { class: 'cards' }, ['fast', 'market', 'premium'].map(row)),
      car.usedReport
        ? h('div', { class: 'confirm', style: { margin: '10px 0' }, text: '✓ Отчёт Пробейки приложен: цена выше на 9%' })
        : canAttach
          ? h('button', { class: 'btn secondary small', style: { margin: '10px 0' }, onClick: () => { useReport = !useReport; render(); } }, ico('receipt', 22), `${useReport ? '☑' : '☐'} Приложить отчёт Пробейки (−1 жетон): цена выше на 9%`)
          : h('div', { class: 'empty', style: { margin: '10px 0' }, text: 'Нет жетона Пробейки: без отчёта цена на 9% ниже.' }),
      h('button', { class: 'btn', text: 'Выставить на продажу', onClick: () => {
        if (useReport && !car.usedReport) {
          save.probeika.tokens -= 1;
        }
        const seed = (save.playerSeed ^ Math.imul(app.now() >>> 0, 2654435761)) >>> 0;
        let sold = listForSale(ctx, { ...car, usedReport: useReport }, listing, strategy, useReport, app.now(), seed);
        if (car.ref.tutorial) {
          sold = { ...sold, sale: { ...sold.sale, noOffers: false, offers: [{ id: 0, price: cfg.tutorial.scriptedOffer, appearAt: app.now() + 8000, expireAt: app.now() + 24 * 3600 * 1000 }] } };
        }
        save.garage = replaceCar(save.garage, sold);
        app.track('sale_listed', { strategy, report: useReport });
        app.persist();
        close();
        onDone?.();
      } }));
  }
  render();
}

/** Карточка сделки «Взял за 115, продал за 190» с кнопкой «Поделиться». */
export function dealCardSheet(app, card, onClose) {
  const { body, close } = openSheet('Сделка закрыта', { onClose });
  const k = (n) => Math.round(n / 1000);
  body.style.padding = '14px';
  body.append(
    h('div', { class: `rcard ${card.profit >= 0 ? 'good' : 'bad'}` },
      h('div', { class: 'l', text: card.name }),
      h('div', { class: 'amt', text: `${card.profit >= 0 ? '+' : '−'}${fmtRub(Math.abs(card.profit))}` }),
      h('div', { style: { fontSize: '13px', color: 'var(--text2)', marginTop: '4px' }, text: `Взял за ${k(card.paid)}, продал за ${k(card.sold)} тыс.${card.repairs ? `, ремонт ${k(card.repairs)} тыс.` : ''}` })),
    h('div', { class: 'actions', style: { paddingBottom: '0' } },
      h('button', { class: 'btn', onClick: async () => { await app.shareDeal(card); } }, ico('share', 22), 'Поделиться'),
      h('button', { class: 'btn secondary', text: 'Отлично', onClick: close })));
}

export function rulesSheet() {
  const { body } = openSheet('Как играть');
  const li = (t) => h('li', { text: t });
  body.style.padding = '14px';
  body.append(h('ul', { style: { margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '9px', fontSize: '14px', lineHeight: 1.45 } },
    li('Выберите объявление в ленте и осмотрите машину за 3 минуты: кузов, салон и документы.'),
    li('Каждый найденный дефект становится аргументом в торге.'),
    li('Две улики вместе раскрывают схему продавца: скрутку пробега, такси, скрытое ДТП.'),
    li('Пробейка за жетон показывает залог, розыск и историю машины без улик.'),
    li('Торгуйтесь: выкладывайте аргументы, следите за терпением продавца.'),
    li('Купленную машину чините (таймер идёт и когда вы не в игре) и продавайте дороже.'),
    li('Прибыль открывает дорогие машины и новые места в гараже.')));
}

export { scrapperPrice, removeCar };
