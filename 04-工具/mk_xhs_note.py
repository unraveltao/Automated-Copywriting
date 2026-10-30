# -*- coding: utf-8 -*-
"""公众号母稿 → 小红书文档版草稿（800–1000 字，八个板块）。

母稿在 `01-内容/<合集>/第N关｜….md`，这里按 `references/03-三平台改写.md`
的规矩机械压一版：

    标题 / 一句话钩子 / 题目 / 答案（穷举合并成 2 条）/ 这招叫什么 /
    现实运用（破误用 + 2 条）/ 下期预告 / 固定尾句

招式名以技能包里的 `06-百关文本要点.md` 为准（81–100 关的母稿没有
「这招叫什么」小节）。字数不够就按顺序补：机制句 → 招式一句话 →
06 的招式机制 → 第 3 个场景 → 06 的答案句；超了就按比例往回收。

出来的是**草稿**：板块齐、字数落在区间，但句子还是母稿的句子。
发之前至少顺一遍「答案」两条之间的衔接，和「现实运用」的场景顺序。
草稿出在 `06-存档/<合集>/文档版/`，发完即删。

用法：
    python mk_xhs_note.py 41            # 只写第 41 关的 md
    python mk_xhs_note.py 41 --docx     # 顺手转成 docx
    python mk_xhs_note.py 1-100 --docx  # 批量
    python mk_xhs_note.py --合集 谜题实验室 1-5
"""

import os
import re
import sys

import md2docx
import series
from make_xhs_cards import (clean, head_info, level_path, move_name,
                            section, split_sections, strip_md)

TAIL = "关注「像玩游戏一样学」，练脑子不费劲。作者懒，不定期更新哟！"
MIN_CJK, MAX_CJK = 800, 1000


# ---------------- 字数与截断 ----------------

def cjk_len(text):
    """小红书字数口径：去掉 markdown 记号与空白后的字符数。"""
    return len(re.sub(r"\s", "", re.sub(r"[#*>`\-]", "", text)))


def clip(s, n):
    """截到第 n 字，尽量停在句末标点。"""
    s = (s or "").strip()
    if len(s) <= n:
        return s
    cut = s[:n]
    for mark in "。！？；":
        p = cut.rfind(mark)
        if p >= n * 0.55:
            return cut[:p + 1]
    return cut.rstrip("，、：") + "…"


def merge_two(items):
    """穷举分支合并成 2 条；只合并短句，长解释留给「机制」和「招式」。"""
    items = [i.lstrip("・").strip() for i in items if i and len(i) > 4]
    short = [i for i in items if len(i) <= 90]
    items = short or items
    if len(items) <= 2:
        return items
    half = (len(items) + 1) // 2

    def join(xs):
        s = ""
        for x in xs:
            x = x.rstrip("。")
            if not s:
                s = x
            elif s.endswith(("：", "，", "、", "；")):
                s += x
            else:
                s += "；" + x
        return s + "。"

    return [join(items[:half]), join(items[half:])]


# ---------------- 06 要点表 ----------------

def load_points(name=series.DEFAULT):
    """{关号: {题一/题二/三问/答案/招式/现实}}。技能包里没这份文件就返回空表。"""
    table, cur = {}, None
    pkg = series.pkg_dir(name)
    if not pkg:
        return table
    path = os.path.join(pkg, "references", "06-百关文本要点.md")
    if not os.path.exists(path):
        return table
    for ln in open(path, encoding="utf-8"):
        h = re.match(r"^###\s+第(\d+)关｜", ln)
        if h:
            cur = int(h.group(1))
            table[cur] = {}
            continue
        m = re.match(r"^-\s*(题一|题二|三问|答案|招式|现实)：(.+)$", ln.strip())
        if cur and m:
            table[cur][m.group(1)] = m.group(2).strip()
    return table


# ---------------- 抽料 ----------------

def next_teaser(num, name=series.DEFAULT):
    p = level_path(num + 1, name)
    if not p:
        return ""
    info = head_info(open(p, encoding="utf-8").read())
    if not info:
        return ""
    _, puzzle, hook = info
    return "下期预告：第%d关｜%s" % (num + 1, hook or puzzle)


def answer_after(secs, key):
    """「## 题X · …」下面第一个「### 答案」的正文。"""
    for i, s in enumerate(secs):
        if s["level"] == 2 and key in s["title"]:
            for sub in secs[i + 1:]:
                if sub["level"] <= 2:
                    break
                if sub["level"] == 3 and sub["title"].startswith("答案"):
                    return clean(sub["lines"])
    return []


def all_answer_firsts(secs):
    """所有「### 答案」小节的第一句，按出现顺序（季终/分层关靠它兜底）。"""
    out = []
    for s in secs:
        if s["level"] == 3 and s["title"].startswith("答案"):
            items = clean(s["lines"])
            if items:
                out.append(items[0])
    return out


def block_paras(secs, startswith):
    """某个 ## 小节连同它下面的 ### 子小节，正文按顺序拼起来。"""
    out = []
    for i, s in enumerate(secs):
        if s["level"] == 2 and s["title"].startswith(startswith):
            out += clean(s["lines"])
            for sub in secs[i + 1:]:
                if sub["level"] <= 2:
                    break
                out += clean(sub["lines"])
            break
    return out


def first_answer_items(secs):
    """全篇第一个「### 答案」的整段正文（终关/分层关用它当答案骨架）。"""
    for s in secs:
        if s["level"] == 3 and s["title"].startswith("答案"):
            return clean(s["lines"])
    return []


def pick_action(real):
    """现实运用里「能用的是这个动作」后面那句。"""
    for i, ln in enumerate(real):
        if "动作" in ln and ln.rstrip().endswith(("：", ":")) and i + 1 < len(real):
            return real[i + 1].lstrip("・")
    for ln in real:
        if any(k in ln for k in ("先找", "先问", "先看", "先算", "写一行")):
            return ln.lstrip("・")
    return ""


def real_title(secs):
    s = section(secs, "现实运用", level=2)
    t = s["title"]
    m = re.match(r"^现实运用[：:]\s*(.+?)[，,]", t)
    if m:
        return m.group(1).strip()
    return t.replace("现实运用", "").strip("：: ")


def collect(num, points, name=series.DEFAULT):
    path = level_path(num, name)
    if not path:
        return None
    text = open(path, encoding="utf-8").read()
    info = head_info(text)
    if not info:
        return None
    _, puzzle, hook = info
    secs = split_sections(text)
    pt = points.get(num, {})

    raw = secs[0]["lines"]
    skip = [strip_md(ln) for ln in raw if ln.strip().startswith(">")]
    body = [strip_md(ln) for ln in raw
            if ln.strip() and ln.strip() != "---" and not ln.strip().startswith(">")]
    opener = clip(body[-1], 76) if body else hook

    # 季终关 / 终关：没有「规则设定」，是「场景 + 三问 + 综合」
    scene = clean(section(secs, "场景", level=2)["lines"])
    if scene:
        q = scene[:4]
        answers = [answer_after(secs, k) for k in ("题一", "题二", "题三")]
        answers = [a for a in answers if a]
        concl = answers[0][0] if answers else pt.get("答案", "")
        two = [a[0] for a in answers[1:]] or merge_two(answers[0][1:]) if answers else []
        name = pt.get("招式", "").split("——")[0] or "三招合一"
        action = ""
        for ln in section(secs, "综合", level=2)["lines"]:
            if ln.strip().startswith(">"):
                action = strip_md(ln)
                break
        if not action and concl and answers and len(answers[0]) > 1:
            action = answers[0][1]
    else:
        setup = clean(section(secs, "规则设定", level=2)["lines"])
        data = [t for t in setup[2:] if "：" in t and "/" in t][:4]
        ask = clean(section(secs, "", level=3, contains="题目")["lines"])
        q = setup[:2] + (data or setup[2:4])
        if ask:
            q.append(ask[0])
            for extra in ask[1:]:
                if len("".join(q + [extra])) < 320:
                    q.append(extra)
        ans = answer_after(secs, "题一")
        if ans:
            concl = ans[0]
            a2 = answer_after(secs, "题二")
            a3 = answer_after(secs, "题三")
            if a2 and a3:  # 季终关三问
                two = [a2[0], a3[0]]
            else:
                two = merge_two(ans[1:])
        else:  # 分层季终关（第一层/第二层/第三层）没有「题一」，只有各层答案
            items = first_answer_items(secs)
            syn0 = block_paras(secs, "综合")
            if items:
                concl, two = items[0], items[1:3]
            else:
                concl = syn0[0] if syn0 else pt.get("答案", "")
                two = []
        name = (pt.get("招式", "").split("——")[0]
                or move_name(secs, real_title(secs) or puzzle))
        action = ""
        for ln in section(secs, "这招叫什么", level=2)["lines"]:
            if ln.strip().startswith(">"):
                action = strip_md(ln)
                break
        if not action:
            action = pt.get("招式", "").split("——")[-1].strip()

    why = answer_after(secs, "题二") or answer_after(secs, "题三")
    mech = ""
    for w in reversed(why):
        if any(k in w for k in ("机制", "是因为", "取决于", "全部")):
            mech = w
            break
    if not mech and why:
        mech = why[-1]

    move_sec = section(secs, "这招叫什么", level=2)["lines"] or section(secs, "综合", level=2)["lines"]
    why_move = ""
    for ln in clean(move_sec)[1:]:
        if any(k in ln for k in ("因为", "所以", "判据", "才有", "就不", "不一样", "先看")):
            why_move = ln
            break

    real = clean(section(secs, "现实运用", level=2)["lines"])
    real = [ln for ln in real if not ln.startswith(("关注「像玩游戏", "留个思考题"))]
    misuse = next((ln for ln in real if "误解" in ln), "")
    act = pick_action(real)
    scenes = [ln.lstrip("・") for ln in real if ln.startswith("・")]
    if not scenes:
        scenes = [ln for ln in real if ln not in (misuse, act)]
    tail = ""
    for ln in reversed(real):
        if not ln.startswith("・") and ln not in (misuse, act):
            tail = ln
            break

    return {
        "num": num, "puzzle": puzzle, "hook": hook,
        "title": "第%d关｜%s：%s" % (num, puzzle, hook) if hook else "第%d关｜%s" % (num, puzzle),
        "skip": clip(skip[0], 30) if skip and len(skip[0]) <= 36 else "",
        "opener": opener, "q": q,
        "concl": concl, "two": two, "mech": mech,
        "name": name, "action": action, "why_move": why_move,
        "misuse": misuse, "act": act, "scenes": scenes[:3],
        "real_tail": tail,
        "syn": block_paras(secs, "综合"),
        "next": next_teaser(num, name),
        "pt_move": (pt.get("招式", "").split("——")[-1].strip()
                    if "——" in pt.get("招式", "") else ""),
        "pt_ans": pt.get("答案", ""),
        "pt_real": pt.get("现实", ""),
        "pt_ask": pt.get("三问", ""),
        "pt_t1": pt.get("题一", ""),
        "pt_t2": pt.get("题二", ""),
    }


def overlaps(text, ref, n=10):
    """text 里有 n 字连续片段出现在 ref 里，就算重复。"""
    if not text or not ref:
        return False
    for i in range(0, max(1, len(text) - n + 1)):
        if text[i:i + n] in ref:
            return True
    return False


def as_md(t, n):
    """列表项统一成 md 列表；其余照截。"""
    t = clip(t, n).replace("\n・", "\n- ")
    return "- " + t.lstrip("・ ") if t.startswith("・") else t


def trim_reason(s):
    """把「…，因为…」前面的铺垫削掉，从「因为」开始读着顺。"""
    for k in ("因为", "所以", "先看", "不一样", "判据", "才有"):
        p = s.find(k)
        if 0 < p <= 40:
            return s[p:]
    return s


# ---------------- 拼稿 ----------------

def assemble(d, tight=0.0, extras=0):
    wide = extras >= 6
    q = [as_md(t, 380 if wide else 300) for t in d["q"]]
    ans = []
    if d["concl"]:
        ans.append("**%s**" % clip(d["concl"], 190 if wide else 150).lstrip("・ "))
    ans += [as_md(t, int((230 if wide else 170) - 60 * tight)) for t in d["two"]]
    move = "**%s**" % d["name"]
    if d["action"]:
        move += "\n\n" + clip(d["action"], 140 if wide else 110)

    real = []
    if d["misuse"]:
        real.append(clip(d["misuse"], 105))
    if d["act"]:
        real.append("能用的是这个动作：**%s**" % clip(d["act"].strip("*"), 90))
    used = "\n".join(real)
    for s in d["scenes"]:
        if len([x for x in real if x.startswith("- ")]) >= 2:
            break
        if overlaps(s, used):
            continue
        real.append("- " + clip(s, int((130 if wide else 96) - 30 * tight)))
        used += "\n" + s

    if extras >= 1:
        if d["mech"]:
            ans.append(clip(d["mech"], 140))
        if d["why_move"] and not overlaps(d["why_move"], "\n".join(ans)):
            move += "\n\n> 一句话：%s" % clip(trim_reason(d["why_move"]), 90)
    if extras >= 2:
        if d.get("syn"):
            move += "\n\n" + "\n\n".join(clip(t, 110) for t in d["syn"][:2])
        if d["pt_move"] and d["pt_move"] not in move:
            move += "\n\n" + clip(d["pt_move"], 110)
    if extras >= 3 and len(d["scenes"]) > 2:
        cand = d["scenes"][2]
        if not overlaps(cand, used):
            real.append("- " + clip(cand, 96))
    if extras >= 4:
        if d["pt_real"] and not overlaps(d["pt_real"], "\n".join(real)):
            real.append(clip(d["pt_real"], 90))
        if d["pt_ans"] and not overlaps(d["pt_ans"], "\n".join(ans)):
            ans.append(clip(d["pt_ans"], 120))

    if extras >= 5:
        # 季终/终关的最后一段料：综合的后半段 + 06 的「三问」摘要
        if d.get("syn") and len(d["syn"]) > 2:
            move += "\n\n" + "\n\n".join(clip(t, 100) for t in d["syn"][2:4])
        if d.get("pt_ask") and not overlaps(d["pt_ask"], "\n".join(q)):
            q.append(clip("本关三问：" + d["pt_ask"], 110))
    if extras >= 6:
        # 还是不够，就放宽截断 + 把现实运用的收尾句带上
        if d.get("real_tail") and not overlaps(d["real_tail"], "\n".join(real)):
            real.append(clip(d["real_tail"], 120))
    if extras >= 7 and d.get("pt_t1") and not overlaps(d["pt_t1"], "\n".join(q)):
        q.append(clip("题面补充：" + d["pt_t1"], 110))
    if extras >= 8 and d.get("pt_t2") and not overlaps(d["pt_t2"], "\n".join(q)):
        q.append(clip("再进一步：" + d["pt_t2"], 110))

    out = ["# " + d["title"], ""]
    if d["skip"]:
        out += ["> " + d["skip"], ""]
    out += [d["opener"], ""]
    out += ["## 题目", "", "\n\n".join(q), ""]
    out += ["## 答案", "", "\n\n".join(ans), ""]
    out += ["## 这招叫什么", "", move, ""]
    out += ["## 现实运用", "", "\n\n".join(real), ""]
    if d["next"]:
        out += [d["next"], ""]
    out += [TAIL, ""]
    return dedup_paras("\n".join(out))


def dedup_paras(text):
    """整段重复的只留第一次（合并补料时最容易撞）；顺手把「・」正成 md 列表。"""
    out, seen = [], set()
    for p in text.split("\n\n"):
        k = p.strip()
        if k.startswith("・"):
            k = "- " + k[1:].strip()
        if len(k) > 20 and k in seen:
            continue
        seen.add(k)
        out.append(k)
    text = "\n\n".join(out)
    for a, b in (("：；", "："), ("，；", "，"), ("；。", "。"),
                 ("。。", "。"), ("…。", "…"), ("：。", "：")):
        text = text.replace(a, b)
    return text


def fit_len(d):
    """先补料够 800，再收词够 1000；两头都做不到就交最接近的一版。"""
    last = None
    for extras in range(9):
        note = assemble(d, 0.0, extras)
        n = cjk_len(note)
        if n > MAX_CJK:
            for tight in (0.2, 0.4, 0.6, 0.8, 1.0):
                cand = assemble(d, tight, extras)
                if cjk_len(cand) <= MAX_CJK:
                    return cand, extras, tight
            return note, extras, 0.0
        if n >= MIN_CJK:
            return note, extras, 0.0
        last = note
    return last, 4, 1.0


def note_name(title):
    """文件名：Windows 非法字符替换；英文引号成对换回中文引号，别留一堆 "-"。"""
    out, opening = [], True
    for ch in title:
        if ch in '\\/:*?<>|':
            out.append("-")
        elif ch == '"':
            out.append("“" if opening else "”")
            opening = not opening
        else:
            out.append(ch)
    return "".join(out)


def parse_nums(argv):
    nums, docx = [], False
    for a in argv:
        if a == "--docx":
            docx = True
        elif "-" in a:
            lo, hi = a.split("-", 1)
            nums.extend(range(int(lo), int(hi) + 1))
        else:
            nums.append(int(a))
    return nums or [3], docx


def main():
    series_name, rest = series.pick(sys.argv[1:])
    out_dir = series.arc(series_name, "文档版")
    os.makedirs(out_dir, exist_ok=True)
    points = load_points(series_name)
    nums, docx = parse_nums(rest)
    bad, ok = [], 0
    for num in nums:
        d = collect(num, points, series_name)
        if not d:
            print("跳过第%d关：找不到母稿或 H1 不合模板" % num)
            continue
        note, extras, tight = fit_len(d)
        md = os.path.join(out_dir, note_name(d["title"]) + ".md")
        with open(md, "w", encoding="utf-8") as f:
            f.write(note)
        n = cjk_len(note)
        if not MIN_CJK <= n <= MAX_CJK:
            bad.append((num, n))
        print("第%d关 %4d 字%s%s → %s" % (
            num, n,
            ("（补 %d 档）" % extras) if extras else "",
            ("（收 %d%%）" % (tight * 100)) if tight else "",
            os.path.basename(md)))
        if docx:
            md2docx.convert(md, md[:-3] + ".docx")
        ok += 1
    print("共 %d 篇；字数超范围 %d 篇%s" % (
        ok, len(bad),
        ("：" + "、".join("第%d关 %d 字" % b for b in bad)) if bad else ""))
    print("→ %s" % os.path.relpath(out_dir, series.ROOT))


if __name__ == "__main__":
    main()
