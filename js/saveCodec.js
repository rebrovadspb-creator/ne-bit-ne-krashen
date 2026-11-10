// Сжатие сохранения: JSON → LZW → base64 → куски фиксированной длины.
// Нужно для облачного хранилища ВК (у значения есть лимит длины), localStorage хранит то же самое.

const MAX_CODES = 65536;

function toBytes(str) {
  return new TextEncoder().encode(str);
}

export function lzwEncode(bytes) {
  const dict = new Map();
  let next = 256;
  const out = [];
  let w = '';
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    const wc = w + c;
    if (wc.length === 1 || dict.has(wc)) {
      w = wc;
    } else {
      out.push(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
      if (next < MAX_CODES) dict.set(wc, next++);
      w = c;
    }
  }
  if (w) out.push(w.length === 1 ? w.charCodeAt(0) : dict.get(w));
  return out;
}

export function lzwDecode(codes) {
  if (!codes.length) return new Uint8Array();
  const dict = [];
  const entry = (code) => (code < 256 ? String.fromCharCode(code) : dict[code - 256]);
  let w = entry(codes[0]);
  const parts = [w];
  for (let i = 1; i < codes.length; i++) {
    const k = codes[i];
    const cur = k < 256 || k - 256 < dict.length ? entry(k) : w + w[0];
    parts.push(cur);
    if (256 + dict.length < MAX_CODES) dict.push(w + cur[0]);
    w = cur;
  }
  const s = parts.join('');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function toBase64(codes) {
  const bytes = new Uint8Array(codes.length * 2);
  codes.forEach((c, i) => {
    bytes[2 * i] = c & 255;
    bytes[2 * i + 1] = c >> 8;
  });
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const codes = [];
  for (let i = 0; i + 1 < bin.length; i += 2) codes.push(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8));
  return codes;
}

export function compress(obj) {
  return toBase64(lzwEncode(toBytes(JSON.stringify(obj))));
}

export function decompress(str) {
  return JSON.parse(new TextDecoder().decode(lzwDecode(fromBase64(str))));
}

/** Разбить сохранение на ключи {sv_n, sv_0, sv_1, …}, каждый не длиннее chunk символов. */
export function encodeSave(obj, chunk = 3500) {
  const s = compress(obj);
  const out = {};
  const n = Math.max(1, Math.ceil(s.length / chunk));
  out.sv_n = String(n);
  for (let i = 0; i < n; i++) out[`sv_${i}`] = s.slice(i * chunk, (i + 1) * chunk);
  return out;
}

/** Собрать сохранение из ключей. Вернёт null, если данных нет или они повреждены. */
export function decodeSave(map) {
  try {
    const n = Number(map.sv_n);
    if (!n) return null;
    let s = '';
    for (let i = 0; i < n; i++) {
      if (map[`sv_${i}`] == null) return null;
      s += map[`sv_${i}`];
    }
    return decompress(s);
  } catch {
    return null;
  }
}
