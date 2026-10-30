#!/usr/bin/env python3
"""逻辑闯关 · 逻辑体检（第二道，管"对不对"，不管"合不合规"）

第一道是 check_level.py（格式、加粗、篇幅、尾句）。
这一道查《修订规范》第三节的 8 项里能自动判定的部分：

  a 答案是否穷举（弱判定：有没有逐条走）
  b 题二是否靠"加限制"升难度
  c 招式名与总表是否一致（c 的机制解释靠人读）
  d 现实运用是否破误用 + 3 条动作
  e 回指旧关编号对不对（含"回指了别的关的招式"）
  f 数字算得对不对（只验 "a / b = c%" 这类算式）
  g 同一关内自相矛盾（人读，脚本不判）
  h 是否只给结论没给推理（弱判定：答案段落是不是太短）

另加一项跨篇检查：招式重复、谜题重复。

用法：
  python logic_check.py                 # 查当前目录下 第*关*.md
  python logic_check.py 路径/逻辑闯关     # 查指定目录
  python logic_check.py --map 01-百关总表.md

零依赖，Python 3.8+。硬伤以 !! 开头，软提示以 ~ 开头，结尾给汇总。
"""

import glob
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HARD, SOFT = [], []
CUR = {"num": 0}

LIMIT_WORDS = ("限", "只能", "最多", "至少", "不超过", "几次", "几步", "只准",
               "不许", "不能", "问一个", "一个问题", "知道", "信息", "看不到")
ENUM_WORDS = ("情况一", "情况二", "情况三", "第一种", "第二种", "第三种",
              "假设", "如果", "若", "逐条", "穷举", "走一遍", "分别")
BREAK_WORDS = ("误解", "破除", "不一定", "其实不是", "错在", "并不是所有")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def sections(text):
    """按 ##/### 切块，返回 [(标题, 正文)]，正文到下一个标题为止。"""
    out, title, buf = [], None, []
    for line in text.splitlines():
        m = re.match(r"^#{2,3}\s+(.+?)\s*$", line)
        if m:
            if title is not None:
                out.append((title, "\n".join(buf)))
            title, buf = m.group(1), []
        elif title is not None:
            buf.append(line)
    if title is not None:
        out.append((title, "\n".join(buf)))
    return out


def load_map(path):
    """从 01-百关总表.md 读 {关号: (谜题, 招式)}。"""
    table = {}
    if not path or not os.path.exists(path):
        return table
    for line in read(path).splitlines():
        m = re.match(r"^\|\s*(\d{1,3})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|", line)
        if m:
            k = int(m.group(1))
            if k not in table:  # 只认第一张总表，附一的表格行不覆盖
                table[k] = (m.group(2).strip(), m.group(3).strip())
    return table


def level_no(text, path):
    m = re.search(r"^#\s*第(\d{1,3})关", text, re.M)
    if m:
        return int(m.group(1))
    m = re.search(r"第(\d{1,3})关", os.path.basename(path))
    return int(m.group(1)) if m else 0


def skill_name(text):
    """招式名：优先「现实运用：X，…」，其次「招式叫 **X**」。"""
    m = re.search(r"现实运用[：:]\s*([^\n，,？?。]{2,12})", text)
    if m:
        cand = m.group(1).strip()
        if not re.search(r"本季|四个动作|这一招|怎么用", cand):
            return cand
    m = re.search(r"招式叫\s*\*\*(.+?)\*\*", text)
    return m.group(1).strip() if m else ""


def check_file(path, table):
    text = read(path)
    n = level_no(text, path)
    name = os.path.basename(path)
    tag = "第%d关" % n if n else name
    secs = sections(text)
    blob = text

    # b 题二靠加限制
    for title, body in secs:
        if re.match(r"题二|第二题|第二问", title):
            q = body
    # b 题二靠加限制（只报"换了设定"的危险信号，正常加限制不吵）
    for title, body in secs:
        if re.match(r"题二|第二题|第二问", title):
            m = re.search(r"###\s*题目(.*?)(?=###\s*答案|$)", body, re.S)
            q = m.group(1) if m else body
            if not any(w in q for w in LIMIT_WORDS) and re.search(r"新人|新道具|再加一个|换一批", q):
                SOFT.append((tag, "题二像是在加新设定，不像「加限制」升难度"))
            break

    # d 现实运用：动作条数（3 条是硬规则，破了要先改）
    for title, body in secs:
        if not title.startswith("现实运用"):
            continue
        acts = re.findall(r"^[-*]\s+", body, re.M)
        if len(acts) < 3:
            SOFT.append((tag, "现实运用的动作只有 %d 条（要 3 条）" % len(acts)))
        break

    # h 答案太短：只给了结论的嫌疑（穷举与否是判断，靠人读，见 02 第十节）
    for title, body in secs:
        if not re.match(r"答案", title):
            continue
        plain = re.sub(r"[*_`>#\-\s]", "", body)
        if len(plain) < 120:
            SOFT.append((tag, "答案段落只有 %d 字，确认有没有穷举" % len(plain)))

    # e 回指旧关（标题行里的本关编号不算回指）
    body_only = re.sub(r"^#{1,6}\s.*$", "", blob, flags=re.M)
    for m in re.finditer(r"第\s*(\d{1,3})\s*关", body_only):
        tgt = int(m.group(1))
        if tgt == n:
            HARD.append((tag, "正文里回指了本关编号，写错（预告未来关允许）"))
            continue
        if tgt > n:
            continue  # 预告未来关是正常写法
        rest = body_only[m.end():m.end() + 30]
        window = re.split(r"[）)、；。第]", rest)[0]
        if not re.search(r"[：:，,、\s]", window):
            continue
        mine = table.get(tgt, ("", ""))[1]
        if not mine or mine == "综合":
            continue
        names = [s.strip() for s in mine.split("/") if s.strip()]
        others = {k: v[1] for k, v in table.items()
                  if k != tgt and v[1] not in ("综合", "")}
        hit_mine = any(s in window for s in names)
        hit_other = [k for k, v in others.items() if v and v in window and v not in names]
        if hit_other and not hit_mine:
            HARD.append((tag, "回指第%d关，但紧跟着说的是第%d关的招式「%s」"
                         % (tgt, hit_other[0], others[hit_other[0]])))

    # c 招式名与总表
    got = skill_name(text)
    if got and n in table:
        want = table[n][1]
        if want and want != "综合":
            names = [s.strip() for s in want.split("/") if s.strip()]
            if not any(s and (s in got or got in s) for s in names):
                SOFT.append((tag, "招式名「%s」与总表「%s」不一致" % (got, want)))

    # f 算式
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*[/÷]\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)\s*%", blob):
        a, b, c = (float(x) for x in m.groups())
        if b == 0:
            continue
        if abs(a / b * 100 - c) > 0.6:
            HARD.append((tag, "算式不符：%s / %s = %s%%（实际 %.1f%%）"
                         % (m.group(1), m.group(2), m.group(3), a / b * 100)))


def cross(entries, table):
    """跨篇：招式重复、谜题重复。entries = [(关号, 谜题, 招式)]"""
    seen = {}
    for n, puz, sk in entries:
        if not sk or sk == "综合":
            continue
        if table.get(n, ("", ""))[1] == "综合":
            continue  # 季终关的招式本来就要复用全季
        for s in [x.strip() for x in sk.split("/") if x.strip()]:
            if s in seen and seen[s] != n:
                HARD.append(("第%d关" % n, "招式「%s」与第%d关重复（招式库应一关一招）" % (s, seen[s])))
            seen.setdefault(s, n)
    pz = {}
    for n, puz, _ in entries:
        p = re.sub(r"^季终关[·・]?", "", puz).strip()
        if not p:
            continue
        if p in pz and pz[p] != n:
            SOFT.append(("第%d关" % n, "谜题名与第%d关重复：「%s」" % (pz[p], p)))
        pz.setdefault(p, n)


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    map_path = ""
    if "--map" in argv:
        i = argv.index("--map")
        if i + 1 < len(argv):
            map_path = argv[i + 1]
            if map_path in args:
                args.remove(map_path)
    target = args[0] if args else "."
    if os.path.isdir(target):
        files = sorted(glob.glob(os.path.join(target, "第*关*.md")),
                       key=lambda p: level_no("", p))
    else:
        files = [target]

    if not map_path:
        here = os.path.dirname(os.path.abspath(__file__))
        for cand in ("../references/01-百关总表.md", "01-百关总表.md"):
            p = os.path.normpath(os.path.join(here, cand))
            if os.path.exists(p):
                map_path = p
                break
    table = load_map(map_path)

    entries = []
    for f in files:
        try:
            check_file(f, table)
        except Exception as exc:  # 单篇出错不中断
            HARD.append((os.path.basename(f), "解析失败：%s" % exc))
            continue
        text = read(f)
        n = level_no(text, f)
        h1 = re.search(r"^#\s*第\d{1,3}关[｜|]\s*([^：:]+)", text, re.M)
        entries.append((n, h1.group(1).strip() if h1 else "", skill_name(text)))
    cross(entries, table)

    for tag, msg in HARD:
        print("!! %s  %s" % (tag, msg))
    for tag, msg in SOFT:
        print("~  %s  %s" % (tag, msg))
    bad = len({t for t, _ in HARD})
    warn = len({t for t, _ in SOFT})
    print("\n共 %d 篇：硬伤 %d 篇（%d 项），软提示 %d 篇（%d 项）"
          % (len(files), bad, len(HARD), warn, len(SOFT)))
    return 1 if HARD else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
