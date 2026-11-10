// Попадание тапа в зоны. Зона: {id, x, y, w, h} в процентах картинки, x и y — центр.
// Минимальный размер зоны на экране 44×44 pt: если нарисованная зона меньше,
// область тапа расширяется до 44 pt. При пересечении выигрывает ближайшая к центру.

export const MIN_TOUCH_PT = 44;

/**
 * @param zones список зон
 * @param px, py точка тапа в процентах картинки
 * @param widthPt, heightPt размер картинки на экране в pt
 */
export function hitZone(zones, px, py, widthPt, heightPt, minPt = MIN_TOUCH_PT) {
  const minHalfW = (minPt / 2 / widthPt) * 100;
  const minHalfH = (minPt / 2 / heightPt) * 100;
  let best = null;
  let bestDist = Infinity;
  for (const z of zones) {
    const halfW = Math.max(z.w / 2, minHalfW);
    const halfH = Math.max(z.h / 2, minHalfH);
    const dx = (px - z.x) / halfW;
    const dy = (py - z.y) / halfH;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      best = z;
      bestDist = dist;
    }
  }
  return best;
}
