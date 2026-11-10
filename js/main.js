// Точка входа: загрузка данных и сохранения, ежедневная лента, поток экранов, обучение с Палычем, реклама и шеринг.

import { loadAll } from './data.js';
import { mulberry32 } from './rng.js';
import { listingFromRef } from './listing.js';
import { repLevel } from './economy.js';
import { nowMs, mskDayKey } from './clock.js';
import { defaultSave, loadSave, persist, resetSave, rollDay } from './store.js';
import { initTrack, track } from './track.js';
import { buildSummary } from './summary.js';
import { buildFeed, updateHistory, unlockedSegments, hash32 } from './feed.js';
import { spendInspection, addByAd, syncInspections } from './limits.js';
import { adRemaining, adWatched, interstitialAllowed, interstitialShown } from './ads.js';
import { capitalOf, freeSlots, slotsFor, parkCar, removeCar, replaceCar, boostRepairs, dealCard } from './garage.js';
import { initPlatform, cloudGet, cloudFlush, showRewarded, showInterstitial, shareStory, allowNotifications } from './vk.js';
import { setSoundEnabled, play } from './sound.js';
import { fmtRub } from './economy.js';
import { h } from './ui/dom.js';
import { ico, palych, preloadArt } from './ui/art.js';
import { clearLayer, toast, show as showNode } from './ui/layer.js';
import { mountListing } from './ui/listing-screen.js';
import { mountInspection } from './ui/inspection.js';
import { mountBargain } from './ui/bargain-screen.js';
import { mountSummary } from './ui/summary-screen.js';
import { mountFeed } from './ui/feed-screen.js';
import { mountGarage } from './ui/garage-screen.js';
import { mountMenu } from './ui/menu-screen.js';
import { adPrompt, dealCardSheet, openSheet } from './ui/sheets.js';

const params = new URLSearchParams(location.search);
const host = document.getElementById('host');
const topbar = document.getElementById('topbar');

let ctx = null;
let save = null;
let current = null;

const TUTORIAL_ENTRY = { seed: 1, tutorial: true, st: 'new' };

// ---------------- вспомогательное ----------------

function renderTopbar() {
  if (!save) return;
  const level = repLevel(save.repXp, ctx.config.reputation);
  topbar.replaceChildren(
    h('div', { class: 'chip' }, ico('cash', 18), h('b', { text: fmtRub(save.money) })),
    h('div', { class: 'chip rep' }, ico('star', 18), 'ур.', h('b', { text: String(level) })));
}

function go(mount, env) {
  current?.destroy();
  clearLayer();
  current = mount(host, env);
  renderTopbar();
  return current;
}

const capital = () => capitalOf(save.money, save.garage);
const tutorialActive = () => !save.tutorialDone;

function level() {
  return repLevel(save.repXp, ctx.config.reputation);
}

function persistNow() {
  persist(save);
}

/** Новые сутки по МСК: жетоны, осмотры, лента. */
function ensureDay() {
  const key = rollDay(save, ctx.config, nowMs());
  if (!save.feed || save.feed.dayKey !== key) buildTodayFeed(0);
}

function buildTodayFeed(refreshN) {
  const key = mskDayKey(nowMs());
  const feed = buildFeed(ctx, {
    dayKey: key, playerSeed: save.playerSeed, capital: capital(), rep: level(),
    history: save.history, lastRareDay: save.lastRareDay, refreshN,
  });
  const upd = updateHistory(ctx, save.history, feed, save.lastRareDay);
  save.history = upd.history;
  save.lastRareDay = upd.lastRareDay;
  save.feed = feed;
  persistNow();
  track('feed_built', { refreshN, rare: feed.hasRare });
}

/** Открытие сегментов и слотов гаража по капиталу. */
function checkUnlocks() {
  const cap = capital();
  for (const id of unlockedSegments(ctx, cap)) {
    if (!save.segmentsSeen.includes(id)) {
      save.segmentsSeen.push(id);
      const name = ctx.config.segments.find((s) => s.id === id)?.name ?? id;
      toast(`🔓 Открыт сегмент «${name}»: новые машины в завтрашней ленте`, 3500);
      track('segment_unlocked', { id });
      play('unlock');
    }
  }
  const slots = slotsFor(cap, ctx.config);
  if (slots > save.slotsSeen) {
    save.slotsSeen = slots;
    toast('🔓 Открылось новое место в гараже', 3200);
    track('slot_unlocked', { slots });
    play('unlock');
  }
}

function moneyChanged() {
  checkUnlocks();
  renderTopbar();
}

// ---------------- реклама ----------------

async function rewarded(placement) {
  const key = mskDayKey(nowMs());
  if (adRemaining(save.ad, placement, key, ctx.config) <= 0) {
    toast('Лимит рекламы на сегодня исчерпан', 2200);
    return false;
  }
  track('ad_offer', { placement });
  const r = await showRewarded();
  if (r === 'ok') {
    save.ad = adWatched(save.ad, placement, mskDayKey(nowMs()));
    persistNow();
    track('ad_reward', { placement });
    return true;
  }
  toast(r === 'unavailable' ? 'Реклама сейчас недоступна. Попробуйте позже' : 'Реклама не досмотрена, награды нет', 2800);
  track('ad_fail', { placement, result: r });
  return false;
}

/** Межстраничная реклама: только после завершённой сделки, по политике из ads.js. */
async function maybeInterstitial() {
  const ok = interstitialAllowed(save.ad, nowMs(), ctx.config, { tutorial: tutorialActive(), firstSession: save.stats.sessions <= 1, afterDeal: true });
  if (!ok) return;
  save.ad = interstitialShown(save.ad, nowMs());
  persistNow();
  track('ad_interstitial');
  await showInterstitial();
}

// ---------------- Палыч ----------------

function pal(text, label, onClick) {
  const box = h('div', { class: 'pal-dlg' },
    palych('explain', 56),
    h('div', {}, h('p', {}, h('b', { text: 'Палыч: ' }), text),
      label ? h('button', { class: 'btn', text: label, onClick: () => { close(); onClick?.(); } }) : null));
  const close = showNode(box);
  return close;
}

// ---------------- поток экранов ----------------

const app = {
  get ctx() { return ctx; },
  get save() { return save; },
  now: nowMs,
  track,
  persist: persistNow,
  sound: play,
  capital,
  ensureDay,
  moneyChanged,
  tutorialActive,
  tutorialRepair: false,
  syncInsp() { save.insp = syncInspections(save.insp, nowMs(), ctx.config); },
  ads: { rewarded },
  show: {
    feed: () => { ensureDay(); go(mountFeed, app); },
    garage: () => go(mountGarage, app),
    menu: () => go(mountMenu, app),
    listing: (entry) => showListing(entry),
  },

  async getInspectionByAd(after) {
    adPrompt(app, 'no_inspections', {
      title: 'Осмотры закончились',
      text: 'Новый осмотр появляется раз в 4 часа. Можно получить дополнительный за короткую рекламу.',
      button: 'Получить осмотр',
    }, () => {
      const s = addByAd(save.insp, mskDayKey(nowMs()), ctx.config);
      if (s) { save.insp = s; persistNow(); toast('+1 осмотр', 1800); }
    }, () => after?.());
  },

  refreshFeedByAd(after) {
    adPrompt(app, 'feed_refresh', {
      title: 'Обновить ленту',
      text: 'Покажем пять новых объявлений. Осмотренные и купленные пропадут из ленты. Один раз в сутки.',
      button: 'Обновить ленту',
    }, () => {
      buildTodayFeed((save.feed?.refreshN ?? 0) + 1);
      toast('Лента обновлена', 1800);
    }, () => after?.());
  },

  boostByAd(carId, after) {
    adPrompt(app, 'repair_boost', {
      title: 'Ускорить ремонт',
      text: `Мастера поторопятся: до конца ремонта станет короче на ${ctx.config.repair.boostHours} ч.`,
      button: 'Ускорить',
    }, () => {
      const car = save.garage.cars.find((c) => c.id === carId);
      save.garage = replaceCar(save.garage, boostRepairs(car, ctx.config.repair.boostHours * 3600 * 1000, nowMs()));
      persistNow();
      track('repair_boost');
    }, () => after?.());
  },

  podrabotka(after) {
    save.money += ctx.config.podrabotka.amount;
    save.podrabotkaDay = mskDayKey(nowMs());
    track('podrabotka');
    persistNow();
    moneyChanged();
    toast(`Палыч заплатил ${fmtRub(ctx.config.podrabotka.amount)}`, 2200);
    after?.();
  },

  async sellCar(carId, price, kind) {
    const car = save.garage.cars.find((c) => c.id === carId);
    if (!car) return;
    const rep = ctx.config.reputation;
    save.money += price;
    save.garage = removeCar(save.garage, carId);
    save.stats.sales += 1;
    if (kind === 'offer' && car.sale?.usedReport) save.repXp += rep.saleReport;
    const card = dealCard(car, price);
    save.deals = [card, ...save.deals].slice(0, 10);
    track('sale', { kind, price, profit: card.profit, report: Boolean(car.sale?.usedReport), tutorial: Boolean(car.ref.tutorial) });
    play('cash');
    const wasTutorial = tutorialActive();
    if (wasTutorial) save.tutorialDone = true;
    persistNow();
    moneyChanged();
    current?.refresh?.();
    if (wasTutorial) {
      dealCardSheet(app, card, () => pal('Вот так это и работает: взял дешевле, починил, продал дороже. Теперь ты сам. Лента объявлений ждёт.', 'К ленте', () => app.show.feed()));
      track('tutorial_done');
    } else {
      dealCardSheet(app, card, () => { maybeInterstitial(); });
    }
    if (save.stats.sales === 1) {
      const r = await allowNotifications();
      track('notifications_prompt', { result: r });
    }
  },

  async shareDeal(card) {
    const dataUrl = drawDealCard(card);
    track('share_deal');
    const r = await shareStory(dataUrl);
    if (r === 'downloaded') toast('Картинка сохранена', 2000);
  },

  toggleSound() {
    save.settings.sound = !save.settings.sound;
    setSoundEnabled(save.settings.sound);
    persistNow();
  },

  confirmReset() {
    const { body, close } = openSheet('Начать заново?');
    body.style.padding = '14px';
    body.append(
      h('p', { style: { margin: '0 0 12px', fontSize: '14px', lineHeight: 1.45 }, text: 'Весь прогресс будет удалён: деньги, гараж, репутация. Это нельзя отменить.' }),
      h('button', { class: 'btn danger', text: 'Да, сбросить', onClick: async () => {
        const fresh = defaultSave(ctx.config);
        persist(fresh);
        await cloudFlush();
        track('reset');
        location.search = '';
        location.reload();
        close();
      } }),
      h('button', { class: 'btn secondary', style: { marginTop: '8px' }, text: 'Отмена', onClick: close }));
  },
};

/** Карточка сделки как картинка для истории ВК. */
function drawDealCard(card) {
  const c = document.createElement('canvas');
  c.width = 720;
  c.height = 1280;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 1280);
  grad.addColorStop(0, '#1b1f45');
  grad.addColorStop(1, '#0d0e1a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 720, 1280);
  g.textAlign = 'center';
  g.fillStyle = '#ffd700';
  g.font = '900 64px system-ui, sans-serif';
  g.fillText('Не бит, не крашен', 360, 200);
  g.fillStyle = '#fff';
  g.font = '700 44px system-ui, sans-serif';
  g.fillText(card.name, 360, 420);
  g.fillStyle = '#9ca3af';
  g.font = '600 38px system-ui, sans-serif';
  const k = (n) => Math.round(n / 1000);
  g.fillText(`Взял за ${k(card.paid)}, продал за ${k(card.sold)} тыс.`, 360, 520);
  g.fillStyle = card.profit >= 0 ? '#4ade80' : '#f87171';
  g.font = '900 110px system-ui, sans-serif';
  g.fillText(`${card.profit >= 0 ? '+' : '−'}${fmtRub(Math.abs(card.profit))}`, 360, 720);
  g.fillStyle = '#9ca3af';
  g.font = '600 34px system-ui, sans-serif';
  g.fillText('Попробуй обогнать Палыча', 360, 1100);
  return c.toDataURL('image/png');
}

function showListing(entry) {
  const tutorial = Boolean(entry.tutorial);
  const listing = listingFromRef(ctx, entry);
  track('listing_view', { model: listing.modelId, seller: listing.sellerId, ask: listing.ask, rarity: listing.rarity, tutorial });
  if (params.has('debug')) globalThis.__nbnk = { app, ctx, listing, save: () => save };
  go(mountListing, {
    ctx, listing, tutorial,
    garageFull: freeSlots(save.garage, capital(), ctx.config) <= 0,
    onBack: tutorial ? null : () => app.show.feed(),
    onStart: () => startInspection(entry, listing),
  });
}

function startInspection(entry, listing) {
  const tutorial = Boolean(entry.tutorial);
  if (!tutorial) {
    app.syncInsp();
    const s = spendInspection(save.insp, nowMs(), ctx.config);
    if (!s) {
      app.getInspectionByAd(() => {
        if (save.insp.n > 0) startInspection(entry, listing);
      });
      return;
    }
    save.insp = s;
    entry.st = 'done';
    persistNow();
  }
  const rng = mulberry32(hash32(`${entry.seed}|insp|${save.stats.inspections}`));
  go(mountInspection, {
    ctx, listing, save, rng, tutorial,
    adHint: (grant, done) => adPrompt(app, 'no_hints', {
      title: 'Подсказки закончились',
      text: 'Посмотрите короткую рекламу, и Палыч подскажет ещё раз.',
      button: 'Получить подсказку',
    }, grant, done),
    adProbeika: (grant, done) => adPrompt(app, 'no_probeika', {
      title: 'Жетоны Пробейки закончились',
      text: 'Новый жетон появится завтра в 00:00 по Москве. Или получите дополнительный за короткую рекламу.',
      button: 'Получить жетон',
    }, grant, done),
    onFinish: (res) => toBargain(entry, listing, rng, res),
  });
}

function toBargain(entry, listing, rng, res) {
  const tutorial = Boolean(entry.tutorial);
  if (res.reason === 'trap') {
    settle(entry, listing, res.insp, { status: 'trap_exit' });
    return;
  }
  const returnLeft = adRemaining(save.ad, 'seller_return', mskDayKey(nowMs()), ctx.config) > 0;
  go(mountBargain, {
    ctx, listing, insp: res.insp, save, rng, tutorial,
    garageFull: freeSlots(save.garage, capital(), ctx.config) <= 0,
    adSellerReturn: !tutorial && returnLeft
      ? (grant) => adPrompt(app, 'seller_return', {
        title: 'Вернуть продавца',
        text: 'Продавец ушёл, но за короткую рекламу его можно вернуть и поторговаться ещё раз. Один раз в сутки.',
        button: 'Вернуть продавца',
      }, grant)
      : null,
    onDone: (outcome) => settle(entry, listing, res.insp, outcome),
  });
}

/** Итог сделки: деньги, репутация, гараж, сохранение, затем «Итог покупки». */
function settle(entry, listing, insp, outcome) {
  const rep = ctx.config.reputation;
  const tutorial = Boolean(entry.tutorial);
  let xp = 0;
  if (outcome.status === 'bought') {
    save.money -= outcome.price;
    save.stats.purchases += 1;
    const ref = tutorial ? { seed: entry.seed, tutorial: true } : { seed: entry.seed, rep: entry.rep, seg: entry.seg, rar: entry.rar };
    const parked = parkCar(save.garage, { ref, listing, paid: outcome.price, found: Object.keys(insp.found), now: nowMs() });
    save.garage = parked.garage;
    entry.st = 'bought';
    xp += rep.deal;
    if (listing.rarity !== 'common') xp += rep.rareCar;
    track('purchase', { price: outcome.price, v0: listing.v0, discount: listing.ask - outcome.price, trap: listing.trap, rarity: listing.rarity, tutorial });
    if (listing.trap) track('purchase_trap', { id: listing.trap });
    play('cash');
  } else {
    save.stats.leaves += 1;
    if (tutorial) track('tutorial_retry');
  }
  const solved = Object.keys(insp.solved).filter((id) => ctx.defectById[ctx.schemeById[id].result].type !== 'trap').length;
  xp += solved * rep.scheme;
  save.stats.schemes += solved;
  if (insp.trapDetected && outcome.status !== 'bought') xp += rep.trapAvoided;
  save.repXp += xp;
  persistNow();
  moneyChanged();
  const summary = buildSummary(ctx, listing, insp, outcome);
  go(mountSummary, {
    ctx, listing, summary, outcome, gain: { xp }, save, tutorial,
    onNext: async (to) => {
      if (outcome.status === 'bought') await maybeInterstitial();
      if (tutorial && outcome.status !== 'bought') { startTutorial(false); return; }
      if (to === 'garage') app.show.garage();
      else app.show.feed();
    },
  });
}

function startTutorial(withIntro = true) {
  track('tutorial_start');
  const entry = { ...TUTORIAL_ENTRY };
  go(mountListing, { ctx, listing: listingFromRef(ctx, entry), tutorial: true, onStart: () => startInspection(entry, listingFromRef(ctx, entry)) });
  if (!withIntro) return;
  // знакомство: Палыч у гаража
  const go2 = h('button', { class: 'btn', text: 'Поехали', onClick: () => close() });
  const intro = h('div', { class: 'intro' },
    h('div', { class: 'pal-dlg' },
      palych('good', 64),
      h('div', {}, h('p', {}, h('b', { text: 'Палыч: ' }), 'Здорово! Я тридцать лет гонял машины. Ушёл на пенсию, гараж оставляю тебе. Научу не попадаться на скрутки, ДТП и утопленников.'), go2)));
  const close = showNode(intro);
}

// ---------------- запуск ----------------

async function boot() {
  try {
    ctx = await loadAll();
  } catch (err) {
    host.replaceChildren(h('div', { class: 'overlay', style: { position: 'relative', height: '100%' } },
      h('div', { class: 'ico', text: '⚠️' }),
      h('h1', { text: 'Не удалось загрузить игру' }),
      h('p', { text: 'Откройте игру по ссылке или запустите локальный сервер: npm start, затем http://localhost:8000. Из файла напрямую (file://) браузер не даёт читать данные.' })));
    console.error(err);
    return;
  }
  initTrack(ctx.config.analytics);
  preloadArt(ctx);
  const platform = await initPlatform();
  if (params.has('reset')) resetSave();
  const cloud = platform.isVK ? await cloudGet() : null;
  save = loadSave(ctx.config, cloud);
  if (params.has('seed')) save.playerSeed = Number(params.get('seed')) >>> 0;
  if (params.has('money')) save.money = Number(params.get('money'));
  if (params.has('skiptutorial')) save.tutorialDone = true;
  save.stats.sessions += 1;
  save.firstSessionAt ||= nowMs();
  setSoundEnabled(save.settings.sound);
  track('session_start', { vk: platform.isVK, sessions: save.stats.sessions });
  if (params.has('debug')) globalThis.__nbnk = { app, ctx, save: () => save };
  persistNow();
  renderTopbar();
  if (tutorialActive()) {
    if (save.garage.cars.length) app.show.garage();
    else startTutorial();
  } else {
    app.show.feed();
    checkUnlocks();
  }
}

boot();
