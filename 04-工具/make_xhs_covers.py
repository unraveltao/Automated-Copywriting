# -*- coding: utf-8 -*-
"""小红书 3:4 封面（1080×1440）。

关卡数据直接从母稿文件名读：`第N关｜谜题名：钩子.md`，
新加一关就自动有封面，不用再维护列表。

用法：
    python make_xhs_covers.py                     # 全部（默认合集 逻辑闯关）
    python make_xhs_covers.py 10                  # 只出第 10 关
    python make_xhs_covers.py 2-80                # 出一个区间
    python make_xhs_covers.py --合集 谜题实验室 1-10
"""

import glob
import os
import re
import sys

import series
from xhs_render import render, GRAY

KICKER_PX = 62
TITLE_RATIO = 0.92
TITLE_HI = 300
HOOK_PX = 38

# 文件名不合模板的关卡，在这里手工补（谜题名, 钩子）
OVERRIDE = {}


def kicker(num):
    """关卡号一律用阿拉伯数字。

    老版封面用马善政排关卡号，数字「1」是一根竖线，两个 1 并排会糊成
    「第 || 关」，所以当年 10 关以上改用了中文数字。现在关卡号改用等线，
    数字清晰，统一回阿拉伯数字，1-100 关的节奏也一致。
    """
    return "第%d关" % num


def load_covers(name=series.DEFAULT):
    """从母稿文件名读 (关卡号, 谜题名, 钩子)，按关卡号排序。"""
    rows = []
    for path in glob.glob(os.path.join(series.content(name), "第*关*.md")):
        stem = os.path.basename(path)[:-3]
        m = re.match(r"^第(\d+)关｜(.+)$", stem)
        if not m:
            continue
        num, rest = int(m.group(1)), m.group(2)
        if num in OVERRIDE:
            rows.append((num,) + OVERRIDE[num])
            continue
        mm = re.match(r"^(.+?)[：:](.+)$", rest)
        if not mm:
            continue
        rows.append((num, mm.group(1).strip(), mm.group(2).strip()))
    rows.sort()
    return rows


def parse_nums(argv):
    """把 10 / 2-80 这样的参数解析成关卡号集合；没参数就返回 None。"""
    if not argv:
        return None
    nums = set()
    for a in argv:
        if "-" in a:
            lo, hi = a.split("-", 1)
            nums.update(range(int(lo), int(hi) + 1))
        else:
            nums.add(int(a))
    return nums


def cover_blocks(kick, title, hook):
    return [
        ("label", kick, KICKER_PX),
        ("brush_fit", title, TITLE_RATIO, TITLE_HI),
        ("p", hook, HOOK_PX, GRAY, 46),
    ]


def build(kick, title, hook, out):
    render(cover_blocks(kick, title, hook), out, align="center")


def main():
    name, rest = series.pick(sys.argv[1:])
    nums = parse_nums(rest)
    out_dir = series.vis(name, "小红书封面")
    os.makedirs(out_dir, exist_ok=True)
    rows = load_covers(name)
    if not rows:
        print("合集「%s」里没有「第N关｜谜题名：钩子.md」这种母稿，没有封面可出。" % name)
        return
    for num, title, hook in rows:
        if nums and num not in nums:
            continue
        build(kicker(num), title, hook,
              os.path.join(out_dir, "第%d关-%s.png" % (num, title)))
    print("%s → %s" % (name, os.path.relpath(out_dir, series.ROOT)))


if __name__ == "__main__":
    main()
