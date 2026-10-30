# -*- coding: utf-8 -*-
"""合集（series）路径与元数据。所有脚本共用这一份，别再各自拼路径。

目录约定（一个合集一套，互不干扰）：

    01-内容/<合集>/                 母稿
    02-视觉/<合集>/公众号封面/       1280×792
    02-视觉/<合集>/小红书封面/       1080×1440
    06-存档/<合集>/卡片/             过程产物，可删
    06-存档/<合集>/文档版/           过程产物，可删
    05-技能包/<技能包 id>/           该合集的技能包（可选）

每个合集在 01-内容/<合集>/_合集.json 里写自己的元数据（下面 DEFAULTS 是兜底）。

用法：
    python series.py                   # 列出所有合集
    python series.py 逻辑闯关          # 看一个合集的配置与路径
    python new_series.py 新合集名       # 新建合集骨架

脚本里怎么用：
    from series import pick, content, vis, arc
    name, argv = pick(sys.argv[1:])    # 认 --合集 X / --series X，其余原样返回
    DOC_DIR = content(name)
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))

CONTENT_ROOT = os.path.join(ROOT, "01-内容")
VIS_ROOT = os.path.join(ROOT, "02-视觉")
ARC_ROOT = os.path.join(ROOT, "06-存档")
PKG_ROOT = os.path.join(ROOT, "05-技能包")

DEFAULT = "逻辑闯关"

DEFAULTS = {
    "名称": "",
    "id": "",
    "形态": "关卡制",            # 关卡制 / 散篇 / 连载
    "命名": "第N关｜谜题名：钩子问句？.md",
    "篇数": 0,
    "技能包": "",
    "起点": 1,
    "备注": "",
}


def names():
    """所有合集（01-内容 下的子目录）。"""
    if not os.path.isdir(CONTENT_ROOT):
        return []
    return sorted(d for d in os.listdir(CONTENT_ROOT)
                  if os.path.isdir(os.path.join(CONTENT_ROOT, d)) and not d.startswith("_"))


def exists(name):
    return name in names()


def config(name=DEFAULT):
    """读 _合集.json，缺字段用 DEFAULTS 补。"""
    cfg = dict(DEFAULTS)
    cfg["名称"] = name
    cfg["id"] = cfg["id"] or name
    p = os.path.join(CONTENT_ROOT, name, "_合集.json")
    if os.path.exists(p):
        try:
            with open(p, encoding="utf-8") as f:
                cfg.update({k: v for k, v in json.load(f).items() if v not in (None, "")})
        except Exception as e:
            print("!! %s 读不动（%s），按默认值走" % (p, e))
    cfg["名称"] = cfg["名称"] or name
    return cfg


def content(name=DEFAULT):
    return os.path.join(CONTENT_ROOT, name)


def vis(name=DEFAULT, kind="公众号封面"):
    return os.path.join(VIS_ROOT, name, kind)


def arc(name=DEFAULT, kind="文档版"):
    return os.path.join(ARC_ROOT, name, kind)


def pkg_dir(name=DEFAULT):
    """该合集对应技能包目录；没有就返回空串。"""
    cfg = config(name)
    pid = cfg.get("技能包") or ""
    p = os.path.join(PKG_ROOT, pid) if pid else ""
    return p if p and os.path.isdir(p) else ""


def ensure_dirs(name):
    """补齐一个合集的全部目录。"""
    for p in (content(name), vis(name, "公众号封面"), vis(name, "小红书封面"),
              arc(name, "卡片"), arc(name, "文档版")):
        os.makedirs(p, exist_ok=True)
    return [content(name), vis(name, "公众号封面"), vis(name, "小红书封面"),
            arc(name, "卡片"), arc(name, "文档版")]


def parse_series(argv, default=DEFAULT):
    """把 --合集 X / --series X / -s X 摘出来；返回 (合集名, 剩余参数)。"""
    name, rest = default, []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--合集", "--series", "-s") and i + 1 < len(argv):
            name = argv[i + 1]
            i += 2
            continue
        if a.startswith("--合集=") or a.startswith("--series="):
            name = a.split("=", 1)[1]
            i += 1
            continue
        rest.append(a)
        i += 1
    return name, rest


def pick(argv, default=DEFAULT):
    """脚本入口用：解析合集参数，顺手校验目录存在。"""
    name, rest = parse_series(argv, default)
    if not os.path.isdir(content(name)):
        known = "、".join(names()) or "（还没有合集）"
        raise SystemExit("找不到合集「%s」。现有：%s\n用 python new_series.py 名称 新建。"
                         % (name, known))
    return name, rest


def main():
    who = sys.argv[1:] and sys.argv[1] or ""
    if who:
        if not exists(who):
            raise SystemExit("没有这个合集：%s" % who)
        cfg = config(who)
        files = sorted(f for f in os.listdir(content(who)) if f.endswith(".md"))
        print("合集：%s（id=%s）" % (cfg["名称"], cfg["id"]))
        print("形态：%s ｜ 目录里 md %d 篇 ｜ 登记篇数 %s" % (cfg["形态"], len(files), cfg["篇数"] or "-"))
        print("技能包：%s" % (pkg_dir(who) or "（无）"))
        print("  母稿  %s" % content(who))
        print("  封面  %s ， %s" % (vis(who, "公众号封面"), vis(who, "小红书封面")))
        print("  存档  %s ， %s" % (arc(who, "卡片"), arc(who, "文档版")))
        return
    rows = names()
    if not rows:
        print("还没有合集。python new_series.py 名称 新建一个。")
        return
    print("%-10s %-14s %5s  %s" % ("合集", "id", "篇数", "技能包"))
    for n in rows:
        cfg = config(n)
        cnt = len([f for f in os.listdir(content(n)) if f.endswith(".md")])
        print("%-10s %-14s %5d  %s" % (n, cfg["id"], cnt, cfg["技能包"] or "-"))


if __name__ == "__main__":
    main()
