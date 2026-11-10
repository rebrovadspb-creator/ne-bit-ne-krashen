// Аналитика: track(event, params). Пока события пишутся в консоль и копятся в очереди;
// когда в config.json появится analytics.batchUrl, очередь уходит батчами туда.
// Провайдера подключим позже: достаточно заменить flush().

const queue = [];
let settings = { batchUrl: '', batchSize: 20 };

export function initTrack(analyticsCfg) {
  settings = { ...settings, ...analyticsCfg };
}

export function track(event, params = {}) {
  const record = { e: event, t: Date.now(), p: params };
  queue.push(record);
  console.log('[track]', event, params);
  if (settings.batchUrl && queue.length >= settings.batchSize) flush();
}

export function flush() {
  if (!settings.batchUrl || !queue.length) return;
  const body = JSON.stringify(queue.splice(0, queue.length));
  try {
    if (navigator.sendBeacon) navigator.sendBeacon(settings.batchUrl, body);
    else fetch(settings.batchUrl, { method: 'POST', body, keepalive: true });
  } catch {
    /* аналитика не должна ломать игру */
  }
}

/** Для тестов и отладки. */
export function pending() {
  return queue.slice();
}

globalThis.addEventListener?.('pagehide', flush);
