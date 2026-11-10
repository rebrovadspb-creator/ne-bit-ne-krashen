// Экран осмотра. Читает объявление (listing), данные дефектов и зон берёт из ctx.
// Вся логика находок лежит в inspection-core.js; здесь только отрисовка и тапы.

import { h } from './dom.js';
import { carSrc, ico } from './art.js';
import { popup, toast, tip, show, flash, anchorOf } from './layer.js';
import { decalSpec } from './decals.js';
import { fmtRub } from '../economy.js';
import { DOC_ORDER } from '../listing.js';
import {
  newInspection, inspectZone, inspectRow, useProbeika, probeikaReport,
  pickHintTarget, useHint, foundCount, totalArgumentsRub,
} from '../inspection-core.js';
import { hitZone } from '../zones.js';
import { persist } from '../store.js';
import { track } from '../track.js';

const DOC_IMG = { pts: 'assets/doc-pts.webp', service: 'assets/doc-service.webp', odometer: 'assets/doc-odometer.webp' };
const DOC_TITLE = { pts: 'ПТС', service: 'Сервисная книжка', odometer: 'Одометр' };

export function mountInspection(host, env) {
  const { ctx, listing, save, rng } = env;
  const cfg = ctx.config;
  const model = ctx.modelById[listing.modelId];
  const tutorial = Boolean(env.tutorial);

  let insp = newInspection(cfg);
  let view = 'exterior';
  let timeLeft = cfg.inspection.durationSec;
  let timerId = null;
  let paused = false;
  let phase = tutorial ? 'tutorial1' : 'playing';
  let closers = []; // функции закрытия открытых оверлеев
  let tutorialEls = [];

  const zonesFor = (v) => (v === 'exterior' ? model.zones : model.interiorZones ?? []);

  // ---------- каркас ----------
  const pillFound = h('div', { class: 'v', text: '0' });
  const pillTime = h('div', { class: 'v', text: '03:00' });
  const pauseBtn = h('button', { class: 'icon-btn', text: '⏸', 'aria-label': 'Пауза', onClick: () => pause() });
  const hud = h('div', { class: 'hud' },
    h('div', { class: 'pill' }, h('div', { class: 'l', text: 'Найдено' }), pillFound),
    h('div', { class: 'pill' }, h('div', { class: 'l', text: 'Время' }), pillTime),
    pauseBtn);

  const tabExt = h('button', { class: 'tab on', text: 'Кузов', onClick: () => setView('exterior') });
  const tabInt = h('button', { class: 'tab', text: 'Салон', onClick: () => setView('interior') });
  const tabs = h('div', { class: 'tabs' }, tabExt, tabInt);
  const shadow = h('div', { class: 'ground-shadow' });
  const img = h('img', { class: 'car-img', alt: '', draggable: 'false' });
  const decals = h('div', { class: 'decals' });
  const marks = h('div', { class: 'marks' });
  const carInner = h('div', { class: 'car-inner' }, shadow, img, decals, marks);
  const scene = h('div', { class: 'scene' }, tabs, carInner);

  const docBtns = {};
  const shelf = h('div', { class: 'shelf' }, ...DOC_ORDER.map((id) => {
    const b = h('button', { class: 'doc', 'aria-label': DOC_TITLE[id], onClick: () => openDoc(id) },
      h('img', { src: DOC_IMG[id], alt: DOC_TITLE[id], draggable: 'false' }));
    docBtns[id] = b;
    return b;
  }));

  const argsVal = h('div', { class: 'v', text: fmtRub(0) });
  const hintBadge = h('span', { class: 'badge', text: String(insp.hintsLeft) });
  const hintBtn = h('button', { class: 'icon-btn', 'aria-label': 'Палыч подскажет', onClick: () => useHintClick() }, ico('tip', 30), hintBadge);
  const probeBadge = h('span', { class: 'badge', text: String(save.probeika.tokens) });
  const probeBtn = h('button', { class: 'icon-btn', 'aria-label': 'Пробейка', onClick: () => probeikaClick() }, ico('checklist', 30), probeBadge);
  const finishBtn = h('button', { class: 'btn', text: 'К торгу →', onClick: () => finishClick() });
  const bottom = h('div', { class: 'bottom' },
    h('div', { class: 'row' },
      h('div', { class: 'args' }, h('div', { class: 'l', text: 'Аргументов в торге' }), argsVal),
      h('div', { class: 'tool' }, hintBtn, h('span', { class: 'cap', text: 'Палыч подскажет' })),
      h('div', { class: 'tool' }, probeBtn, h('span', { class: 'cap', text: 'Пробейка' }))),
    finishBtn);

  const root = h('section', { class: 'screen inspection' }, hud, scene, shelf, bottom);
  host.append(root);

  // ---------- отрисовка ----------
  function renderView() {
    scene.classList.toggle('interior', view === 'interior');
    img.src = view === 'exterior' ? carSrc(model, listing, 'main') : model.art.interior;
    shadow.style.display = 'none'; // тень уже нарисована в картинке машины
    tabExt.classList.toggle('on', view === 'exterior');
    tabInt.classList.toggle('on', view === 'interior');
    renderMarks();
  }

  function renderMarks() {
    decals.replaceChildren();
    marks.replaceChildren();
    for (const z of zonesFor(view)) {
      const content = listing.zones[view][z.id];
      if (content) {
        const kind = content.decal ?? (content.defectId ? ctx.defectById[content.defectId].decal : null);
        const spec = kind && decalSpec(kind);
        if (spec) {
          const style = { left: z.x + '%', top: z.y + '%' };
          if (spec.full) {
            style.width = z.w + '%';
            style.height = z.h + '%';
          } else {
            style.width = spec.size[0] + 'px';
            style.height = spec.size[1] + 'px';
          }
          decals.append(h('div', { class: 'decal', html: spec.svg, style }));
        }
      }
      if (insp.tappedZones[view][z.id]) {
        let cls = 'empty';
        let txt = '';
        if (content?.defectId && insp.found[content.defectId]) { cls = 'defect'; txt = '✓'; }
        else if (content?.clueId && insp.clues[content.clueId]) { cls = 'clue'; txt = '?'; }
        marks.append(h('div', { class: `mark ${cls}`, text: txt, style: { left: z.x + '%', top: z.y + '%' } }));
      }
    }
  }

  function renderHud() {
    const n = foundCount(insp);
    pillFound.textContent = tutorial ? `${n} из ${listing.findings.length}` : String(n);
    argsVal.textContent = fmtRub(totalArgumentsRub(insp, ctx, listing));
    hintBadge.textContent = String(insp.hintsLeft);
    hintBtn.disabled = insp.hintsLeft <= 0 && !env.adHint;
    probeBadge.textContent = insp.probeikaUsed ? '✓' : String(save.probeika.tokens);
    probeBtn.disabled = !insp.probeikaUsed && save.probeika.tokens <= 0 && !env.adProbeika;
    if (insp.trapDetected) {
      finishBtn.textContent = `Уйти (+${cfg.reputation.trapAvoided} репутации)`;
      finishBtn.classList.add('danger');
    }
    for (const id of DOC_ORDER) {
      const done = listing.docs[id].rows.filter((r) => !r.info).every((r) => insp.tappedRows[`${id}.${r.id}`]);
      const has = docBtns[id].querySelector('.badge-ok');
      if (done && !has) docBtns[id].append(h('div', { class: 'badge-ok', text: '✓' }));
    }
  }

  function renderTime() {
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    pillTime.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    pillTime.classList.toggle('danger', timeLeft <= 30);
  }

  function setView(v) {
    if (v === view || phase === 'tutorial1' || phase === 'tutorial2') return;
    view = v;
    renderView();
  }

  // ---------- тапы по сцене ----------
  carInner.addEventListener('pointerup', (ev) => {
    if (paused || (phase !== 'playing' && phase !== 'tutorial2')) return;
    const r = carInner.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * 100;
    const py = ((ev.clientY - r.top) / r.height) * 100;
    const zone = hitZone(zonesFor(view), px, py, r.width, r.height);
    if (!zone) return;
    const anchor = { x: r.left + (zone.x / 100) * r.width, y: r.top + (zone.y / 100) * r.height - 18 };
    track('zone_tap', { zone: zone.id, view });
    const res = inspectZone(insp, ctx, listing, view, zone.id);
    insp = res.state;
    handleEvents(res.events, anchor);
    renderMarks();
    renderHud();
  });

  function handleEvents(events, anchor) {
    const scheme = events.find((e) => e.type === 'scheme');
    if (scheme) {
      showScheme(scheme);
      return;
    }
    let i = 0;
    for (const e of events) {
      if (e.type === 'defect') {
        const def = ctx.defectById[e.defectId];
        if (e.trap) {
          popup(anchor, { title: def.name, sub: 'Ловушка! Торг невозможен', kind: 'bad' }, i++);
          onTrap(def);
        } else {
          popup(anchor, { title: def.name, sub: `Аргумент в торге: −${fmtRub(e.argRub)}` }, i++);
        }
        track('defect_found', { id: e.defectId, via: e.via });
        if (phase === 'tutorial2') advanceTutorial();
      } else if (e.type === 'clue') {
        popup(anchor, { title: 'Улика найдена', sub: e.text, kind: 'clue' }, i++);
        track('clue_found', { id: e.clueId });
      } else if (e.type === 'nothing' && cfg.inspection.emptyZoneFeedback) {
        popup(anchor, { title: 'Здесь всё в порядке', kind: 'mute' }, i++);
      }
    }
  }

  function showScheme(e) {
    const scheme = ctx.schemeById[e.schemeId];
    const def = ctx.defectById[e.defectId];
    track('scheme_solved', { id: e.schemeId, trap: e.trap });
    closers.forEach((c) => c()); // шторка документа закрывается: карточка схемы важнее
    closers = [];
    flash();
    const reveal = scheme.reveal
      .replace('{real}', Math.round(listing.realMileage).toLocaleString('ru-RU'))
      .replace('{stated}', Math.round(listing.statedMileage).toLocaleString('ru-RU'));
    const card = h('div', { class: `card ${e.trap ? 'trap' : ''}` },
      h('h3', { text: `⚡ ${scheme.title}` }),
      h('div', { class: 'l1', text: reveal }),
      e.trap ? null : h('div', { class: 'l2', text: `+${fmtRub(e.argRub)} к аргументам в торге` }),
      h('div', { class: 'note', html: `<b>Палыч:</b> «${scheme.palych}»` }),
      h('div', { class: 'go', text: 'Нажмите, чтобы продолжить' }));
    const ov = h('div', { class: 'overlay light', style: { zIndex: 82 } }, card);
    const close = show(ov);
    closers.push(close);
    ov.addEventListener('click', () => {
      close();
      closers = closers.filter((c) => c !== close);
      if (e.trap) onTrap(def);
    });
    renderMarks();
    renderHud();
  }

  function onTrap(def) {
    track('trap_detected', { id: def.id });
    toast(`Ловушка: ${def.name}. Торг невозможен, лучше уйти`, 3200);
  }

  // ---------- документы ----------
  function openDoc(docId) {
    if (phase !== 'playing' && phase !== 'tutorial3') return;
    track('doc_opened', { doc: docId });
    const doc = listing.docs[docId];
    const sheet = h('div', { class: 'sheet' });
    const wrap = h('div', { class: 'sheet-wrap' }, sheet);
    const close = show(wrap);
    const doClose = () => {
      close();
      closers = closers.filter((c) => c !== doClose);
    };
    closers.push(doClose);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) doClose(); });

    function render() {
      sheet.replaceChildren(
        h('div', { class: 'sheet-head' }, h('h2', { text: doc.title }), h('button', { class: 'x', text: '✕', 'aria-label': 'Закрыть', onClick: doClose })),
        h('div', { class: 'page' }, doc.rows.map((row) => {
          const key = `${docId}.${row.id}`;
          const tapped = row.info || insp.tappedRows[key];
          const defect = tapped && row.defectId && insp.found[row.defectId];
          const clue = tapped && row.clueId && insp.clues[row.clueId] && !defect;
          const cls = ['drow', row.info ? 'info' : '', tapped ? '' : 'hidden', defect ? 'defect' : '', clue ? 'clue' : ''].join(' ');
          const el = h(row.info ? 'div' : 'button', { class: cls, onClick: row.info ? null : (ev) => tapRow(row, ev.currentTarget) },
            h('div', { class: 'k', text: row.label }),
            h('div', { class: 'v', text: tapped ? row.value : 'Тапните, чтобы проверить' }));
          return el;
        })));
    }

    function tapRow(row, el) {
      const anchor = anchorOf(el); // до перерисовки: после render элемент уже другой
      const res = inspectRow(insp, ctx, listing, docId, row.id);
      insp = res.state;
      render();
      renderHud();
      handleEvents(res.events.filter((e) => e.type !== 'reveal'), anchor);
    }
    render();
  }

  // ---------- подсказки и Пробейка ----------
  function useHintClick() {
    if (paused || phase !== 'playing') return;
    if (insp.hintsLeft <= 0) {
      paused = true;
      env.adHint?.(() => { insp = { ...insp, hintsLeft: insp.hintsLeft + 1 }; renderHud(); }, () => { paused = false; });
      return;
    }
    const target = pickHintTarget(insp, listing, rng);
    if (!target) {
      toast('Палыч: «Больше тут искать нечего. Иди торгуйся»', 2600);
      return;
    }
    insp = useHint(insp);
    renderHud();
    track('hint_used', { target: target.kind });
    const ms = cfg.inspection.hintSec * 1000;
    if (target.kind === 'doc') {
      const b = docBtns[target.id];
      b.classList.add('hint-pulse');
      setTimeout(() => b.classList.remove('hint-pulse'), ms);
    } else if (target.view !== view) {
      const t = target.view === 'interior' ? tabInt : tabExt;
      t.classList.add('hint-pulse');
      setTimeout(() => t.classList.remove('hint-pulse'), ms);
    } else {
      const z = zonesFor(view).find((x) => x.id === target.id);
      const ring = h('div', { class: 'hint-ring', style: { left: z.x + '%', top: z.y + '%' } });
      carInner.append(ring);
      setTimeout(() => ring.remove(), ms);
    }
  }

  function showReport() {
    const lines = probeikaReport(ctx, listing);
    const sheet = h('div', { class: 'sheet' });
    const wrap = h('div', { class: 'sheet-wrap' }, sheet);
    const close = show(wrap);
    const doClose = () => {
      close();
      closers = closers.filter((c) => c !== doClose);
    };
    closers.push(doClose);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) doClose(); });
    sheet.append(
      h('div', { class: 'sheet-head' }, h('h2', { text: '📋 Отчёт Пробейки' }), h('button', { class: 'x', text: '✕', 'aria-label': 'Закрыть', onClick: doClose })),
      h('div', { class: 'page' }, lines.map((l) => h('div', { class: 'report-line' },
        h('span', { text: l.label }), h('span', { class: l.hit ? 'bad' : 'ok', text: (l.hit ? '⚠ ' : '✓ ') + l.text })))));
  }

  function probeikaClick() {
    if (paused || (phase !== 'playing' && phase !== 'tutorial3')) return;
    if (insp.probeikaUsed) {
      showReport();
      return;
    }
    if (save.probeika.tokens <= 0) {
      if (env.adProbeika) {
        paused = true;
        env.adProbeika(() => { save.probeika.tokens += 1; renderHud(); }, () => { paused = false; });
      }
      else toast('Жетонов Пробейки нет. Новый появится завтра в 00:00 по Москве', 2800);
      return;
    }
    save.probeika.tokens -= 1;
    persist(save);
    const res = useProbeika(insp, ctx, listing);
    insp = res.state;
    track('probeika_used', { found: res.events.length });
    renderHud();
    showReport();
    const trapEv = res.events.find((e) => e.type === 'defect' && e.trap);
    if (trapEv) onTrap(ctx.defectById[trapEv.defectId]);
  }

  // ---------- таймер, пауза, завершение ----------
  function startTimer() {
    stopTimer();
    timerId = setInterval(() => {
      if (paused) return;
      timeLeft -= 1;
      renderTime();
      if (timeLeft <= 0) finish('time');
    }, 1000);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function pause() {
    if (phase !== 'playing' || paused) return;
    paused = true;
    const resume = h('button', { class: 'btn', style: { width: '200px' }, text: 'Продолжить', onClick: () => { paused = false; close(); } });
    const close = show(h('div', { class: 'overlay', style: { zIndex: 85 } }, h('h1', { text: 'Пауза' }), resume));
  }

  function finishClick() {
    if (paused || (phase !== 'playing' && phase !== 'tutorial3')) return;
    finish(insp.trapDetected ? 'trap' : 'manual');
  }

  function finish(reason) {
    if (phase === 'done') return;
    phase = 'done';
    stopTimer();
    closers.forEach((c) => c());
    closers = [];
    tutorialEls.forEach((el) => el.remove());
    save.stats.inspections += 1;
    persist(save);
    track('inspection_end', { found: foundCount(insp), reason, timeLeft, probeika: insp.probeikaUsed });
    env.onFinish({ insp, reason, timeLeft });
  }

  // ---------- обучение ----------
  function startTutorial() {
    const start = h('button', { class: 'btn', text: 'Начать осмотр →' });
    const ov = h('div', { class: 'overlay' },
      h('div', { class: 'ico', text: '🔍' }),
      h('h1', { text: 'Вы — перекуп' }),
      h('p', { text: 'Палыч ушёл на пенсию, гараж теперь ваш. Осмотрите машину и документы: каждый найденный дефект станет аргументом в торге.' }),
      start);
    const close = show(ov);
    start.addEventListener('click', () => {
      close();
      phase = 'tutorial2';
      const z = model.zones.find((x) => x.id === 'windshield');
      const ring = h('div', { class: 'hint-ring', style: { left: z.x + '%', top: z.y + '%' } });
      carInner.append(ring);
      const r = carInner.getBoundingClientRect();
      const t = tip('Тапайте по автомобилю, чтобы найти дефекты', r.left + (z.x / 100) * r.width, r.top + (z.y / 100) * r.height - 30);
      tutorialEls = [ring, t];
    });
  }

  async function advanceTutorial() {
    phase = 'tutorial3';
    tutorialEls.forEach((el) => el.remove());
    tutorialEls = [];
    await toast('Дефект найден: это аргумент для торга!', 2300);
    await toast('Не забудьте проверить документы', 2300);
    if (phase === 'tutorial3') {
      phase = 'playing';
      startTimer();
    }
  }

  // ---------- старт ----------
  renderView();
  renderTime();
  renderHud();
  track('inspection_start', { model: listing.modelId, seller: listing.sellerId, tutorial });
  if (tutorial) startTutorial();
  else startTimer();

  return {
    destroy() {
      stopTimer();
      closers.forEach((c) => c());
      tutorialEls.forEach((el) => el.remove());
      root.remove();
    },
  };
}
