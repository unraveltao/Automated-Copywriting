# -*- coding: utf-8 -*-
"""备料：把一关母稿做成三平台可以直接粘贴/上传的物料包。

    python pub_pack.py 41                # 第41关
    python pub_pack.py 41 50             # 41 到 50
    python pub_pack.py 1-10              # 区间
    python pub_pack.py --today           # 按台账节奏，今天该发的那几关
    python pub_pack.py --today --no-xhs  # 不生成小红书（省时间）

产物落在 06-存档/<合集>/发布包/第041关/：
    公众号.html     整段富文本，样式已内联，复制进编辑器不会掉格式
    知乎.html       同上，样式按知乎重排过
    知乎标题.txt     ≤16 字，知乎会截断长标题
    小红书文案.txt   标题 + 正文 + 标签
    meta.json       三平台物料索引，发布面板读这个

小红书 docx 由 mk_xhs_note.py 产出，这里只负责调用和登记。
"""

import glob
import json
import os
import re
import subprocess
import sys

import series
import pub_ledger
import pub_md2html

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable

# 十季主题 → 标签组（精准层 / 流量层 / 兜底）
SEASON_TAGS = {
    1: ["#逻辑学", "#逻辑思维", "#思维方法"],
    2: ["#博弈论", "#策略思维", "#逻辑思维"],
    3: ["#数学思维", "#逻辑学", "#思维方法"],
    4: ["#逻辑学", "#批判性思维", "#沟通"],
    5: ["#统计学", "#数据分析", "#逻辑思维"],
    6: ["#决策", "#经济学思维", "#思维方法"],
    7: ["#系统思维", "#复杂系统", "#认知"],
    8: ["#时间管理", "#效率", "#思维方法"],
    9: ["#数学", "#几何", "#思维方法"],
    10: ["#认知偏差", "#心理学", "#思维方法"],
}


def season_of(num):
    return min(10, max(1, (int(num) - 1) // 10 + 1))


def tags_of(num):
    return SEASON_TAGS.get(season_of(num), SEASON_TAGS[1])


def md_file(name, num):
    d = series.content(name)
    for f in os.listdir(d):
        if f.startswith("第%d关" % num) and f.endswith(".md"):
            return os.path.join(d, f)
    return None


def cover(name, num, kind):
    pat = os.path.join(series.vis(name, kind), "第%d关-*.png" % num)
    hit = sorted(glob.glob(pat))
    return hit[0] if hit else ""


def extract_skill(md):
    """取招式名。母稿有两种结构，都要认：

    1. 有「## 这招叫什么」小节（第 41 关这种）→ 取小节里第一个加粗词
    2. 没有该小节（第 1、8 关这种）→ 招式名藏在「## 现实运用：配对思维，……」的标题里

    只认第一种的话，第二种会落到正文里抓加粗，把选项「A、B、C」当成招式名。
    """
    m = re.search(r"##\s*这招叫什么(.{0,800}?)(?=\n##\s|\Z)", md, re.S)
    if m:
        b = re.search(r"\*\*(.+?)\*\*", m.group(1))
        if b:
            s = b.group(1).strip()
            if 2 <= len(s) <= 12:
                return s

    m2 = re.search(r"##\s*现实运用[：:]\s*([^，,。？\n]{2,12})", md)
    if m2:
        s = m2.group(1).strip()
        # 「现实运用：这张表，……」这类是行文指代，不是招式名
        if not re.match(r"^[这那该此其]", s):
            return s

    return ""


def xhs_text(parts, skill, tags, next_parts=None):
    title = "%s｜%s" % (parts["关卡"], parts["谜题"]) if parts["关卡"] else parts["谜题"]
    if len(title) > 20:
        title = title[:20]
    lines = [parts["钩子"], ""]
    if skill:
        lines.append("这一关的招式叫「%s」。" % skill)
    lines.append("题目、答案、穷举过程、现实里怎么用，都整理在文档里了，往下翻。")
    if next_parts and next_parts.get("谜题"):
        lines.append("")
        lines.append("下期：%s" % next_parts["谜题"])
    lines.append("")
    lines.append(" ".join(tags))
    return title, "\n".join(lines)


def parse_nums(argv):
    nums, flags = [], set()
    for a in argv:
        if a.startswith("--"):
            flags.add(a)
        elif re.match(r"^\d+-\d+$", a):
            lo, hi = a.split("-")
            nums.extend(range(int(lo), int(hi) + 1))
        elif a.isdigit():
            nums.append(int(a))
    return nums, flags


def ensure_xhs_docx(name, nums):
    """缺 docx 的关卡批量补一次，别一关一个进程。"""
    need = []
    for num in nums:
        pat = os.path.join(series.arc(name, "文档版"), "第%d关*.docx" % num)
        if not glob.glob(pat):
            need.append(num)
    if not need:
        return
    cmd = [PY, os.path.join(HERE, "mk_xhs_note.py"), "--合集", name, "--docx"] + [str(n) for n in need]
    print("  补小红书文档：%d 篇" % len(need))
    r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print("  !! mk_xhs_note 失败：%s" % (r.stderr or r.stdout)[-300:])


def build_one(name, num, with_xhs=True, next_num=None):
    src = md_file(name, num)
    if not src:
        print("  跳过第%d关：找不到母稿" % num)
        return None

    with open(src, encoding="utf-8") as f:
        md = f.read()

    h1, body = pub_md2html.split_h1(md)
    if not h1:
        print("  跳过第%d关：H1 缺失" % num)
        return None

    parts = pub_md2html.title_parts(h1)
    skill = extract_skill(md)
    tags = tags_of(num)

    out = os.path.join(series.arc(name, "发布包"), "第%03d关" % num)
    os.makedirs(out, exist_ok=True)

    wx_html = pub_md2html.convert(body, "wechat")
    zh_html = pub_md2html.convert(body, "zhihu")
    with open(os.path.join(out, "公众号.html"), "w", encoding="utf-8") as f:
        f.write(wx_html)
    with open(os.path.join(out, "知乎.html"), "w", encoding="utf-8") as f:
        f.write(zh_html)

    zt, need_check = pub_md2html.zhihu_title(parts)

    # 重跑备料不能把人改过的标题冲掉。只有「没人工确认过」才用规则结果覆盖。
    meta_path = os.path.join(out, "meta.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, encoding="utf-8") as f:
                old = json.load(f)
            oz = old.get("知乎", {})
            if oz.get("标题") and oz.get("需确认") is False:
                zt, need_check = oz["标题"], False
        except Exception:
            pass

    with open(os.path.join(out, "知乎标题.txt"), "w", encoding="utf-8") as f:
        f.write(zt)

    nxt = None
    if next_num:
        nsrc = md_file(name, next_num)
        if nsrc:
            with open(nsrc, encoding="utf-8") as f:
                nh1, _ = pub_md2html.split_h1(f.read())
            nxt = pub_md2html.title_parts(nh1)

    xt, xbody = xhs_text(parts, skill, tags, nxt)
    with open(os.path.join(out, "小红书文案.txt"), "w", encoding="utf-8") as f:
        f.write(xbody)

    xhs_docx = ""
    if with_xhs:
        hit = sorted(glob.glob(os.path.join(series.arc(name, "文档版"), "第%d关*.docx" % num)))
        xhs_docx = hit[0] if hit else ""

    meta = {
        "合集": name,
        "关": num,
        "季": season_of(num),
        "标题": h1,
        "谜题": parts["谜题"],
        "钩子": parts["钩子"],
        "招式": skill,
        "母稿": src,
        "公众号": {
            "标题": h1,
            "html": os.path.join(out, "公众号.html"),
            "封面": cover(name, num, "公众号封面"),
            "状态": "待发",
        },
        "知乎": {
            "标题": zt,
            "需确认": need_check,
            "html": os.path.join(out, "知乎.html"),
            "标签": tags,
            "状态": "待发",
        },
        "小红书": {
            "标题": xt,
            "文案": xbody,
            "docx": xhs_docx,
            "封面": cover(name, num, "小红书封面"),
            "标签": tags,
            "状态": "待发",
        },
    }
    with open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    led = pub_ledger.load(name)
    rec = pub_ledger.entry(led, num)
    rec["标题"] = h1
    pub_ledger.save(name, led)

    flag = "" if not need_check else "  ⚠ 知乎标题需人工确认"
    print("  第%d关 %s｜%s → %s%s" % (
        num, parts["关卡"], parts["谜题"], os.path.relpath(out, series.ROOT), flag))
    return meta


def main():
    name, rest = series.pick(sys.argv[1:])
    nums, flags = parse_nums(rest)
    cfg = series.config(name)

    if cfg.get("形态") != "关卡制":
        print("「%s」的形态是 %s，pub_pack 目前只处理关卡制（文件名带第N关）。" % (name, cfg["形态"]))
        return

    if "--today" in flags:
        nums, total = pub_ledger.due(name)
        if not nums:
            print("今天没有该发的关卡（待发 %d 篇）。" % total)
            return
        print("今天该发：%s（剩余待发 %d 篇）"
              % ("、".join("第%d关" % n for n in nums), total))
    elif not nums:
        nums = [int(cfg.get("起点") or 1)]

    with_xhs = "--no-xhs" not in flags
    print("合集：%s ｜ %d 篇 ｜ 小红书物料：%s" % (name, len(nums), "生成" if with_xhs else "跳过"))

    if with_xhs:
        ensure_xhs_docx(name, nums)

    for num in nums:
        # 下期永远是 num+1，不能用「列表里的下一个」——批量传 8 1 时那样会把第 1 关
        # 当成第 8 关的下期，小红书文案的预告就串了。
        build_one(name, num, with_xhs, num + 1)

    print("→ %s" % os.path.relpath(series.arc(name, "发布包"), series.ROOT))
    print("发布：python pub_panel.py")


if __name__ == "__main__":
    main()
