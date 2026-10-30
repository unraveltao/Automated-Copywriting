# -*- coding: utf-8 -*-
"""体检一关稿：按《骨架与硬规则》逐条判定，输出硬伤与软提示。

零依赖，只用标准库。可单独复制到任何目录使用。

用法：
    python check_level.py "第81关｜地图四色：几种颜色才够？.md"
    python check_level.py ../逻辑闯关/第8*.md
    python check_level.py            # 默认扫 ./逻辑闯关/ 或 ../逻辑闯关/
"""

import glob
import os
import re
import sys

try:  # Windows 控制台默认不是 UTF-8，先切过来，免得中文输出炸掉
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

BAN_WORDS = ["显然", "易证", "众所周知", "不得不说", "值得一提的是"]
BAN_SYMBOLS = ["∑", "∀", "∃", "∏", "√", "≤", "≥", "≠", "∞", "≈"]
EMOJI = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF]")
QUESTION = re.compile(r"(怎样|怎么|为什么|什么|到底|能不能|该不该|是不是|多少|哪|谁|吗|呢)")
# 文件名不能含 " 等 Windows 非法字符，标题里却可以有；比较前先抹平标点与空白
PUNCT = re.compile(r"[\s\"“”「」『』，,。.、；;：:！!？?·（）()]")
STRUCT_HEAD = re.compile(
    r"^(情况|假设|第[一二三四五六七八九十0-9]|其一|其二|其三|步骤|方法|原因|结论|提示|注意)")
TAIL = "关注「像玩游戏一样学」，练脑子不费劲。作者懒，不定期更新哟！"


def classify_bold(text):
    """返回 (结构型, 强调型)。结构型 = 行首标签式加粗，不计入强调额度。"""
    struct = emph = 0
    for line in text.split("\n"):
        body = re.sub(r"^([-*+]|\d+\.)\s+", "", line.strip())
        for m in re.finditer(r"\*\*([^*\n]+)\*\*", line):
            seg = m.group(1)
            label_like = (body.startswith("**" + seg) and
                          (seg.endswith("：") or seg.endswith(":") or
                           STRUCT_HEAD.match(seg) or len(seg) <= 12))
            if label_like:
                struct += 1
            else:
                emph += 1
    return struct, emph


def check(path):
    text = open(path, encoding="utf-8").read()
    name = os.path.basename(path)[:-3]
    issues, minor = [], []

    m = re.match(r"^第(\d+)关｜(.+)$", name)
    num = int(m.group(1)) if m else 0
    h1 = text.split("\n", 1)[0][2:].strip() if text.startswith("# ") else ""

    if not m:
        issues.append("文件名不合模板：应为 第N关｜谜题名：钩子？（检查｜与：）")
        return num, name, 0, 0, 0, issues, minor

    if h1 != name:
        if PUNCT.sub("", h1) == PUNCT.sub("", name):
            minor.append("H1 与文件名标点不一致（封面读文件名）")
        else:
            issues.append("H1 与文件名不一致：「%s」" % h1)

    rest = m.group(2)
    if "：" not in rest:
        issues.append("标题缺「谜题名：钩子」的冒号")
        hook = ""
    else:
        hook = rest.split("：", 1)[1]
    if not (QUESTION.search(rest) or rest.endswith("？")):
        issues.append("标题不是问句（缺疑问词，且没以问号收尾）")
    if len(name) > 30:
        issues.append("标题 %d 字（>30）" % len(name))
    if len(hook) > 26:
        minor.append("钩子 %d 字（>26，手机端会截）" % len(hook))

    if "本关只需要知道" not in text and "本关不需要前置" not in text:
        issues.append("缺「本关只需要知道」一句（可跳读设计的地基）")

    finale = num % 10 == 0
    if not finale:
        if "## 题一" not in text:
            issues.append("缺「## 题一」")
        if "## 题二" not in text:
            issues.append("缺「## 题二」")
    else:
        if text.count("### 题目") < 3:
            issues.append("季终关应有三个「### 题目」（现有 %d 个）" % text.count("### 题目"))
    if "## 现实运用" not in text:
        issues.append("缺「## 现实运用」（季终关也不许省）")
    if TAIL not in text:
        issues.append("缺固定尾句，或与标准句不一致")

    struct, emph = classify_bold(text)
    if emph > 10:
        issues.append("强调型加粗 %d 处（上限 10，删到三类为止）" % emph)
    if struct + emph > 20:
        issues.append("加粗共 %d 处（上限 20）" % (struct + emph))

    body = text.split("\n", 1)[1] if "\n" in text else ""
    for w in BAN_WORDS:
        if w in body:
            issues.append("禁用词「%s」" % w)
    for s in BAN_SYMBOLS:
        if s in text:
            issues.append("数学符号「%s」，换中文" % s)
    if EMOJI.search(text):
        issues.append("有 emoji，删")

    chars = len(re.sub(r"\s", "", body))
    if chars < 1800:
        minor.append("偏短 %d 字" % chars)
    if chars > 4500:
        minor.append("偏长 %d 字" % chars)

    return num, name, chars, struct, emph, issues, minor


def targets(argv):
    if argv:
        out = []
        for a in argv:
            if os.path.isdir(a):
                out.extend(glob.glob(os.path.join(a, "第*关*.md")))
            elif any(c in a for c in "*?["):
                out.extend(glob.glob(a))
            else:
                out.append(a)
        return out
    for d in ("逻辑闯关", os.path.join("..", "逻辑闯关")):
        if os.path.isdir(d):
            return glob.glob(os.path.join(d, "第*关*.md"))
    return []


def main():
    paths = targets(sys.argv[1:])
    if not paths:
        print("没找到文件。用法：python check_level.py <第N关｜….md>")
        return 2
    hard = soft = 0
    for p in sorted(paths):
        num, name, chars, struct, emph, issues, minor = check(p)
        if issues:
            hard += 1
        elif minor:
            soft += 1
        flag = "!! " if issues else ("~  " if minor else "OK ")
        print("%s第%d关 %5d字 结%2d 强%2d  %s" % (
            flag, num, chars, struct, emph, " / ".join(issues + minor)))
    print("\n共 %d 篇：硬伤 %d 篇，仅软提示 %d 篇" % (len(paths), hard, soft))
    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
