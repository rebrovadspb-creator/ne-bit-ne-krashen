// Простые звуки на WebAudio, без файлов. Кнопка отключения звука обязательна для ВК;
// настройка хранится в сохранении (save.settings.sound).

let audio = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = Boolean(on);
}

export function isSoundEnabled() {
  return enabled;
}

const SOUNDS = {
  click: [[520, 0.04, 'square', 0.04]],
  find: [[660, 0.07, 'triangle', 0.1], [880, 0.1, 'triangle', 0.1]],
  clue: [[520, 0.08, 'sine', 0.1], [620, 0.1, 'sine', 0.1]],
  nothing: [[220, 0.06, 'sine', 0.05]],
  scheme: [[523, 0.1, 'triangle', 0.12], [659, 0.1, 'triangle', 0.12], [784, 0.18, 'triangle', 0.14]],
  ok: [[600, 0.06, 'triangle', 0.1], [800, 0.1, 'triangle', 0.1]],
  no: [[260, 0.1, 'sawtooth', 0.06], [200, 0.14, 'sawtooth', 0.06]],
  cash: [[784, 0.08, 'square', 0.06], [988, 0.08, 'square', 0.06], [1319, 0.2, 'square', 0.06]],
  unlock: [[523, 0.1, 'triangle', 0.1], [784, 0.1, 'triangle', 0.1], [1047, 0.22, 'triangle', 0.12]],
  coin: [[988, 0.06, 'square', 0.06], [1319, 0.16, 'square', 0.06]],
};

export function play(name) {
  if (!enabled) return;
  try {
    audio = audio ?? new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    let t = audio.currentTime;
    for (const [freq, dur, type, vol] of SOUNDS[name] ?? []) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur * 0.9;
    }
  } catch {
    /* звук необязателен */
  }
}
