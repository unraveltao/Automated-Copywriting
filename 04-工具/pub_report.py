# -*- coding: utf-8 -*-
"""把一次发布跑成一张能直接点开看的 HTML 报告。

    python pub_report.py              # 把最近一次运行结果渲染出来（读 _报告/last.json）
    python pub_report.py --open       # 渲染并直接用浏览器打开

产物：
    06-存档/_报告/<时间戳>.html   单次运行报告（自包含样式，双击就能看）
    06-存档/_报告/index.html      所有运行的历史索引
    06-存档/_报告/last.json       最近一次运行的原始数据

为什么要有这个：终端输出一闪而过，截图散在各处，
出了问题要翻半天才知道卡在哪一步。报告把「哪个平台、成功没、花多久、错在哪、截图是哪张」
放在同一页里，出事直接看这一页。
"""

import html
import json
import os
import subprocess
import sys
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "06-存档", "_报告")
SHOT_DIR = os.path.join(ROOT, "06-存档", "_运行截图")

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font:15px/1.7 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
     background:#f5f6f8;color:#1f2328;padding:32px 20px}
.wrap{max-width:980px;margin:0 auto}
h1{font-size:22px;font-weight:650;letter-spacing:-.2px}
.sub{color:#656d76;font-size:13px;margin-top:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:22px 0}
.card{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:14px 16px}
.card .k{font-size:12px;color:#656d76;letter-spacing:.3px;text-transform:uppercase}
.card .v{font-size:19px;font-weight:600;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e6ea;
      border-radius:10px;overflow:hidden}
th,td{padding:11px 14px;text-align:left;border-bottom:1px solid #eef0f2;font-size:14px;
      vertical-align:top}
th{background:#fafbfc;font-weight:600;font-size:12.5px;color:#57606a;letter-spacing:.3px;
   text-transform:uppercase}
tr:last-child td{border-bottom:none}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
.ok{background:#e6f4ea;color:#12692f}
.bad{background:#fde8e8;color:#a40e26}
.skip{background:#eef0f2;color:#57606a}
.err{background:#fff;border:1px solid #f0c9c9;border-left:3px solid #d1242f;
     border-radius:8px;padding:14px 16px;margin-top:20px;white-space:pre-wrap;
     font-family:ui-monospace,Consolas,monospace;font-size:13px;color:#82071e;line-height:1.6}
h2{font-size:15px;font-weight:650;margin:28px 0 10px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.shots a{display:block;border:1px solid #e3e6ea;border-radius:8px;overflow:hidden;background:#fff}
.shots img{width:100%;display:block}
.shots span{display:block;padding:6px 9px;font-size:11.5px;color:#57606a;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.muted{color:#656d76;font-size:13px}
a{color:#0969da}
code{background:#f0f1f3;padding:1px 5px;border-radius:4px;font-size:12.5px}
"""


def _pill(ok):
    if ok is True:
        return '<span class="pill ok">OK</span>'
    if ok is False:
        return '<span class="pill bad">FAILED</span>'
    return '<span class="pill skip">SKIPPED</span>'


def _rel(path, base):
    """把绝对路径转成相对报告文件的路径，方便本地打开时能显示图片"""
    try:
        return os.path.relpath(path, base).replace("\\", "/")
    except ValueError:
        return ""


def _fmt_sec(s):
    if s is None:
        return "—"
    s = int(round(s))
    return "%d:%02d" % (s // 60, s % 60)


def render(run):
    """run: dict，字段见 pub_daily.build_run()"""
    started = run.get("开始", "")
    dur = run.get("耗时")
    num = run.get("关卡")
    plats = run.get("平台", [])
    overall = run.get("结果", "")
    name = run.get("合集", "")

    ok_n = sum(1 for p in plats if p.get("ok") is True)
    bad_n = sum(1 for p in plats if p.get("ok") is False)

    head = (
        '<div class="wrap">'
        "<h1>Publish Report · 第 %s 关</h1>"
        '<div class="sub">%s ｜ 合集 %s ｜ 生成于 %s</div>'
    ) % (html.escape(str(num)), html.escape(started), html.escape(name),
         datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

    cards = (
        '<div class="cards">'
        '<div class="card"><div class="k">Result</div><div class="v">%s</div></div>'
        '<div class="card"><div class="k">Platforms</div><div class="v">%d ok / %d failed</div></div>'
        '<div class="card"><div class="k">Duration</div><div class="v">%s</div></div>'
        "</div>"
    ) % (html.escape(overall), ok_n, bad_n, _fmt_sec(dur))

    rows = []
    for p in plats:
        rows.append(
            "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
            % (
                html.escape(p.get("name", "")),
                _pill(p.get("ok")),
                _fmt_sec(p.get("seconds")),
                html.escape(p.get("error") or ("—" if p.get("ok") else "")),
            )
        )
    table = (
        "<table><thead><tr><th>Platform</th><th>Status</th><th>Time</th><th>Note</th></tr>"
        "</thead><tbody>%s</tbody></table>" % "".join(rows)
    )

    body = [head, cards, table]

    # 错误详情
    for p in plats:
        if p.get("error"):
            detail = p.get("error", "")
            if p.get("steps_tail"):
                detail += "\n\n最后一步：" + p["steps_tail"]
            body.append('<div class="err">%s · %s\n%s</div>'
                        % (html.escape(p.get("name", "")), html.escape("失败"),
                           html.escape(detail)))

    # 截图
    shots = [p.get("shot") for p in plats if p.get("shot") and os.path.exists(p["shot"])]
    if shots:
        body.append("<h2>Screenshots</h2><div class=\"shots\">")
        for s in shots:
            body.append(
                '<a href="%s" target="_blank"><img src="%s" loading="lazy">'
                "<span>%s</span></a>"
                % (html.escape(_rel(s, OUT_DIR)), html.escape(_rel(s, OUT_DIR)),
                   html.escape(os.path.basename(s)))
            )
        body.append("</div>")
    else:
        body.append('<p class="muted" style="margin-top:20px">本次没有截图。</p>')

    body.append(
        '<p class="muted" style="margin-top:26px">截图目录：<code>06-存档/_运行截图/</code>'
        " ｜ 历史报告：<a href=\"index.html\">index.html</a></p></div>"
    )

    return ("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>Publish Report 第%s关</title><style>%s</style></head><body>%s</body></html>"
            % (html.escape(str(num)), CSS, "".join(body)))


def _write_index():
    files = sorted(
        [f for f in os.listdir(OUT_DIR) if f.endswith(".html") and f != "index.html"],
        reverse=True,
    )
    items = "".join(
        '<li><a href="%s">%s</a></li>' % (html.escape(f), html.escape(f)) for f in files[:60]
    )
    doc = ("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
           "<title>Publish Reports</title><style>%s</style></head><body><div class=\"wrap\">"
           "<h1>Publish Reports</h1><div class=\"sub\">共 %d 次运行，最新的在最上面</div>"
           '<h2>History</h2><ul>%s</ul></div></body></html>'
           % (CSS, len(files), items or "<li class=\"muted\">还没有报告</li>"))
    with open(os.path.join(OUT_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(doc)


def save(run):
    """写入单次报告 + 更新索引，返回报告路径"""
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    path = os.path.join(OUT_DIR, "%s_第%s关.html" % (stamp, run.get("关卡", "?")))
    with open(path, "w", encoding="utf-8") as f:
        f.write(render(run))
    with open(os.path.join(OUT_DIR, "last.json"), "w", encoding="utf-8") as f:
        json.dump(run, f, ensure_ascii=False, indent=1)
    _write_index()
    return path


def main():
    last = os.path.join(OUT_DIR, "last.json")
    if not os.path.exists(last):
        print("还没有运行记录：先跑一次 python pub_daily.py")
        return 1
    with open(last, encoding="utf-8") as f:
        run = json.load(f)
    path = save(run)
    print(path)
    if "--open" in sys.argv:
        if os.name == "nt":
            os.startfile(path)  # noqa: S606
        else:
            subprocess.run(["open" if sys.platform == "darwin" else "xdg-open", path])
    return 0


if __name__ == "__main__":
    sys.exit(main())
