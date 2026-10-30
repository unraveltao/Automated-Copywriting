# -*- coding: utf-8 -*-
"""每天发一篇：同一关，发到所有还缺这个平台的平台。

**统一路线**（2026-10-30 改）：不再有队列 A / 队列 B。
一条队列按关号推进，第 N 关四平台发同一篇内容；某平台已经发过就跳过它。
「今天发第 9 关」= 四平台都发第 9 关，谁缺补谁。

**只向前对齐，不回补**（2026-10-30 定）：起点由台账 `起点` 决定（当前 9）。
起点之前的空缺**不进自动队列**，由人自己补发；台账里这些位置标「自补」。
本脚本永远不碰「自补」，也不做"给落后平台追进度"的事。

设计原则（本脚本唯一的立场）：**失败就停，绝不重试。**
发布类操作重试的代价不是"多试一次"，而是"重复发一篇"或"被风控盯上"。
  - 任一平台失败 → 当天立刻停，后面的平台不发了
  - 已成功的平台**已经记账**，明天队首还是这一关，只会重试失败的那个平台
  - 所以不会死锁，也不会重复发

用法：
    python pub_daily.py --check              # 本地自检，秒出 JSON
    python pub_daily.py --check --online     # 额外探头条登录态 + 查重（约 40 秒）
    python pub_daily.py --dry                # 只看今天发哪关、发哪几个平台
    python pub_daily.py                      # 真发

    python pub_daily.py --平台 今日头条       # 只跑指定平台（调试用，不要用于日常）

返回码：0 成功 / 1 发布失败（已停手）/ 2 自检不通过（没开始）
"""

import json
import os
import re
import shutil
import subprocess
import sys
import time

import pub_ledger
import pub_report
import series

HERE = os.path.dirname(os.path.abspath(__file__))

# 顺序 = 执行顺序。头条最稳放最前，小红书风控最严放最后。
PLATFORMS = ["今日头条", "公众号", "知乎", "小红书"]

RUNNERS = {
    "今日头条": "pub_tt_publish.js",
    "公众号": "pub_wx_publish.js",
    "知乎": "pub_zh_publish.js",
    "小红书": "pub_xhs_publish.js",
}

TIMEOUT = int(os.environ.get("PUB_TIMEOUT") or 480)


def _find_pw():
    """playwright-core 位置：环境变量 → 项目内 node_modules → WorkBuddy 内置（按用户主目录拼，不写死用户名）"""
    cands = [
        os.environ.get("PLAYWRIGHT_CORE"),
        os.path.join(HERE, "node_modules", "playwright-core"),
        os.path.join(os.path.expanduser("~"), ".workbuddy-ai", "binaries", "node",
                     "versions", "22.22.2-6", "node_modules", "@playwright", "cli",
                     "node_modules", "playwright-core"),
        os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "npm",
                     "node_modules", "playwright-core"),
    ]
    for c in cands:
        if c and os.path.isdir(c):
            return c
    return ""


PW_PATH = _find_pw()


def cover_path(name, num):
    """封面文件名规则：02-视觉/<合集>/公众号封面/第N关-谜题名.png"""
    d = series.content(name)
    if not os.path.isdir(d):
        return None
    hit = [f for f in os.listdir(d) if re.match(r"^第%d关｜" % num, f) and f.endswith(".md")]
    if not hit:
        return None
    puzzle = hit[0][:-3].split("｜", 1)[-1].split("：")[0]
    return os.path.join(series.vis(name, "公众号封面"), "第%d关-%s.png" % (num, puzzle))


def todo_of(name, num):
    """这一关还有哪些平台没发（按 PLATFORMS 顺序）。"""
    data = pub_ledger.load(name)
    rec = (data.get("记录") or {}).get(str(num), {}) or {}
    return [p for p in PLATFORMS
            if (rec.get(p, {}) or {}).get("状态", "待发") == "待发"]


def next_article(name):
    """队首：第一个"至少一个平台还没发"的关号。返回 (num 或 None, 待发关总数)。

    用 pub_ledger.pending() 而不是自己扫全表——pending 会排掉低于「起点」的关，
    也就是**回补项不进自动队列**。这是"补发归人、自动化只向前对齐"的落点。
    """
    queue = pub_ledger.pending(name)
    return (queue[0] if queue else None), len(queue)


def check_dup_tt(num):
    """头条线上查重。返回 True 有 / False 没有 / None 查不了。"""
    try:
        r = subprocess.run(["node", "pub_tt_check_dup.js", str(num)], cwd=HERE,
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=180)
        raw = (r.stdout or "").strip()
        i = raw.find("{")
        d = json.loads(raw[i:]) if i >= 0 else {}
        if "dup" not in d:
            return None, d
        return bool(d["dup"]), d
    except Exception as e:
        return None, {"error": str(e)}


def do_check(name, online=False, only=None):
    blockers, warnings, info = [], [], {}
    plats = [only] if only else PLATFORMS

    d = series.content(name)
    nums = pub_ledger.all_nums(name)
    info["母稿目录"] = d
    info["母稿篇数"] = len(nums)
    if not os.path.isdir(d):
        blockers.append("母稿目录不存在：%s" % d)
    elif not nums:
        blockers.append("母稿目录里没有 第N关*.md")

    try:
        pub_ledger.load(name)
        info["台账"] = pub_ledger.path(name)
    except Exception as e:
        blockers.append("台账读不动：%s" % e)

    num, left = (None, 0) if blockers else next_article(name)
    info["待发关数"] = left
    info["下一篇"] = num
    if not blockers and num is None:
        warnings.append("队列已空，全部发完，今日无任务")
    if num:
        todo = [p for p in todo_of(name, num) if p in plats]
        info["本篇待发平台"] = todo
        cp = cover_path(name, num)
        info["封面"] = cp
        if not cp or not os.path.exists(cp):
            blockers.append("第 %d 关封面缺失：%s" % (num, cp))
        # 公众号没有「展示封面」也能发，所以封面缺失对四平台都是硬伤（头条必填）

    node = shutil.which("node")
    info["node"] = node or ""
    if not node:
        blockers.append("找不到 node（发布脚本都是 Node 写的）")
    info["playwright"] = os.path.isdir(PW_PATH)
    if not os.path.isdir(PW_PATH):
        blockers.append("找不到 playwright-core：%s" % PW_PATH)

    for p in plats:
        prof = os.path.join(series.ARC_ROOT, "_浏览器档案",
                            {"今日头条": "toutiao", "公众号": "wx",
                             "知乎": "zhihu", "小红书": "xhs"}[p])
        if not os.path.isdir(prof):
            blockers.append("%s 浏览器档案不存在，需要先登录：%s" % (p, prof))
        script = os.path.join(HERE, RUNNERS[p])
        if not os.path.exists(script):
            blockers.append("%s 发布脚本不存在：%s" % (p, RUNNERS[p]))

    if online and not blockers and num:
        try:
            r = subprocess.run(["node", "pub_tt_state.js"], cwd=HERE,
                               capture_output=True, text=True, encoding="utf-8",
                               errors="replace", timeout=180)
            has = '"hasSession": true' in (r.stdout or "").replace("\n", " ")
            info["头条登录态"] = "有效" if has else "无效"
            if not has:
                blockers.append("头条登录态失效，需要 node pub_tt_login.js 扫码")
        except Exception as e:
            warnings.append("探测头条登录态失败：%s" % e)

        if info.get("头条登录态") == "有效" and "今日头条" in todo_of(name, num):
            dup, detail = check_dup_tt(num)
            info["头条线上查重"] = {"已存在": dup, "命中": detail.get("matches") or []}
            if dup is True:
                blockers.append("头条线上已有第 %d 关（%s），不能重复发"
                                % (num, (detail.get("matches") or [""])[0]))
            elif dup is None:
                blockers.append("头条查重失败：%s" % (detail.get("error") or "未知"))

    return {"ok": not blockers, "blockers": blockers, "warnings": warnings, "info": info}


def _kill_tree(pid):
    """连子进程一起杀。node 起的 Chrome 不杀掉会占住浏览器档案锁，下一个平台就起不来。"""
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)],
                       capture_output=True, text=True)
    else:
        try:
            os.killpg(os.getpgid(pid), 9)
        except Exception:
            pass


def run_script(argv, timeout=None):
    """跑一个 node 脚本。返回 (ok, payload, raw, seconds)。"""
    t0 = time.time()
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    try:
        proc = subprocess.Popen(
            ["node"] + argv, cwd=HERE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace",
            creationflags=flags,
        )
    except Exception as e:
        return False, {"error": "启动失败：%s" % e}, "", time.time() - t0

    limit = timeout or TIMEOUT
    try:
        out, err = proc.communicate(timeout=limit)
    except subprocess.TimeoutExpired:
        _kill_tree(proc.pid)
        proc.kill()
        try:
            proc.communicate(timeout=10)
        except Exception:
            pass
        return False, {
            "error": "超过 %d 秒未结束，已强制中断（连浏览器一起杀掉，不会留档案锁）" % limit,
            "timeout": True,
        }, "", time.time() - t0

    seconds = time.time() - t0
    raw = ((out or "") + "\n" + (err or "")).strip()
    payload = {}
    for line in reversed((out or "").strip().split("\n")):
        line = line.strip()
        if line.startswith("{"):
            try:
                payload = json.loads(line)
                break
            except Exception:
                continue

    # 有 JSON 就认 ok 字段；没有就退回返回码（另外三个脚本不一定打 JSON）
    if "ok" in payload:
        ok = bool(payload["ok"])
    else:
        ok = proc.returncode == 0
        if not payload:
            payload = {"note": "脚本未输出 JSON，按返回码判定", "returncode": proc.returncode}
    return ok, payload, raw, seconds


def run_platform(platform, num):
    """跑一个平台的发布脚本。返回 (ok, payload, raw, seconds)。"""
    return run_script([RUNNERS[platform], str(num), "--go"])


def main():
    argv = sys.argv[1:]
    flags = {a for a in argv if a.startswith("--")}
    rest = [a for a in argv if not a.startswith("--")]

    only = None
    if "--平台" in argv:
        i = argv.index("--平台")
        if i + 1 >= len(argv):
            raise SystemExit("--平台 后面要跟平台名，如 --平台 今日头条")
        only = argv[i + 1]
        if only not in PLATFORMS:
            raise SystemExit("平台只能是：%s" % "、".join(PLATFORMS))
        rest = [a for a in rest if a != only]

    name, _ = series.pick(rest)

    if "--check" in flags:
        res = do_check(name, online="--online" in flags, only=only)
        print(json.dumps(res, ensure_ascii=False, indent=1))
        return 0 if res["ok"] else 2

    num, left = next_article(name)
    if num is None:
        print("今日无任务：全部发完（共 %d 关）" % len(pub_ledger.all_nums(name)))
        return 0

    todo = [p for p in todo_of(name, num) if (only is None or p == only)]
    print("今天发：第 %d 关 ｜ 待发平台：%s ｜ 队列还剩 %d 关"
          % (num, "、".join(todo) or "（无，此平台已发）", left))

    if not todo:
        print("这一关指定平台都发过了，换下一关（重跑不带 --平台 即可）")
        return 0

    if "--dry" in flags:
        print("--dry：不动手")
        return 0

    done, failed = [], None
    records = []
    t_start = time.time()

    def rec(name, ok, secs, error="", shot="", tail="", note=""):
        records.append({"name": name, "ok": ok, "seconds": secs, "error": error,
                        "shot": shot, "steps_tail": tail, "note": note})

    for p in todo:
        # 头条发之前强制查重（其他平台靠已校准的台账）
        if p == "今日头条":
            print("查重：核对头条线上是否已有第 %d 关…" % num)
            dup, detail = check_dup_tt(num)
            if dup is True:
                print("!! 头条线上已有第 %d 关，跳过这个平台（不重复发）" % num)
                print("   命中：%s" % (detail.get("matches") or [""])[0])
                rec(p, None, 0, note="线上已有，跳过")
                continue
            if dup is None:
                failed = ("今日头条", "查重失败，无法确认线上状态：%s"
                          % (detail.get("error") or "未知"), {}, "")
                rec(p, False, 0, error=failed[1])
                break
            print("查重通过：头条线上没有第 %d 关" % num)

        # 公众号的发布脚本只认「草稿箱里已有的草稿」，所以先自动建一份。
        # 这一步以前是人工粘的，是四平台串联里唯一的人工断点（2026-10-31 补齐）。
        if p == "公众号":
            print("   建草稿：node pub_wx_draft.js %d …" % num)
            ok_d, payload_d, raw_d, secs_d = run_script(["pub_wx_draft.js", str(num)], 420)
            if not ok_d:
                err_d = payload_d.get("error") or "建草稿失败"
                failed = (p, "建草稿失败：%s" % err_d, payload_d, raw_d)
                rec(p, False, secs_d, error="建草稿失败：%s" % err_d,
                    shot=payload_d.get("shot") or "")
                break
            print("   草稿就绪（%.0f 秒）" % secs_d)

        print("→ 发 %s …" % p)
        ok, payload, raw, secs = run_platform(p, num)
        steps = payload.get("steps") or []
        tail = json.dumps(steps[-1], ensure_ascii=False)[:300] if steps else ""
        rec(p, ok, secs,
            error="" if ok else (payload.get("error") or "脚本返回失败"),
            shot=payload.get("shot") or "", tail=tail)
        if ok:
            pub_ledger.mark(name, num, p, "已发")
            done.append(p)
            print("   %s 成功，已记账（%.0f 秒）" % (p, secs))
        else:
            failed = (p, payload.get("error") or "脚本返回失败", payload, raw)
            break

    # 没轮到的平台也记上，报告里要能看出「是没发」还是「发了失败」
    for p in todo:
        if not any(r["name"] == p for r in records):
            rec(p, None, 0, note="未执行")

    total = time.time() - t_start
    if failed:
        overall = "部分失败"
    elif done and len(done) == len(todo):
        overall = "全部完成"
    else:
        overall = "未完成"

    run = {
        "开始": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t_start)),
        "耗时": total, "关卡": num, "合集": name,
        "平台": records, "结果": overall,
    }
    report_path = None
    try:
        report_path = pub_report.save(run)
    except Exception as e:
        print("（报告生成失败：%s）" % e)

    print("")
    if done:
        print("本次成功：%s" % "、".join(done))

    if failed:
        p, err, payload, raw = failed
        print("!! %s 失败，已停止（不重试），后续平台未执行" % p)
        print("   错误：%s" % err)
        steps = payload.get("steps") or []
        if steps:
            print("   卡在：%s" % json.dumps(steps[-1], ensure_ascii=False)[:300])
        if payload.get("shot"):
            print("   截图：%s" % payload["shot"])
        if not payload or payload.get("note"):
            print("   原始输出（末尾 800 字）：\n%s" % raw[-800:])
        left_plats = [x for x in todo if x not in done and x != p]
        if left_plats:
            print("   今天没发的平台：%s（明天会先补这一关）" % "、".join(left_plats))
        print("   台账里成功的平台已记「已发」，失败的仍是「待发」。")
        if report_path:
            print("   报告：%s" % report_path)
        return 1

    rest_plats = [x for x in todo if x not in done]
    print("第 %d 关：%s" % (num, "全部平台完成" if not rest_plats
                            else "还剩 %s 未发" % "、".join(rest_plats)))
    if report_path:
        print("报告：%s" % report_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
