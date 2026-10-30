# -*- coding: utf-8 -*-
"""小红书知识卡片（1080×1440），一套 5 张：封面 / 题目 / 答案 / 为什么 / 招式。

两种模式：

1. 手写模式：MANUAL 里登记过的关（目前第 3 关是精修稿），照原稿出图，不动一个字。
2. 自动模式：其余关卡直接读 `01-内容/<合集>/第N关｜谜题名：钩子.md`，抽
   规则设定 → 题目卡、题一答案 → 答案卡、题二答案 → 为什么卡、
   这招叫什么 → 招式卡；版式沿用封面那套（label + p），出来能直接发，
   细节想精修就把这一关抄进 MANUAL。

图出在 `06-存档/<合集>/卡片/`，发完即删；封面是唯一要长期留的视觉资产。

用法：
    python make_xhs_cards.py           # 默认第 3 关（手写稿）
    python make_xhs_cards.py 41        # 自动模式出第 41 关
    python make_xhs_cards.py 2-5       # 出一个区间
    python make_xhs_cards.py 41 43 57  # 指定几关
    python make_xhs_cards.py --合集 谜题实验室 1-3
"""

import glob
import os
import re
import sys

import series
from xhs_render import render, INK, GRAY, FAINT, measure
from make_xhs_covers import cover_blocks, kicker

CARD_W, CARD_H, CARD_PAD = 1080, 1440, 96
USABLE = CARD_H - CARD_PAD * 2 - 40      # 留一点上下气口

# ---------------- 手写精修稿（第 3 关） ----------------

MANUAL = {
    3: ("卡片翻面", "翻哪两张，才能验证这条规则？", [
        ("2-题目", "left", [
            ("label", "题目"),
            ("p", "桌上有四张卡片，每张一面是字母，一面是数字。\n朝上的一面分别是：", 40, INK, 10),
            ("cards", ["A", "D", "3", "6"]),
            ("p", "规则：一面是元音，另一面一定是偶数。", 40, INK, 44),
            ("p", "问：翻哪几张就够？越少越好。", 40, INK, 20),
            ("p", "全世界大多数人都答错，包括名校学生。", 28, FAINT, 40),
        ]),
        ("3-答案", "left", [
            ("label", "答案"),
            ("big", "翻 A 和 3", 108),
            ("p", "A 是元音，规则正面管它：背面必须是偶数，\n翻出奇数就当场破。", 38, INK, 30),
            ("p", "3 是奇数，规则的逆否是「不是偶数 → 不是元音」，\n背面只要是元音，规则也当场破。", 38, INK, 32),
            ("p", "两张，够了。", 38, GRAY, 32),
        ]),
        ("4-为什么", "left", [
            ("label", "不用翻的两张"),
            ("p", "D 是辅音。规则一个字没提辅音，\n翻它什么都证明不了。", 38, INK, 14),
            ("p", "6 是偶数。规则只说元音背面是偶数，\n没说偶数背面必须是什么——跟元音跟辅音都不犯规。", 38, INK, 34),
            ("p", "大多数人会翻 A 和 6，\n因为规则里只出现了「元音」和「偶数」这两个词。", 36, GRAY, 48),
            ("space", 26),
            ("brush", "你在数白天鹅", 96),
        ]),
        ("5-招式", "left", [
            ("label", "这招叫什么"),
            ("brush", "逆否命题", 140),
            ("p", "「如果 P 则 Q」等于「如果非 Q 则非 P」。", 38, INK, 18),
            ("p", "原命题：元音 → 偶数", 36, GRAY, 40),
            ("p", "逆否：奇数 → 辅音", 36, GRAY, 12),
            ("p", "要推翻一个说法，去找它的逆否，\n而不是找支持它的例子。", 38, INK, 44),
        ]),
    ]),
}

# ---------------- 文章解析 ----------------

SEP = re.compile(r"^#{2,3}\s+(.+)$")


def level_path(num, name=series.DEFAULT):
    hits = []
    for path in glob.glob(os.path.join(series.content(name), "第*关*.md")):
        m = re.match(r"^第(\d+)关｜", os.path.basename(path))
        if m and int(m.group(1)) == num:
            hits.append(path)
    return hits[0] if hits else None


def split_sections(text):
    """→ [{level, title, lines}]，level 是 # 的个数。"""
    secs, cur = [], {"level": 1, "title": "", "lines": []}
    for ln in text.splitlines():
        m = SEP.match(ln)
        if m:
            secs.append(cur)
            cur = {"level": len(ln) - len(ln.lstrip("#")),
                   "title": m.group(1).strip(), "lines": []}
        else:
            cur["lines"].append(ln)
    secs.append(cur)
    return secs


def section(secs, startswith, level=2, contains=None):
    for s in secs:
        if level and s["level"] != level:
            continue
        if startswith and not s["title"].startswith(startswith):
            continue
        if contains and contains not in s["title"]:
            continue
        return s
    return {"level": level, "title": "", "lines": []}


def strip_md(s):
    s = s.strip()
    while s.startswith(">"):
        s = s[1:].strip()
    s = s.replace("**", "").replace("`", "")
    if s.startswith(("- ", "* ")):
        s = "・" + s[2:].strip()
    return s.strip()


def table_lines(tbl):
    rows = []
    for ln in tbl:
        cells = [c.strip().replace("**", "") for c in ln.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        rows.append(cells)
    if len(rows) < 2:
        return []
    head, out = rows[0], []
    for r in rows[1:]:
        if not any(r):
            continue
        rest = "，".join("%s %s" % (head[i], r[i])
                        for i in range(1, len(r)) if i < len(head) and r[i])
        out.append((r[0] + "：" if r[0] else "") + rest)
    return out


def clean(lines):
    """markdown 段落 → 纯文本行（表格压成一行一句）。"""
    out, tbl = [], []
    for ln in lines:
        if ln.strip().startswith("|"):
            tbl.append(ln)
            continue
        if tbl:
            out.extend(table_lines(tbl))
            tbl = []
        if ln.strip() in ("", "---"):
            continue
        s = strip_md(ln)
        if s:
            out.append(s)
    if tbl:
        out.extend(table_lines(tbl))
    return out


def head_info(text):
    """从 H1 取 (关卡号, 谜题名, 钩子)。"""
    h1 = ""
    for ln in text.splitlines():
        if ln.startswith("# "):
            h1 = ln[2:].strip()
            break
    m = re.match(r"^第(\d+)关｜(.+)$", h1)
    if not m:
        return None
    num, rest = int(m.group(1)), m.group(2)
    mm = re.match(r"^(.+?)[：:](.+)$", rest)
    if mm:
        return num, mm.group(1).strip(), mm.group(2).strip()
    return num, rest.strip(), ""


def sub_answer(secs, key):
    """「## 题一 · …」下面第一个「### 答案」的正文；碰下一个 ## 就停。"""
    for i, s in enumerate(secs):
        if s["level"] == 2 and key in s["title"]:
            for sub in secs[i + 1:]:
                if sub["level"] <= 2:
                    break
                if sub["level"] == 3 and sub["title"].startswith("答案"):
                    return clean(sub["lines"])
    return []


def move_name(secs, puzzle):
    """招式卡标题：优先「这招叫**X**」，退回谜题名。"""
    s = section(secs, "这招叫什么", level=2)
    text = "\n".join(s["lines"])
    m = re.search(r"招式叫\*{0,2}[「“]?([^\n。，、“”*]{2,12})", text)
    name = m.group(1).strip() if m else puzzle
    name = re.sub(r"[「」“”]", "", name).strip()
    return name or puzzle


# ---------------- 自动版式 ----------------

def shrink(blocks, s):
    out = []
    for b in blocks:
        k = b[0]
        if k == "p":
            out.append(("p", b[1], int(b[2] * s), b[3], int(b[4] * s)))
        elif k == "label":
            out.append(("label", b[1], int((b[2] if len(b) > 2 else 28) * s)))
        elif k == "big":
            out.append(("big", b[1], int(b[2] * s)))
        elif k == "brush":
            out.append(("brush", b[1], int(b[2] * s)))
        elif k == "brush_fit":
            out.append(("brush_fit", b[1], b[2], int((b[3] if len(b) > 3 else 236) * s)))
        elif k == "space":
            out.append(("space", int(b[1] * s)))
        else:
            out.append(b)
    return out


def fit(blocks, limit=USABLE, min_scale=0.85):
    """先整体缩字号（缩到 0.85 就不许再小），还装不下就按整段砍末尾。"""
    for s in (1.0, 0.94, 0.88, min_scale):
        cand = shrink(blocks, s)
        if sum(measure(b) for b in cand) <= limit:
            return cand
    for cut in range(len(blocks) - 1, 2, -1):
        cand = shrink(blocks[:cut], 0.9)
        if sum(measure(b) for b in cand) <= limit:
            print("  ~ 卡片装不下，已省略末尾 %d 段" % (len(blocks) - cut))
            return cand
    return shrink(blocks[:3], min_scale)


def auto_cards(num, path):
    text = open(path, encoding="utf-8").read()
    info = head_info(text)
    if not info:
        return None
    _, puzzle, hook = info
    secs = split_sections(text)

    setup = clean(section(secs, "规则设定", level=2)["lines"])
    ask = clean(section(secs, "", level=3, contains="题目")["lines"])
    a1_ans = sub_answer(secs, "题一")
    why = sub_answer(secs, "题二")

    move = move_name(secs, puzzle)
    move_sec = clean(section(secs, "这招叫什么", level=2)["lines"])
    action = ""
    for ln in section(secs, "这招叫什么", level=2)["lines"]:
        if ln.strip().startswith(">"):
            action = strip_md(ln)
            break
    if not action:
        for ln in move_sec:
            if ln.startswith("・") or "先问" in ln or "要找" in ln:
                action = ln.lstrip("・")
                break

    # 题目卡：开头两句 + 表格压成的数据行 + 题一的提问
    q = setup[:2]
    q += [t for t in setup[2:] if "：" in t and "/" in t][:4]
    if ask and ask[0] not in q:
        q.append("问：" + ask[0].lstrip("・"))
    # 答案卡：结论 + 算账（最多 4 行）
    ans = a1_ans[:4]
    # 为什么卡：结论 + 机制末两句
    wy = (why[:1] + why[-2:]) if len(why) > 3 else why[:3]

    cards = [
        ("2-题目", [
            ("label", "题目"),
        ] + [("p", t, 38, INK, 14 if i == 0 else 20) for i, t in enumerate(q)]),
        ("3-答案", [
            ("label", "答案"),
        ] + [("p", t, 38, INK, 16 if i == 0 else 20) for i, t in enumerate(ans)]),
        ("4-为什么", [
            ("label", "为什么"),
        ] + [("p", t, 36, INK, 14 if i == 0 else 20) for i, t in enumerate(wy)]),
        ("5-招式", [
            ("label", "这招叫什么"),
        ] + ([("brush_fit", move, 0.86, 150)] if re.fullmatch(r"[\u4e00-\u9fa5·]+", move)
             else [("big", move, 100)]) + [
            ("p", "要做的只有一个动作：", 34, GRAY, 26),
        ] + ([("p", action, 36, INK, 12)] if action else []) + [
            ("p", "看到结论先别接，先问这句，很多说法当场就站不住。", 34, FAINT, 30),
        ]),
    ]
    return puzzle, hook, cards


def parse_nums(argv):
    if not argv:
        return [3]
    nums = []
    for a in argv:
        if "-" in a:
            lo, hi = a.split("-", 1)
            nums.extend(range(int(lo), int(hi) + 1))
        else:
            nums.append(int(a))
    return nums


def emit(num, puzzle, hook, cards, out_dir):
    render(cover_blocks(kicker(num), puzzle, hook),
           os.path.join(out_dir, "第%d关-1-封面.png" % num), align="center")
    for name, blocks in cards:
        blocks = fit(blocks)
        render(blocks, os.path.join(out_dir, "第%d关-%s.png" % (num, name)), "left")


def main():
    series_name, rest = series.pick(sys.argv[1:])
    out_dir = series.arc(series_name, "卡片")
    os.makedirs(out_dir, exist_ok=True)
    manual = MANUAL if series_name == series.DEFAULT else {}
    nums = parse_nums(rest)
    for num in nums:
        if num in manual:
            puzzle, hook, cards = manual[num]
            emit(num, puzzle, hook, [(n, b) for n, _al, b in cards], out_dir)
            print("第%d关 %s 卡片（手写稿）5 张" % (num, puzzle))
            continue
        path = level_path(num, series_name)
        if not path:
            print("跳过第%d关：找不到文章" % num)
            continue
        got = auto_cards(num, path)
        if not got:
            print("跳过第%d关：H1 不合模板" % num)
            continue
        puzzle, hook, cards = got
        emit(num, puzzle, hook, cards, out_dir)
        print("第%d关 %s 卡片 5 张" % (num, puzzle))
    print("→ %s" % os.path.relpath(out_dir, series.ROOT))


if __name__ == "__main__":
    main()
