// Слой платформы. Внутри ВКонтакте работает через VK Bridge, вне ВК (разработка, плейтест по ссылке)
// подставляет безопасные заглушки: игра запускается и проходится целиком и там и там.
//
// Сверено с документацией dev.vk.ru:
//   VKWebAppStorageSet: ключ до 100 символов [a-zA-Z_\-0-9], значение до 4096 байт (лишнее обрезается),
//     до 1000 переменных на игрока и не больше 1000 вызовов в час на игрока.
//   VKWebAppCheckNativeAds: ad_format 'reward' | 'interstitial', ответ { result }.
//   VKWebAppShowStoryBox: background_type обязателен; blob (base64 с префиксом data:image/png;base64,) только для image.
// НЕ сверено (страницы документации недоступны из этой среды), проверить перед модерацией:
//   точные параметры и коды ошибок VKWebAppShowNativeAds, а также VKWebAppShare и VKWebAppAllowNotifications.

const params = new URLSearchParams(globalThis.location?.search ?? '');
export const isVK = params.has('vk_app_id') || params.has('vk_platform');

let bridge = null;
const CLOUD_MIN_GAP_MS = 30_000; // лимит ВК: 1000 вызовов в час, поэтому пишем в облако не чаще раза в 30 секунд

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не загрузился ' + src));
    document.head.append(s);
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`${label}: таймаут`)), ms))]);
}

/** Инициализация платформы. Вне ВК ничего не делает. */
export async function initPlatform() {
  if (!isVK) return { isVK: false };
  try {
    await loadScript('vendor/vk-bridge.min.js');
    bridge = globalThis.vkBridge;
    await withTimeout(bridge.send('VKWebAppInit'), 4000, 'VKWebAppInit');
    return { isVK: true, platform: params.get('vk_platform'), appId: params.get('vk_app_id') };
  } catch (err) {
    console.warn('[vk] инициализация не удалась, играем без платформы', err);
    bridge = null;
    return { isVK: false, error: String(err) };
  }
}

// ---------------- облачное хранилище ----------------

/** Прочитать сохранение из облака: возвращает карту ключей {sv_n, sv_0, ...} или null. */
export async function cloudGet() {
  if (!bridge) return null;
  try {
    const head = await withTimeout(bridge.send('VKWebAppStorageGet', { keys: ['sv_n'] }), 4000, 'StorageGet');
    const n = Number(head.keys?.find((k) => k.key === 'sv_n')?.value);
    if (!n) return null;
    const keys = Array.from({ length: n }, (_, i) => `sv_${i}`);
    const res = await withTimeout(bridge.send('VKWebAppStorageGet', { keys: ['sv_n', ...keys] }), 4000, 'StorageGet');
    return Object.fromEntries(res.keys.map((k) => [k.key, k.value]));
  } catch (err) {
    console.warn('[vk] чтение облака не удалось', err);
    return null;
  }
}

let pending = null;
let lastFlush = 0;
let flushTimer = null;

async function flush() {
  if (!bridge || !pending) return;
  const map = pending;
  pending = null;
  lastFlush = Date.now();
  for (const [key, value] of Object.entries(map)) {
    try {
      await bridge.send('VKWebAppStorageSet', { key, value });
    } catch (err) {
      console.warn('[vk] запись в облако не удалась', key, err);
      pending = pending ?? map; // повторим при следующей записи
      return;
    }
  }
}

/** Поставить сохранение в очередь облака (не чаще раза в 30 секунд). */
export async function cloudSet(map) {
  if (!bridge) return;
  pending = map;
  const wait = Math.max(0, lastFlush + CLOUD_MIN_GAP_MS - Date.now());
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, wait);
}

/** Записать сразу (уход из игры, важные события). */
export async function cloudFlush() {
  clearTimeout(flushTimer);
  await flush();
}

globalThis.addEventListener?.('pagehide', () => {
  cloudFlush();
});
globalThis.document?.addEventListener?.('visibilitychange', () => {
  if (document.visibilityState === 'hidden') cloudFlush();
});

// ---------------- реклама ----------------

/** Тестовая реклама вне ВК: затемнение с обратным отсчётом и кнопкой «Закрыть». */
function mockAd(format) {
  return new Promise((resolve) => {
    const layer = document.getElementById('layer') ?? document.body;
    const box = document.createElement('div');
    box.className = 'overlay';
    box.style.zIndex = 120;
    box.innerHTML = `<div class="ico">📺</div><h1>Реклама (тест)</h1><p>${format === 'reward' ? 'Досмотрите до конца, чтобы получить награду' : 'Межстраничная реклама'}</p>`;
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.style.width = '220px';
    btn.disabled = true;
    let left = 2;
    btn.textContent = `Ждите ${left}…`;
    const tick = setInterval(() => {
      left -= 1;
      if (left > 0) btn.textContent = `Ждите ${left}…`;
      else {
        clearInterval(tick);
        btn.disabled = false;
        btn.textContent = 'Закрыть';
      }
    }, 1000);
    btn.addEventListener('click', () => {
      box.remove();
      resolve('ok');
    });
    box.append(btn);
    layer.append(box);
  });
}

export async function adAvailable(format) {
  if (!bridge) return true;
  try {
    const r = await withTimeout(bridge.send('VKWebAppCheckNativeAds', { ad_format: format }), 4000, 'CheckNativeAds');
    return Boolean(r?.result);
  } catch {
    return false;
  }
}

async function showAd(format) {
  if (!bridge) return mockAd(format);
  if (!(await adAvailable(format))) return 'unavailable';
  try {
    const r = await bridge.send('VKWebAppShowNativeAds', { ad_format: format });
    return r?.result ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}

/** Реклама за награду. Награду выдавать только при 'ok'. */
export const showRewarded = () => showAd('reward');
/** Межстраничная реклама. */
export const showInterstitial = () => showAd('interstitial');

// ---------------- шеринг и уведомления ----------------

/** Поделиться карточкой сделки как историей. dataUrl: PNG в формате data:image/png;base64,... */
export async function shareStory(dataUrl, filename = 'deal.png') {
  if (bridge) {
    try {
      await bridge.send('VKWebAppShowStoryBox', { background_type: 'image', blob: dataUrl });
      return 'ok';
    } catch {
      return 'fail';
    }
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
  return 'downloaded';
}

export async function shareLink(link) {
  if (!bridge) return 'unavailable';
  try {
    await bridge.send('VKWebAppShare', { link });
    return 'ok';
  } catch {
    return 'fail';
  }
}

/** Запрос разрешения на уведомления: после первой продажи. */
export async function allowNotifications() {
  if (!bridge) return 'unavailable';
  try {
    const r = await bridge.send('VKWebAppAllowNotifications');
    return r?.result ? 'ok' : 'fail';
  } catch {
    return 'fail';
  }
}
