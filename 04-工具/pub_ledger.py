# -*- coding: utf-8 -*-
"""发布台账：每关在各平台的状态，唯一可信的"发到哪了"。

存 06-存档/_发布台账/<合集>.json，不在合集目录里——台账是长期资产，
不能跟着"过程产物可清空"那条规则被删。

状态含义：
  待发  还没发，自动化队列会处理
  已发  发过了
  跳过  主动决定不发（内容问题等）
  自补  低于起点的人工补发项，**自动化不碰**，由人自己发完再改成「已发」
"""

import json
import os
import datetime

import series

PLATFORMS = ("公众号", "知乎", "小红书", "今日头条")
STATUS = ("待发", "已发", "跳过", "自补")


def ledger_dir():
    d = os.path.join(series.ARC_ROOT, "_发布台账")
    os.makedirs(d, exist_ok=True)
    return d


def path(name):
    return os.path.join(ledger_dir(), "%s.json" % name)


def load(name):
    p = path(name)
    if os.path.exists(p):
        try:
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            data.setdefault("记录", {})
            return data
        except Exception as e:
            print("!! 台账读不动（%s），按空台账走" % e)
    return {"合集": name, "更新": "", "起始": "", "记录": {}}


def save(name, data):
    data["合集"] = name
    data["更新"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(path(name), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def entry(data, num):
    """取一关的记录，没有就建。"""
    k = str(int(num))
    rec = data["记录"].setdefault(k, {"标题": "", "公众号": {}, "知乎": {}, "小红书": {}})
    for p in PLATFORMS:
        rec.setdefault(p, {})
        rec[p].setdefault("状态", "待发")
        rec[p].setdefault("时间", "")
        rec[p].setdefault("链接", "")
    return rec


def mark(name, num, platform, status, url=""):
    if platform not in PLATFORMS:
        raise SystemExit("平台只能是：%s" % "、".join(PLATFORMS))
    if status not in STATUS:
        raise SystemExit("状态只能是：%s" % "、".join(STATUS))
    data = load(name)
    rec = entry(data, num)
    rec[platform]["状态"] = status
    rec[platform]["时间"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M") if status == "已发" else ""
    if url:
        rec[platform]["链接"] = url
    save(name, data)
    return rec


def all_nums(name):
    """合集里所有关号，直接扫母稿文件名——不依赖台账，也不会漏掉没备料的关。"""
    import re
    d = series.content(name)
    if not os.path.isdir(d):
        return []
    out = []
    for f in os.listdir(d):
        m = re.match(r"^第(\d+)关", f)
        if m and f.endswith(".md"):
            out.append(int(m.group(1)))
    return sorted(out)


def start_of(data, platform=None):
    """起点：低于这个关号的一律不进自动队列（回补归人）。

    2026-10-30 起是**单队列 + 一个全局起点**。起点之所以还要支持按平台写，
    是因为起点相同、但各平台历史进度不同——那不是起点的事，是记录状态的事
    （低于起点的空缺标「自补」）。

    兼容两种写法：
      "起点": 9                      常规，所有平台共用
      "起点": {"今日头条": 1, "默认": 9}  按平台覆盖，极少用
    """
    s = data.get("起点")
    if isinstance(s, dict):
        if platform and s.get(platform) not in (None, ""):
            return int(s[platform])
        return int(s.get("默认") or 0)
    return int(s or 0)


def pending(name, platform=None):
    """还没发的关卡号，升序。以母稿目录为准，台账里没登记的算待发。

    两个排除条件：
      1. 低于「起点」的关——回补归人，自动化不碰
      2. 状态不是「待发」的——已发 / 跳过 / 自补 都不进队列

    起点是为了不用逐关标跳过：从第 9 关开始跑，设一次起点就够。
    """
    data = load(name)
    start = start_of(data, platform)
    out = []
    for n in all_nums(name):
        if n < start:
            continue
        rec = data["记录"].get(str(n), {}) or {}
        plats = [platform] if platform else list(PLATFORMS)
        if any((rec.get(p, {}) or {}).get("状态", "待发") == "待发" for p in plats):
            out.append(n)
    return sorted(out)


def due(name, per_day=1, platform=None):
    """今天该发哪几关：从待发队列里取最前面的 per_day 篇。

    不按日期推进，因为按日期推进的后果是——某天没发，那篇就永久跳过了。
    宁可节奏慢一天，也不能漏发。落后多少由"应发 vs 已发"单独算。
    """
    queue = pending(name, platform)
    return queue[:per_day], len(queue)


def cli():
    import sys
    n, rest = series.pick(sys.argv[1:])
    if not rest:
        d = load(n)
        rows = d["记录"]
        total = len(all_nums(n))
        print("合集：%s ｜ 母稿 %d 关" % (n, total))
        for p in PLATFORMS:
            done = sum(1 for r in rows.values() if r.get(p, {}).get("状态") == "已发")
            print("  %s 已发 %d / %d" % (p, done, total))
        q = pending(n)
        print("  待发 %d 篇：%s" % (len(q), "、".join(map(str, q[:12])) + ("…" if len(q) > 12 else "")))
        manual = {}
        for k, r in rows.items():
            for p in PLATFORMS:
                if (r.get(p, {}) or {}).get("状态") == "自补":
                    manual.setdefault(p, []).append(int(k))
        if manual:
            print("  人工补发 %d 篇（自动化不碰）："
                  % sum(len(v) for v in manual.values()))
            for p in PLATFORMS:
                if p in manual:
                    print("     %s：第%s关" % (p, "、".join(map(str, sorted(manual[p])))))
        return
    cmd = rest[0]
    if cmd == "start" and len(rest) >= 2:
        d = load(n)
        val = int(rest[1])
        plat = rest[2] if len(rest) >= 3 else ""
        if plat:
            cur = d.get("起点")
            if not isinstance(cur, dict):
                cur = {"默认": cur or 0}
            cur[plat] = val
            d["起点"] = cur
            save(n, d)
            print("已设起点：%s 从第%d关开始发" % (plat, val))
        else:
            d["起点"] = val
            save(n, d)
            print("已设起点：所有平台从第%d关开始发" % val)
    elif cmd == "mark" and len(rest) >= 4:
        print(mark(n, int(rest[1]), rest[2], rest[3], rest[4] if len(rest) > 4 else ""))
    elif cmd == "due":
        plat = rest[1] if len(rest) > 1 else None
        nums, total = due(n, platform=plat)
        print("今天该发：%s ｜ 剩余待发 %d 篇" % (nums or "（无）", total))
    else:
        print("用法：python pub_ledger.py [--合集 X] [start 8 [平台] | mark 41 公众号 已发 URL | due [平台]]")


if __name__ == "__main__":
    cli()
