# -*- coding: utf-8 -*-
"""封面 / 卡片渲染核心（白底黑字，可换画布比例）。

毛笔字（马善政）只用于纯中文标题——它的拉丁字母和数字字形不可用。
正文用等线（Deng / Dengb）。

块类型：
    ("label", 文本[, 字号])      小标签，红色，固定字距
    ("brush", 文本, 字号)         毛笔标题
    ("brush_fit", 文本, 宽度比, 上限字号)  毛笔标题，按宽度自适应
    ("big", 文本, 字号)           等线粗体大字（含字母数字时用）
    ("p", 文本, 字号, 颜色, 段前距)
    ("cards", ["A","D",...])      牌面方块
    ("space", 像素)

画布：render(blocks, out, align="left", w=1080, h=1440, pad=96)
"""

import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
BRUSH = os.path.join(HERE, "fonts", "MaShanZheng-Regular.ttf")
SANS = "C:/Windows/Fonts/Deng.ttf"
SANSB = "C:/Windows/Fonts/Dengb.ttf"

SS = 2
INK = (26, 26, 26)
GRAY = (120, 120, 120)
FAINT = (176, 176, 176)
ACCENT = (163, 45, 45)
CARD_FILL = (245, 245, 245)

NO_START = "，。、；：？！）」』】〉》”’·…"
NO_END = "（「『【〈《“‘"

CFG = {"W": 1080, "H": 1440, "PAD": 96}
_fit_cache = {}


def F(path, px):
    return ImageFont.truetype(path, max(8, int(px * SS)))


def maxw():
    return (CFG["W"] - CFG["PAD"] * 2) * SS


def fit_brush(text, target, hi=236, lo=120):
    """按目标宽度选字号：字号越大越好，但宽度不超过 target。"""
    key = (text, target, hi, lo)
    if key in _fit_cache:
        return _fit_cache[key]
    px = hi
    while px > lo and F(BRUSH, px).getlength(text) > target:
        px -= 2
    _fit_cache[key] = px
    return px


def wrap(text, font, width):
    """按字符换行，带避头尾与孤字处理。"""
    out = []
    for para in text.split("\n"):
        lines, cur = [], ""
        for ch in para:
            if font.getlength(cur + ch) <= width:
                cur += ch
                continue
            if ch in NO_START:
                cur += ch
                lines.append(cur)
                cur = ""
                continue
            while cur and cur[-1] in NO_END:
                ch = cur[-1] + ch
                cur = cur[:-1]
            if cur:
                lines.append(cur)
            cur = ch
        if cur:
            lines.append(cur)
        if len(lines) >= 2 and len(lines[-1]) <= 2:
            prev = lines[-2]
            if len(prev) > 3 and prev[-1] not in NO_START:
                lines[-1] = prev[-1] + lines[-1]
                lines[-2] = prev[:-1]
        out.extend(lines)
    return out


def measure(b):
    kind = b[0]
    if kind == "label":
        size = b[2] if len(b) > 2 else 28
        return int(size * 2.5 * SS)
    if kind == "brush":
        return int(b[2] * 1.34 * SS)
    if kind == "brush_fit":
        hi = b[3] if len(b) > 3 else 236
        return int(fit_brush(b[1], b[2] * maxw(), hi) * 1.34 * SS)
    if kind == "big":
        return int(b[2] * 1.55 * SS)
    if kind == "p":
        ft = F(SANS, b[2])
        return int(len(wrap(b[1], ft, maxw())) * b[2] * 1.74 * SS) + b[4] * SS
    if kind == "cards":
        return 236 * SS
    if kind == "space":
        return b[1] * SS
    raise ValueError(kind)


def render(blocks, out, align="left", w=1080, h=1440, pad=96):
    CFG.update(W=w, H=h, PAD=pad)
    W, H, PAD = w, h, pad

    img = Image.new("RGB", (W * SS, H * SS), "white")
    d = ImageDraw.Draw(img)
    total = sum(measure(b) for b in blocks)
    y = (H * SS - total) // 2
    left, right = PAD * SS, (W - PAD) * SS

    for b in blocks:
        kind = b[0]
        hgt = measure(b)
        if kind == "label":
            size = b[2] if len(b) > 2 else 28
            ft = F(SANS, size)
            txt = b[1]
            gaps = int(size * 0.26) * SS
            cell = ft.getlength("国")
            # 数字连写成一个整体（第10关 不能拆成 第 1 0 关），汉字按等宽格排
            segs, cur = [], ""
            for c in txt:
                if c.isdigit():
                    cur += c
                else:
                    if cur:
                        segs.append(cur)
                        cur = ""
                    segs.append(c)
            if cur:
                segs.append(cur)
            # 多位数字连写成一个整体（第10关 不能拆成 第 1 0 关）；
            # 单个数字仍占一个汉字格，和 1-9 关的老封面保持一致
            widths = [ft.getlength(s) if (s.isdigit() and len(s) > 1) else cell
                      for s in segs]
            tw = sum(widths) + gaps * (len(segs) - 1)
            x = left if align == "left" else (W * SS - tw) / 2
            for s, sw in zip(segs, widths):
                d.text((x + (sw - ft.getlength(s)) / 2, y), s, font=ft, fill=ACCENT)
                x += sw + gaps
        elif kind in ("brush", "brush_fit"):
            if kind == "brush":
                txt, px = b[1], b[2]
            else:
                txt = b[1]
                hi = b[3] if len(b) > 3 else 236
                px = fit_brush(b[1], b[2] * maxw(), hi)
            ft = F(BRUSH, px)
            bb = d.textbbox((0, 0), txt, font=ft)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            x = left - bb[0] if align == "left" else (W * SS - tw) / 2 - bb[0]
            d.text((x, y + (hgt - th) / 2 - bb[1]), txt, font=ft, fill=INK)
        elif kind == "big":
            txt, px = b[1], b[2]
            ft = F(SANSB, px)
            bb = d.textbbox((0, 0), txt, font=ft)
            tw, th = bb[2] - bb[0], bb[3] - bb[1]
            x = left - bb[0] if align == "left" else (W * SS - tw) / 2 - bb[0]
            d.text((x, y + (hgt - th) / 2 - bb[1]), txt, font=ft, fill=INK)
        elif kind == "p":
            txt, px, color, gap = b[1], b[2], b[3], b[4]
            ft = F(SANS, px)
            ty = y + gap * SS
            for ln in wrap(txt, ft, maxw()):
                x = left if align == "left" else (W * SS - ft.getlength(ln)) / 2
                d.text((x, ty), ln, font=ft, fill=color)
                ty += px * 1.74 * SS
        elif kind == "cards":
            letters = b[1]
            size, gap = 188 * SS, 24 * SS
            n = len(letters)
            tw = n * size + (n - 1) * gap
            x = left if align == "left" else (W * SS - tw) / 2
            ft = F(SANSB, 112)
            for ch in letters:
                d.rounded_rectangle([x, y + 12 * SS, x + size, y + 12 * SS + size],
                                    radius=16 * SS, fill=CARD_FILL)
                bb = d.textbbox((0, 0), ch, font=ft)
                d.text((x + (size - (bb[2] - bb[0])) / 2 - bb[0],
                        y + 12 * SS + (size - (bb[3] - bb[1])) / 2 - bb[1]),
                       ch, font=ft, fill=INK)
                x += size + gap
        y += hgt

    img.resize((W, H), Image.LANCZOS).save(out)
    print(out)
