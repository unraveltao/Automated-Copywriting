#!/usr/bin/env python3
"""临时校验：06-百关文本要点.md 与 100 篇原文是否对得上。"""
import glob
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(BASE, "..", "01-内容", "逻辑闯关")
DOC = os.path.join(BASE, "logic-levels", "references", "06-百关文本要点.md")
MAP = os.path.join(BASE, "logic-levels", "references", "01-百关总表.md")


def entries(path):
    out, cur = {}, None
    for line in open(path, encoding="utf-8").read().splitlines():
        m = re.match(r"^### 第(\d{1,3})关｜(.+)$", line)
        if m:
            cur = int(m.group(1))
            out[cur] = {"name": m.group(2).strip(), "fields": {}}
        elif cur and line.startswith("- "):
            body = line[2:]
            for key in ("题一", "题二", "三问", "答案", "招式", "现实"):
                if body.startswith(key + "："):
                    out[cur]["fields"][key] = body[len(key) + 1:].strip()
                    break
    return out


def table():
    t, started = {}, False
    for line in open(MAP, encoding="utf-8").read().splitlines():
        if line.startswith("## 二、第一季"):
            started = True
        if not started:
            continue
        m = re.match(r"^\|\s*(\d{1,3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|", line)
        if m and int(m.group(1)) not in t:
            t[int(m.group(1))] = (m.group(2).strip(), m.group(3).strip())
    return t


def files():
    d = {}
    for p in glob.glob(os.path.join(ART, "第*关*.md")):
        m = re.match(r"第(\d{1,3})关｜", os.path.basename(p))
        if m:
            d[int(m.group(1))] = p
    return d


def main():
    es, tb, fs = entries(DOC), table(), files()
    bad = []
    if len(es) != 100:
        bad.append(("结构", "条目数 %d，应为 100" % len(es)))
    if len(fs) != 100:
        bad.append(("结构", "原文文件 %d 篇，应为 100" % len(fs)))
    seasons = len(re.findall(r"^## 第.+季", open(DOC, encoding="utf-8").read(), re.M))
    if seasons != 10:
        bad.append(("结构", "季标题 %d 个，应为 10" % seasons))

    for n in range(1, 101):
        if n not in es:
            bad.append(("结构", "缺第%d关" % n))
            continue
        e = es[n]
        keys = [k for k in ("题一", "题二", "三问") if k in e["fields"]]
        if not (keys == ["题一", "题二"] or keys == ["题一", "三问"]):
            bad.append(("第%d关" % n, "问法行不对：%s" % keys))
        for k in ("答案", "招式", "现实"):
            if k not in e["fields"]:
                bad.append(("第%d关" % n, "缺字段 %s" % k))
        if n not in fs or n not in tb:
            continue
        text = open(fs[n], encoding="utf-8").read()
        h1 = re.search(r"^#\s*第\d{1,3}关[｜|](.+)$", text, re.M)
        if h1:
            title = re.sub(r"^季终关[：:·・]?", "", h1.group(1))
            title = re.split(r"[：:，,？?]", title)[0].strip()
            core = re.sub(r"^季终关[·・：:]?", "", e["name"]).strip()
            if core and core not in title and title not in core:
                bad.append(("第%d关" % n, "谜题名「%s」与 H1「%s」不一致" % (e["name"], title)))
        sk = e["fields"].get("招式", "")
        got = sk.split("——")[0].strip()
        if n == 100:
            pass
        elif tb[n][1] == "综合":
            pass
        else:
            want = [x.strip() for x in tb[n][1].split("/") if x.strip()]
            if not any(w and (w in got or got in w) for w in want):
                bad.append(("第%d关" % n, "招式「%s」与总表「%s」不一致" % (got, tb[n][1])))
            elif got not in text:
                bad.append(("第%d关" % n, "招式「%s」在原文里找不到" % got))
        nums = set(re.findall(r"\d+(?:\.\d+)?", " ".join(e["fields"].values())))
        missing = sorted(x for x in nums if x not in text)
        if missing:
            bad.append(("第%d关" % n, "这些数字原文里没有：%s" % ", ".join(missing)))
        joined = " ".join(e["fields"].values())
        for w in ("显然", "易证", "众所周知", "不得不说", "值得一提的是"):
            if w in joined:
                bad.append(("第%d关" % n, "用了禁用词「%s」" % w))
        for ch in "∑∀∃√≤≥≠∞≈":
            if ch in joined:
                bad.append(("第%d关" % n, "出现数学符号 %s" % ch))

    for tag, msg in bad:
        print("!! %s  %s" % (tag, msg))
    print("\n条目 %d 条，问题 %d 项" % (len(es), len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
