# -*- coding: utf-8 -*-
"""按《00｜项目规划与写作模板.md》+ 各平台实测限制，批量体检一个合集的母稿。

三级判定（旧版只有"硬伤/软提示"两级，导致"数字算错"和"钩子长 2 字"同档，会被忽略）：
  blocker  = 发不出去，或结构缺件。必须改。
  major    = 能发但违规（禁用词、符号、加粗超标、缺板块）。该改。
  minor    = 读感问题（偏短偏长、钩子偏长、H1 与文件名不一致）。可选。

平台标题限制来自实测（04-工具/probe_platform_limits.js），不是传闻：
  头条   2～30 字   （编辑器 placeholder 原文「请输入文章标题（2～30个字）」）
  知乎   最多 100 字（placeholder 原文「请输入标题（最多 100 个字）」）
  公众号 64 字      （编辑器计数器 0/64；摘要 120、作者 8）
  小红书 64 字      （长文编辑器 maxlength=64，计数器 0/64）

用法：
    python audit_articles.py                  # 全部（默认合集 逻辑闯关）
    python audit_articles.py 1 2 40           # 只看指定关
    python audit_articles.py --平台 头条       # 额外按头条标题限制判
    python audit_articles.py --合集 谜题实验室
    python audit_articles.py --quiet          # 只列有问题的

退出码：有 blocker 时 1，否则 0。给自动化脚本用，别靠人眼看输出。
"""

import glob
import os
import re
import sys

import series

BAN_WORDS = ["显然", "易证", "众所周知", "不得不说", "值得一提的是"]
BAN_SYMBOLS = ["∑", "∀", "∃", "∏", "√", "≤", "≥", "≠", "∞", "≈"]
EMOJI = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF]")
QUESTION = re.compile(r"(怎样|怎么|为什么|什么|到底|能不能|该不该|是不是|多少|哪|谁|吗|呢)")

STRUCT_HEAD = re.compile(r"^(情况|假设|第[一二三四五六七八九十0-9]|其一|其二|其三|步骤|方法|原因|结论|提示|注意|问：|答：)")

# 实测值：(下限, 上限)。下限只有头条有——它要求至少 2 个字。
PLATFORM_TITLE = {
    "头条": (2, 30),
    "知乎": (1, 100),
    "公众号": (1, 64),
    "小红书": (1, 64),
}
PLATFORM_ALIAS = {
    "今日头条": "头条", "toutiao": "头条", "tt": "头条",
    "zhihu": "知乎", "zh": "知乎",
    "wx": "公众号", "weixin": "公众号", "微信": "公众号",
    "xhs": "小红书", "red": "小红书",
}


def classify_bold(text):
    """返回 (结构型数量, 强调型数量)。"""
    struct = emph = 0
    for line in text.split("\n"):
        stripped = line.strip()
        body = re.sub(r"^([-*+]|\d+\.)\s+", "", stripped)
        for m in re.finditer(r"\*\*([^*\n]+)\*\*", line):
            seg = m.group(1)
            at_line_head = body.startswith("**" + seg)
            label_like = at_line_head and (seg.endswith("：") or seg.endswith(":") or
                                           STRUCT_HEAD.match(seg) or len(seg) <= 12)
            if label_like:
                struct += 1
            else:
                emph += 1
    return struct, emph


def title_of(name):
    """文件名 → (关号, 完整标题, 冒号后的谜题名部分, 钩子)。"""
    m = re.match(r"^第(\d+)关｜(.+)$", name)
    if not m:
        return 0, name, name, ""
    body = m.group(2)
    hook = body.split("：", 1)[1] if "：" in body else ""
    return int(m.group(1)), name, body, hook


def check(path, form="关卡制", platforms=()):
    text = open(path, encoding="utf-8").read()
    name = os.path.basename(path)[:-3]
    num, full_title, body_title, hook = title_of(name)
    body = text.split("\n", 1)[1] if "\n" in text else ""

    blocker, major, minor = [], [], []

    # ---------- blocker：发不出去 / 结构缺件 ----------
    h1 = text.split("\n", 1)[0].strip()
    if not h1.startswith("# "):
        blocker.append("缺 H1")
    elif h1[2:].strip() != name:
        minor.append("H1 与文件名不一致")

    if text.count("**") % 2:
        blocker.append("加粗星号不配对")
    if "****" in text:
        blocker.append("连续四个星号")

    if form == "关卡制" and not num:
        blocker.append("文件名不合 第N关｜谜题名：钩子")

    # ---------- major：能发但违规 ----------
    if form == "关卡制" and "：" not in body_title:
        major.append("标题缺冒号钩子")
    if not (QUESTION.search(name) or name.endswith("？")):
        major.append("标题无疑问词")

    if "本关只需要知道" not in text and "本关不需要前置" not in text:
        major.append("缺「本关只需要知道」")

    finale = form == "关卡制" and num % 10 == 0
    if form == "关卡制" and not finale:
        if "## 题一" not in text and "## 第一问" not in text:
            major.append("缺题一")
        if "## 题二" not in text and "## 第二问" not in text:
            major.append("缺题二")
    if "## 现实运用" not in text:
        major.append("缺现实运用")
    if "关注「像玩游戏一样学」" not in text:
        major.append("缺固定尾句")

    struct, emph = classify_bold(text)
    total = struct + emph
    if emph > 10:
        major.append("强调加粗%d处(>10)" % emph)
    if total > 20:
        major.append("加粗共%d处(>20)" % total)

    # 禁用词查正文，不查 H1：H1 由命名规范逐字锁定，若标题本身在研究这个词
    # （如第 95 关"什么都显然"），不该算行文用词。
    for w in BAN_WORDS:
        if w in body:
            major.append("禁用词:%s" % w)
    for s in BAN_SYMBOLS:
        if s in text:
            major.append("符号:%s" % s)
    if EMOJI.search(text):
        major.append("有emoji")

    # ---------- 平台标题限制（实测值） ----------
    plat_bad = []
    for p in platforms:
        lo, hi = PLATFORM_TITLE[p]
        if len(full_title) > hi:
            plat_bad.append("%s超%d字(实%d)" % (p, hi, len(full_title)))
        elif len(full_title) < lo:
            plat_bad.append("%s不足%d字" % (p, lo))
    if plat_bad:
        major.append("平台标题:" + "、".join(plat_bad))

    # ---------- minor：读感 ----------
    if len(hook) > 26:
        minor.append("钩子偏长%d字" % len(hook))
    chars = len(re.sub(r"\s", "", body))
    if chars < 1800:
        minor.append("偏短%d字" % chars)
    if chars > 4500:
        minor.append("偏长%d字" % chars)

    return {
        "num": num, "name": name, "chars": chars,
        "struct": struct, "emph": emph,
        "blocker": blocker, "major": major, "minor": minor,
        "title_len": len(full_title),
    }


def main():
    argv = sys.argv[1:]
    quiet = "--quiet" in argv
    argv = [a for a in argv if a != "--quiet"]

    platforms = []
    if "--平台" in argv:
        i = argv.index("--平台")
        if i + 1 >= len(argv):
            raise SystemExit("--平台 后面要跟平台名，如 --平台 头条,知乎")
        raw = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
        for p in re.split(r"[,，\s]+", raw):
            p = p.strip()
            if not p:
                continue
            p = PLATFORM_ALIAS.get(p, p)
            if p not in PLATFORM_TITLE:
                raise SystemExit("不认识的平台「%s」，可用：%s" % (p, "、".join(PLATFORM_TITLE)))
            platforms.append(p)

    series_name, rest = series.pick(argv)
    form = series.config(series_name)["形态"]
    want = set(int(a) for a in rest if a.isdigit())

    rows = [check(p, form, platforms)
            for p in glob.glob(os.path.join(series.content(series_name), "*.md"))]
    rows.sort(key=lambda r: r["num"])

    n_b = n_m = n_s = shown = 0
    for r in rows:
        if want and r["num"] not in want:
            continue
        shown += 1
        level = "B" if r["blocker"] else ("M" if r["major"] else ("m" if r["minor"] else "-"))
        if r["blocker"]:
            n_b += 1
        elif r["major"]:
            n_m += 1
        elif r["minor"]:
            n_s += 1
        if quiet and not (r["blocker"] or r["major"]):
            continue
        label = "第%-3d关" % r["num"] if form == "关卡制" else r["name"][:12]
        parts = []
        if r["blocker"]:
            parts.append("[B] " + " / ".join(r["blocker"]))
        if r["major"]:
            parts.append("[M] " + " / ".join(r["major"]))
        if r["minor"]:
            parts.append("[m] " + " / ".join(r["minor"]))
        print("%s %s %5d字 题%2d字 结%2d 强%2d  %s"
              % (level, label, r["chars"], r["title_len"], r["struct"], r["emph"],
                 " ｜ ".join(parts) if parts else "OK"))

    print("\n%s：共 %d 篇 ｜ blocker %d ｜ major %d ｜ 仅 minor %d ｜ 干净 %d"
          % (series_name, shown, n_b, n_m, n_s, shown - n_b - n_m - n_s))
    if platforms:
        print("已按平台标题限制检查：%s" % "、".join(
            "%s≤%d字" % (p, PLATFORM_TITLE[p][1]) for p in platforms))
    sys.exit(1 if n_b else 0)


if __name__ == "__main__":
    main()
