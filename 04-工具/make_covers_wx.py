# -*- coding: utf-8 -*-
"""公众号 / 知乎封面（1280×792，与公众号首图同比例）。

版式和 小红书竖版封面同一套：红色关卡号 → 毛笔谜题名 → 灰色钩子。
关卡数据来自 make_xhs_covers.load_covers()，两边永远同源。

用法：
    python make_covers_wx.py                      # 全部（默认合集 逻辑闯关）
    python make_covers_wx.py 10                   # 只出第 10 关
    python make_covers_wx.py 2-80                 # 出一个区间
    python make_covers_wx.py --合集 谜题实验室 1-10
"""

import os
import sys

import series
from xhs_render import render, GRAY
from make_xhs_covers import load_covers, parse_nums, kicker

W, H, PAD = 1280, 792, 104
KICKER_PX = 50
TITLE_RATIO = 0.92
TITLE_HI = 260
HOOK_PX = 34


def cover_blocks(kick, title, hook):
    return [
        ("label", kick, KICKER_PX),
        ("brush_fit", title, TITLE_RATIO, TITLE_HI),
        ("p", hook, HOOK_PX, GRAY, 38),
    ]


def main():
    name, rest = series.pick(sys.argv[1:])
    nums = parse_nums(rest)
    out_dir = series.vis(name, "公众号封面")
    os.makedirs(out_dir, exist_ok=True)
    rows = load_covers(name)
    if not rows:
        print("合集「%s」里没有「第N关｜谜题名：钩子.md」这种母稿，没有封面可出。" % name)
        return
    for num, title, hook in rows:
        if nums and num not in nums:
            continue
        render(cover_blocks(kicker(num), title, hook),
               os.path.join(out_dir, "第%d关-%s.png" % (num, title)),
               align="center", w=W, h=H, pad=PAD)
    print("%s → %s" % (name, os.path.relpath(out_dir, series.ROOT)))


if __name__ == "__main__":
    main()
