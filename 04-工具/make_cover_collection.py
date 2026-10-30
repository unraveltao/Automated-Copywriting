# -*- coding: utf-8 -*-
"""合集封面（头条 / 知乎专栏通用）：白底黑字，和单篇封面同一套语言。

用法：
    python make_cover_collection.py                 # 默认 4:3 1600×1200
    python make_cover_collection.py --3x4           # 3:4 1200×1600（知乎专栏）
    python make_cover_collection.py --name 逻辑闯关 --hook "每关一道谜题，每关一个招式"
"""

import argparse
import os

from xhs_render import render, GRAY

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "02-视觉", "逻辑闯关", "合集封面")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="逻辑闯关")
    ap.add_argument("--label", default="100 关")
    ap.add_argument("--hook", default="每关一道谜题，每关一个招式")
    ap.add_argument("--3x4", dest="portrait", action="store_true")
    ap.add_argument("--4x3", dest="landscape", action="store_true")
    a = ap.parse_args()

    if a.portrait:
        w, h, pad, tag = 1200, 1600, 120, "3x4"
    elif a.landscape:
        w, h, pad, tag = 1600, 1200, 130, "4x3"
    else:
        # 头条合集封面的裁切框是 16:9，出图直接对齐，免二次裁
        w, h, pad, tag = 1600, 900, 96, "16x9"

    blocks = [
        ("label", a.label, 40),
        ("brush_fit", a.name, 0.72, 240),
        ("p", a.hook, 36, GRAY, 34),
    ]
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, "%s-%s.png" % (a.name, tag))
    render(blocks, out, align="center", w=w, h=h, pad=pad)


if __name__ == "__main__":
    main()
