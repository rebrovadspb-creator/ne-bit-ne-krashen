// Декали дефектов (плейсхолдеры). Настоящие DEC-xx.png придут от дизайнера:
// тогда этот файл заменится на загрузку картинок по id, интерфейс не изменится.
// size: ширина и высота в pt; full: растянуть на всю зону (деталь другого оттенка).

const DECALS = {
  crack: { size: [44, 36], svg: '<svg viewBox="0 0 40 40"><path d="M4 6 L16 18 L12 22 L26 34 M16 18 L30 10 M20 26 L34 24" stroke="#f1f5f9" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>' },
  dent: { size: [40, 30], svg: '<svg viewBox="0 0 40 40"><ellipse cx="20" cy="20" rx="16" ry="11" fill="rgba(0,0,0,.28)"/><ellipse cx="17" cy="16" rx="9" ry="5" fill="rgba(255,255,255,.22)"/></svg>' },
  chip: { size: [30, 30], svg: '<svg viewBox="0 0 40 40"><circle cx="12" cy="14" r="2.6" fill="#2b3040"/><circle cx="24" cy="22" r="2.2" fill="#2b3040"/><circle cx="18" cy="29" r="1.8" fill="#2b3040"/><circle cx="29" cy="12" r="1.6" fill="#e5e7eb"/></svg>' },
  scratch: { size: [40, 34], svg: '<svg viewBox="0 0 40 40"><path d="M5 31 L31 7 M9 35 L35 11 M14 37 L37 17" stroke="#e5e7eb" stroke-width="1.5" opacity=".85"/></svg>' },
  rust: { size: [44, 30], svg: '<svg viewBox="0 0 40 40"><path d="M6 22 C4 12 18 6 26 10 C36 14 36 28 24 33 C15 37 8 32 6 22Z" fill="#a0522d" opacity=".92"/><circle cx="15" cy="18" r="3" fill="#7c3a1a"/><circle cx="27" cy="25" r="2.4" fill="#c26a35"/></svg>' },
  shade: { full: true, svg: '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="3" y="3" width="94" height="94" rx="16" fill="rgba(255,255,255,.2)" stroke="rgba(255,255,255,.38)" stroke-width="2"/></svg>' },
  darklight: { size: [26, 20], svg: '<svg viewBox="0 0 40 30"><rect x="2" y="3" width="36" height="24" rx="5" fill="#3a1014" stroke="#7f1d1d" stroke-width="2"/></svg>' },
  puddle: { size: [76, 24], svg: '<svg viewBox="0 0 80 30"><ellipse cx="40" cy="15" rx="37" ry="11" fill="rgba(5,6,10,.72)"/><ellipse cx="33" cy="11" rx="15" ry="3.2" fill="rgba(255,255,255,.14)"/></svg>' },
  smoke: { size: [42, 34], svg: '<svg viewBox="0 0 40 40"><circle cx="13" cy="26" r="9" fill="rgba(200,205,215,.5)"/><circle cx="26" cy="17" r="11" fill="rgba(200,205,215,.42)"/></svg>' },
  tire: { size: [40, 24], svg: '<svg viewBox="0 0 40 30"><path d="M4 26 A17 17 0 0 1 36 26" stroke="#e5e7eb" stroke-width="3.5" fill="none" opacity=".6"/></svg>' },
  disc: { size: [32, 32], svg: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="12" fill="none" stroke="#b45309" stroke-width="4.5" opacity=".85"/></svg>' },
  smokeint: { size: [38, 30], svg: '<svg viewBox="0 0 40 40"><circle cx="13" cy="26" r="9" fill="rgba(200,205,215,.5)"/><circle cx="26" cy="17" r="11" fill="rgba(200,205,215,.42)"/></svg>' },
  tear: { size: [48, 24], svg: '<svg viewBox="0 0 40 20"><path d="M2 12 L9 6 L15 15 L23 4 L31 14 L38 8" stroke="#0b0f1a" stroke-width="2.4" fill="none" stroke-linejoin="round"/></svg>' },
  mud: { size: [54, 24], svg: '<svg viewBox="0 0 40 40"><path d="M4 22 C2 12 16 8 26 12 C38 16 38 28 24 33 C14 37 6 32 4 22Z" fill="#6b4a2b" opacity=".9"/></svg>' },
};

/** Описание декали или null, если такого вида нет. */
export function decalSpec(kind) {
  return DECALS[kind] ?? null;
}
