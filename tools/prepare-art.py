#!/usr/bin/env python3
"""Готовит арт для игры из исходников дизайнера: вырезает фон у машин, режет листы иконок и персонажей,
ужимает фоны. Результат кладёт в assets/. Запуск:
    python3 tools/prepare-art.py --zips ПАПКА_С_РАСПАКОВАННЫМИ_АРХИВАМИ --pasted ПАПКА_С_КАРТИНКАМИ_1-11
Ожидается: <zips>/CAR-R1-R4, <zips>/People_Icons, <zips>/Scenes_BG_INS_SC; <pasted>/1.webp ... 11.webp
(1 Палыч у гаража, 2-5 бок, 6-10 «главный» вид: буханка, универсал, седан, хэтчбек, жигули; 11 лист эмоций Палыча).
"""
import argparse
import os
from collections import deque

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')


def save(im, rel, q=84):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=q, method=6)
    print(rel, im.size, os.path.getsize(path) // 1024, 'KB')


def cutout_car(im, width=900, crop=True):
    """Серый фон → прозрачность, тень под машиной → полупрозрачная чёрная."""
    a = np.asarray(im.convert('RGB')).astype(int)
    sat = a.max(2) - a.min(2)
    lum = a.mean(2)
    gray = sat < 14
    light = gray & (lum > 150)
    lab, n = ndi.label(light)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    shadow_candidates = gray & (lum > 40) & (lum <= 150)
    seeds = ndi.binary_dilation(bg, iterations=2)
    shadow = ndi.binary_propagation(seeds & shadow_candidates, mask=shadow_candidates) & ~bg
    # тень: только заметно тёмные пикселя ниже середины кадра (не контуры машины)
    h = a.shape[0]
    shadow[: int(h * 0.55)] = False
    # светлый фон между кузовом и тенью замкнут ими и до края не доходит: добавляем куски, прилегающие к тени
    touch = np.unique(lab[ndi.binary_dilation(shadow, iterations=3) & light])
    bg = bg | np.isin(lab, [t for t in touch if t != 0])
    rgba = np.zeros((a.shape[0], a.shape[1], 4), dtype=np.uint8)
    rgba[..., :3] = a.astype(np.uint8)
    rgba[..., 3] = 255
    rgba[bg, 3] = 0
    rgba[shadow] = (0, 0, 0, 120)
    # лёгкое сглаживание кромки: пиксели у фона получают полупрозрачность
    edge = ndi.binary_dilation(bg, iterations=1) & ~bg & ~shadow
    rgba[edge, 3] = 170
    out = Image.fromarray(rgba, 'RGBA')
    if crop:
        out = out.crop(out.getchannel('A').point(lambda v: 255 if v > 0 else 0).getbbox())
    return out.resize((width, round(out.height * width / out.width)), Image.LANCZOS)


def remove_flat_bg(cell, tol=26):
    """Убрать однотонный светлый фон листа (по цвету угла), связанный с краем кадра."""
    a = np.asarray(cell.convert('RGB')).astype(int)
    ref = np.median(np.concatenate([a[:4, :4].reshape(-1, 3), a[:4, -4:].reshape(-1, 3), a[-4:, :4].reshape(-1, 3), a[-4:, -4:].reshape(-1, 3)]), axis=0)
    near = (np.abs(a - ref).sum(2) < tol * 3)
    lab, _ = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    rgba = np.dstack([a.astype(np.uint8), np.where(bg, 0, 255).astype(np.uint8)])
    edge = ndi.binary_dilation(bg, iterations=1) & ~bg
    rgba[edge, 3] = 190
    return Image.fromarray(rgba, 'RGBA')


def trim(im, pad=4):
    bbox = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        return im
    l, t, r, b = bbox
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))


def fit(im, size):
    im = trim(im)
    s = size / max(im.size)
    im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return canvas


def grid(im, cols, rows):
    w, h = im.size
    for r in range(rows):
        for c in range(cols):
            yield r, c, im.crop((round(c * w / cols), round(r * h / rows), round((c + 1) * w / cols), round((r + 1) * h / rows)))


ICON_NAMES = {
    1: ['cash', 'inspect', 'checklist', 'tip', 'receipt', 'star', 'timer', 'boost', 'ded', 'family', 'taxi', 'perekup', 'rabbit', 'scales', 'coins_up', 'ad_play'],
    2: ['windshield', 'door_dent', 'paint', 'bumper', 'sill_rust', 'repaint', 'crash', 'headlight', 'stoplight', 'oil', 'exhaust', 'odometer', 'tire', 'brakes', 'ashtray', 'seat_torn'],
    3: ['flood', 'keys', 'duplicate', 'taxi_door', 'pledge', 'wanted', 'door', 'xenon', 'engine', 'spring', 'seat', 'folder', 'seg_buckets', 'seg_horses', 'seg_dream', 'seg_premium'],
    4: ['garage', 'tag', 'trophy', 'user', 'gear', 'sound_on', 'sound_off', 'music', 'pause', 'back', 'close', 'share', 'invite', 'gift', 'bell', 'info'],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--zips', required=True)
    ap.add_argument('--pasted', required=True)
    args = ap.parse_args()
    op = lambda *p: Image.open(os.path.join(*p))

    # --- машины: обычные версии из присланных картинок, редкие R1-R4 из архива
    base = {'bukhanka': (6, 2), 'logarifm': (7, 3), 'solyarka': (8, None), 'zubilo': (9, 4), 'kopeika': (10, 5)}
    for model, (main_i, side_i) in base.items():
        save(cutout_car(op(args.pasted, f'{main_i}.webp'), crop=False), f'cars/{model}_main.webp')
        if side_i:
            save(cutout_car(op(args.pasted, f'{side_i}.webp')), f'cars/{model}_side.webp')
    rare = {'kopeika': 'R1', 'zubilo': 'R2', 'solyarka': 'R3', 'logarifm': 'R4'}
    for model, r in rare.items():
        for v in ('main', 'side'):
            save(cutout_car(op(args.zips, 'CAR-R1-R4', f'CAR-{r}_{v}.png'), crop=(v == 'side')), f'cars/{model}_rare_{v}.webp')

    # --- фоны
    sc = os.path.join(args.zips, 'Scenes_BG_INS_SC')
    for name, rel, w in [('BG-01_closed', 'bg/garages_closed', 720), ('BG-01_open', 'bg/garages_open', 720), ('BG-02', 'bg/yard', 720),
                         ('BG-05', 'bg/workshop', 720), ('BG-08', 'bg/market', 720), ('SC-01_board', 'bg/board', 720),
                         ('INS-01_foreign', 'bg/interior_foreign', 720), ('INS-01_soviet', 'bg/interior_soviet', 720)]:
        im = op(sc, name + '.png').convert('RGB')
        save(im.resize((w, round(im.height * w / im.width)), Image.LANCZOS), rel + '.webp', q=78)
    im = op(args.pasted, '1.webp').convert('RGB')
    save(im.resize((720, round(im.height * 720 / im.width)), Image.LANCZOS), 'bg/pal_garage.webp', q=78)

    # --- иконки (листы 4x4)
    pi = os.path.join(args.zips, 'People_Icons')
    for n in range(1, 5):
        sheet = op(pi, f'IC_sheet{n}.png')
        for r, c, cell in grid(sheet, 4, 4):
            save(fit(remove_flat_bg(cell), 128), f'ui/{ICON_NAMES[n][r * 4 + c]}.webp', q=88)

    # --- персонажи: 3 эмоции в строке (нейтрально, согласен, отказ)
    for ch, name in [('CH-02', 'ded'), ('CH-03', 'family'), ('CH-04', 'taxi'), ('CH-05', 'perekup')]:
        sheet = op(pi, f'{ch}_sheet.png')
        for _, c, cell in grid(sheet, 3, 1):
            save(fit(remove_flat_bg(cell), 360), f'chars/{name}_{["neutral", "ok", "no"][c]}.webp', q=86)
    for r, c, cell in grid(op(pi, 'CH-07_sheet.png'), 4, 2):
        save(fit(remove_flat_bg(cell, tol=20), 128), f'chars/buyer{r * 4 + c + 1}.webp', q=88)
    for r, c, cell in grid(op(args.pasted, '11.webp'), 3, 2):
        names = ['explain', 'good', 'shock', 'stop', 'laugh', 'sad']
        save(fit(remove_flat_bg(cell), 360), f'chars/pal_{names[r * 3 + c]}.webp', q=86)


if __name__ == '__main__':
    main()
