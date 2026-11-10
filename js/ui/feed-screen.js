// Лента: 5 объявлений на сутки + закрытое из следующего сегмента, осмотры, обновление по рекламе.

import { h, fmtDuration } from './dom.js';
import { fmtRub, fmtKm } from '../economy.js';
import { listingFromEntry } from '../feed.js';
import { msToNextInspection } from '../limits.js';
import { adRemaining } from '../ads.js';
import { msUntilMskMidnight, mskDayKey } from '../clock.js';
import { carImg, ico, segIcon } from './art.js';
import { navBar } from './nav.js';
import { toast } from './layer.js';

export function mountFeed(host, app) {
  const { ctx, save } = app;
  const cfg = ctx.config;
  const body = h('div', { class: 'hub-body' });
  const root = h('section', { class: 'screen hub feed-bg' }, body, navBar('feed', app));
  host.append(root);
  let timer = null;

  function render() {
    app.ensureDay();
    const now = app.now();
    const feed = save.feed;
    const insp = save.insp;
    const dayKey = mskDayKey(now);
    const adLeft = adRemaining(save.ad, 'feed_refresh', dayKey, cfg);
    const capital = app.capital();

    const kids = [
      h('div', { class: 'statrow' },
        h('div', { class: 'stat' }, h('div', { class: 'l' }, ico('inspect', 16), ' Осмотры'), h('div', { class: 'v', id: 'insp-n', text: `${insp.n} из ${cfg.inspections.perDay}` }),
          h('div', { class: 's', id: 'insp-t', text: insp.n >= cfg.inspections.perDay ? 'полный запас' : `+1 через ${fmtDuration(msToNextInspection(insp, now))}` })),
        h('div', { class: 'stat' }, h('div', { class: 'l' }, ico('timer', 16), ' Новая лента'), h('div', { class: 'v', id: 'feed-t', text: fmtDuration(msUntilMskMidnight(now)) }),
          h('div', { class: 's', text: 'в 00:00 по Москве' }))),
      insp.n <= 0 ? h('button', { class: 'btn secondary small', onClick: () => app.getInspectionByAd(render) }, ico('ad_play', 20), ' +1 осмотр за рекламу') : null,
    ];

    feed.entries.forEach((entry) => {
      const l = listingFromEntry(ctx, entry);
      const model = ctx.modelById[l.modelId];
      const done = entry.st !== 'new';
      kids.push(h('button', { class: `fcard ${done ? 'done' : ''} ${l.rarity !== 'common' ? 'rare' : ''}`, onClick: () => {
        if (done) { toast(entry.st === 'bought' ? 'Эту машину вы уже купили' : 'Это объявление вы уже осмотрели', 1800); return; }
        app.sound('click');
        app.show.listing(entry);
      } },
        h('div', { class: 'thumb' }, carImg(model, l)),
        h('div', { class: 'info' },
          h('div', { class: 'nm' }, `${l.modelName}, ${l.year}`,
            l.rarity !== 'common' ? h('span', { class: 'tag', text: '★ редкая' }) : null,
            entry.st === 'bought' ? h('span', { class: 'tag done', text: 'куплена' }) : entry.st === 'done' ? h('span', { class: 'tag done', text: 'осмотрена' }) : null),
          h('div', { class: 'pr', text: fmtRub(l.ask) }),
          h('div', { class: 'sub', text: `${fmtKm(l.statedMileage)} · ${ctx.sellerById[l.sellerId].name}` }))));
    });

    if (feed.teaser) {
      const t = feed.teaser;
      const l = listingFromEntry(ctx, t);
      const open = capital >= t.unlockCapital;
      kids.push(h('div', { class: 'fcard locked' },
        h('div', { class: 'thumb' }, carImg(ctx.modelById[l.modelId], l)),
        h('div', { class: 'info' },
          h('div', { class: 'nm' }, segIcon(t.seg[0], 22), ` 🔒 ${t.segmentName}`),
          h('div', { class: 'sub', text: open ? 'Откроется в завтрашней ленте' : `Откроется при капитале ${fmtRub(t.unlockCapital)}` }),
          h('div', { class: 'sub', text: `Сейчас у вас ${fmtRub(capital)}` }))));
    }

    kids.push(h('button', { class: 'btn secondary small', disabled: adLeft <= 0, onClick: () => app.refreshFeedByAd(render) }, adLeft > 0 ? [ico('ad_play', 20), ' Обновить ленту за рекламу (1 раз в день)'] : 'Лента уже обновлена сегодня'));
    body.replaceChildren(...kids.filter(Boolean));
  }

  function tick() {
    const now = app.now();
    if (save.feed.dayKey !== mskDayKey(now)) { render(); return; }
    const insp = save.insp;
    const n = root.querySelector('#insp-n');
    if (!n) return;
    const before = save.insp.n;
    app.syncInsp();
    if (save.insp.n !== before) { render(); return; }
    root.querySelector('#insp-t').textContent = save.insp.n >= cfg.inspections.perDay ? 'полный запас' : `+1 через ${fmtDuration(msToNextInspection(insp, now))}`;
    root.querySelector('#feed-t').textContent = fmtDuration(msUntilMskMidnight(now));
  }

  render();
  timer = setInterval(tick, 1000);
  return { destroy() { clearInterval(timer); root.remove(); } };
}
