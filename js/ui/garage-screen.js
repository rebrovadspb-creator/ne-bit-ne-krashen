// Гараж: слоты, ремонт с таймерами, продажа, предложения покупателей, скупщик для ловушек.

import { h, fmtDuration } from './dom.js';
import { fmtRub } from '../economy.js';
import { listingFromRef } from '../listing.js';
import {
  slotsFor, tickRepairs, repairsRunning, nextRepairEnd, repairableDefects, saleStatus, visibleOffers, nextOfferAt,
  cancelSale, scrapperPrice, dealCard, replaceCar, boostRepairs,
} from '../garage.js';
import { adRemaining } from '../ads.js';
import { mskDayKey } from '../clock.js';
import { carImg, ico, palych, defectIcon, buyer } from './art.js';
import { navBar } from './nav.js';
import { repairSheet, saleSheet } from './sheets.js';

export function mountGarage(host, app) {
  const { ctx, save } = app;
  const cfg = ctx.config;
  const body = h('div', { class: 'hub-body' });
  const root = h('section', { class: 'screen hub garage-bg' }, body, app.tutorialActive() ? null : navBar('garage', app));
  host.append(root);
  let timer = null;

  /** Узел с обратным отсчётом: текст обновляется на месте, без перерисовки экрана. */
  function timed(tag, cls, tpl, until) {
    const el = h(tag, { class: cls });
    el.dataset.tpl = tpl;
    el.dataset.until = String(until);
    el.textContent = tpl.replace('{t}', fmtDuration(until - app.now()));
    return el;
  }

  /** Подпись состояния: меняется только когда нужна полная перерисовка. */
  function signature() {
    const now = app.now();
    return JSON.stringify([app.capital(), save.garage.cars.map((c) => [
      c.id, c.repaired.length, Object.keys(c.repairing).filter((id) => c.repairing[id].endAt <= now).length, Object.keys(c.repairing).length,
      c.sale ? [saleStatus(c.sale, now), visibleOffers(c.sale, now).map((o) => o.id)] : 0,
    ]), save.money < cfg.podrabotka.moneyBelow]);
  }
  let sig = '';

  function settleRepairs() {
    let changed = false;
    save.garage.cars.forEach((c) => {
      if (Object.values(c.repairing).some((r) => r.endAt <= app.now())) {
        save.garage = replaceCar(save.garage, tickRepairs(c, app.now()));
        changed = true;
      }
    });
    if (changed) app.persist();
    return changed;
  }

  function palText(car) {
    if (!app.tutorialActive() || !car) return null;
    if (car.sale) return visibleOffers(car.sale, app.now()).length ? 'Покупатель позвонил! Принимай предложение: это твоя первая сделка.' : 'Объявление висит. Покупатели звонят не сразу: подожди несколько секунд.';
    if (repairsRunning(car)) return 'Ремонт идёт. В настоящей игре это часы, и таймер тикает даже когда игра закрыта.';
    if (repairableDefects(ctx, car).length) return 'Машина куплена дёшево. Почини найденные дефекты: так она вырастет в цене.';
    return 'Всё починено. Теперь выставляй машину на продажу.';
  }

  function carCard(car) {
    const listing = listingFromRef(ctx, car.ref);
    const model = ctx.modelById[listing.modelId];
    const running = repairsRunning(car);
    const status = saleStatus(car.sale, app.now());
    const kids = [h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
      h('div', { class: 'thumb' }, carImg(model, listing)),
      h('div', {}, h('h3', { text: car.name }),
        h('div', { class: 'meta', text: `Куплена за ${fmtRub(car.paid)}${car.repairSpent ? `, ремонт ${fmtRub(car.repairSpent)}` : ''}` })))];

    const ch = [];
    car.found.forEach((id) => {
      const d = ctx.defectById[id];
      if (d.type === 'trap') { ch.push(h('span', { class: 'mini', style: { color: '#fca5a5' } }, defectIcon(id, 16), ` ${d.name}`)); return; }
      if (car.repaired.includes(id)) ch.push(h('span', { class: 'mini done' }, defectIcon(id, 16), ` ✓ ${d.name}`));
      else if (id in car.repairing) ch.push(timed('span', 'mini run', `🔧 ${d.name} · {t}`, car.repairing[id].endAt));
      else ch.push(h('span', { class: 'mini' }, defectIcon(id, 16), ` ${d.name}`));
    });
    if (ch.length) kids.push(h('div', { class: 'chips' }, ch));

    if (car.trap) {
      const price = scrapperPrice(ctx, listing);
      kids.push(h('div', { class: 'trapbox', html: `<b>Ловушка.</b> Обычному покупателю её не продать, берёт только скупщик: ${fmtRub(price)} (62% рыночной цены).` }));
      kids.push(h('button', { class: 'btn danger small', text: `Сдать скупщику за ${fmtRub(price)}`, onClick: () => app.sellCar(car.id, price, 'scrapper') }));
      return h('div', { class: 'gcard' }, kids);
    }

    if (car.sale) {
      const st = cfg.sale.strategies[car.sale.strategy];
      kids.push(h('div', { class: 'meta', text: `На продаже: ${st.name}${car.sale.usedReport ? ', с отчётом Пробейки' : ''}` }));
      if (status === 'waiting') kids.push(timed('div', 'empty', 'Ждём покупателя: первый позвонит через {t}', nextOfferAt(car.sale, app.now())));
      if (status === 'none') kids.push(h('div', { class: 'empty', text: 'Покупателей не нашлось. Выставьте заново по другой цене.' }));
      if (status === 'expired') kids.push(h('div', { class: 'empty', text: 'Предложения закончились. Выставьте заново.' }));
      visibleOffers(car.sale, app.now()).forEach((o) => kids.push(h('div', { class: 'offer' }, buyer(o.id + car.id, 44),
        h('div', { style: { flex: 1 } }, h('b', { text: fmtRub(o.price) }), timed('small', '', 'действует ещё {t}', o.expireAt)),
        h('button', { class: 'btn', text: 'Принять', onClick: () => app.sellCar(car.id, o.price, 'offer') }))));
      kids.push(h('button', { class: 'btn secondary small', text: 'Снять с продажи', onClick: () => { save.garage = replaceCar(save.garage, cancelSale(car)); app.persist(); render(); } }));
      return h('div', { class: 'gcard' }, kids);
    }

    const rows = [];
    if (running) {
      const left = adRemaining(save.ad, 'repair_boost', mskDayKey(app.now()), cfg);
      kids.push(timed('div', 'meta', 'Ремонт идёт: готово через {t}', nextRepairEnd(car)));
      if (!app.tutorialActive()) rows.push(h('button', { class: 'btn secondary', disabled: left <= 0, onClick: () => app.boostByAd(car.id, render) }, left > 0 ? [ico('boost', 22), ` Ускорить на ${cfg.repair.boostHours} ч (${left})`] : 'Ускорение на сегодня закончилось'));
    }
    const canRepair = repairableDefects(ctx, car).length > 0;
    if (canRepair) rows.push(h('button', { class: `btn secondary ${app.tutorialActive() ? 'hint-pulse' : ''}`, onClick: () => { app.tutorialRepair = app.tutorialActive(); repairSheet(app, car.id, render); } }, ico('tip', 22), 'Ремонт'));
    rows.push(h('button', { class: `btn ${!canRepair && app.tutorialActive() && !running ? 'hint-pulse' : ''}`, disabled: app.tutorialActive() && (running || canRepair), onClick: () => saleSheet(app, car.id, render) }, ico('cash', 22), 'Продать'));
    kids.push(h('div', { class: 'rowbtns' }, rows));
    return h('div', { class: 'gcard' }, kids);
  }

  function render() {
    settleRepairs();
    const capital = app.capital();
    const slots = slotsFor(capital, cfg);
    const kids = [];
    const tutCar = save.garage.cars[0];
    const pal = palText(tutCar);
    if (pal) kids.push(h('div', { class: 'banner pal' }, palych(pal.includes('Покупатель позвонил') ? 'good' : 'explain', 52), h('div', {}, h('b', { text: 'Палыч: ' }), pal)));
    kids.push(h('div', { class: 'statrow' },
      h('div', { class: 'stat' }, h('div', { class: 'l', text: 'Капитал' }), h('div', { class: 'v', text: fmtRub(capital) }), h('div', { class: 's', text: 'деньги + машины' })),
      h('div', { class: 'stat' }, h('div', { class: 'l', text: 'Места' }), h('div', { class: 'v', text: `${save.garage.cars.length} из ${slots}` }), h('div', { class: 's', text: 'в гараже' }))));

    save.garage.cars.forEach((c) => kids.push(carCard(c)));
    for (let i = save.garage.cars.length; i < slots; i++) kids.push(h('div', { class: 'gcard empty-slot', text: 'Свободное место. Купите машину в ленте' }));

    const next = cfg.garage.slotCapitalThresholds[slots];
    if (slots < cfg.garage.mvpMaxSlots && next !== undefined) kids.push(h('div', { class: 'gcard empty-slot locked-slot', text: `🔒 Второе место откроется при капитале ${fmtRub(next)}` }));

    if (!save.garage.cars.length && save.money < cfg.podrabotka.moneyBelow && !app.tutorialActive()) {
      const done = save.podrabotkaDay === mskDayKey(app.now());
      kids.push(h('div', { class: 'banner' }, palych('sad', 52), h('div', {}, 'Денег мало, гараж пуст. Палыч даёт подработку: поможете в мастерской.')));
      kids.push(h('button', { class: 'btn', disabled: done, onClick: () => app.podrabotka(render) }, ico('gift', 22), done ? 'Подработка уже была сегодня' : `Подработать: +${fmtRub(cfg.podrabotka.amount)}`));
    }
    body.replaceChildren(...kids.filter(Boolean));
    sig = signature();
  }

  function tick() {
    if (settleRepairs() || signature() !== sig) {
      if (!document.querySelector('#layer .sheet-wrap')) render();
      return;
    }
    body.querySelectorAll('[data-until]').forEach((el) => {
      el.textContent = el.dataset.tpl.replace('{t}', fmtDuration(Number(el.dataset.until) - app.now()));
    });
  }

  render();
  timer = setInterval(tick, 1000);
  return { destroy() { clearInterval(timer); root.remove(); }, refresh: render };
}
