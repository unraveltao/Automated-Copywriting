# -*- coding: utf-8 -*-
"""发布台：本地一个网页，三平台物料一键复制、发完打勾。

    python pub_panel.py                 # 起服务并自动打开浏览器
    python pub_panel.py --port 8766     # 换端口
    python pub_panel.py --no-open       # 不自动开浏览器

为什么是本地网页而不是"全自动发布"：
个人订阅号没有发布 API，小红书没有开放接口，知乎没有对外接口。
浏览器自动化能填稿，但选择器一改就断，还可能踩风控。
这个面板把发布压到"复制 → 粘贴 → 点发送 → 打勾"，每篇约 30 秒，零风险。

只监听 127.0.0.1，不对外。
"""

import json
import os
import sys
import glob
import webbrowser
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import series
import pub_ledger

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = series.ROOT

OPEN_URL = {
    "公众号": "https://mp.weixin.qq.com/",
    "知乎": "https://zhuanlan.zhihu.com/write",
    "小红书": "https://creator.xiaohongshu.com/publish/publish",
}

PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>发布台 · __SERIES__</title>
<style>
:root{
  --bg:#FAFAF9; --panel:#FFFFFF; --line:#E8E6E1; --ink:#1A1A1A; --sub:#6B6B6B;
  --accent:#A32D2D; --ok:#1D9E75; --warn:#BA7517;
}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:14px;}
header{padding:16px 24px;background:var(--panel);border-bottom:1px solid var(--line);
  display:flex;align-items:center;gap:24px;flex-wrap:wrap;}
h1{font-size:16px;font-weight:600;margin:0;}
.meta{color:var(--sub);font-size:13px;}
.meta b{color:var(--ink);font-weight:600;}
main{display:grid;grid-template-columns:260px 1fr;min-height:calc(100vh - 64px);}
aside{border-right:1px solid var(--line);background:var(--panel);overflow-y:auto;
  max-height:calc(100vh - 64px);padding:8px 0;}
.item{padding:10px 16px;cursor:pointer;border-left:3px solid transparent;
  display:flex;gap:8px;align-items:flex-start;}
.item:hover{background:#F5F3EF;}
.item.on{background:#FBF1F1;border-left-color:var(--accent);}
.item .n{font-size:12px;color:var(--sub);min-width:34px;font-variant-numeric:tabular-nums;}
.item .t{font-size:13px;line-height:1.4;}
.dots{display:flex;gap:3px;margin-top:4px;}
.dot{width:6px;height:6px;border-radius:50%;background:#D8D6D0;}
.dot.ok{background:var(--ok);}
section{padding:20px 24px;overflow-y:auto;max-height:calc(100vh - 64px);}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:16px 18px;margin-bottom:16px;}
.card h2{font-size:14px;margin:0 0 10px;display:flex;align-items:center;gap:10px;}
.badge{font-size:11px;padding:2px 8px;border-radius:20px;background:#F1EFE8;color:var(--sub);font-weight:400;}
.badge.ok{background:#E1F5EE;color:var(--ok);}
.badge.warn{background:#FAEEDA;color:var(--warn);}
.title{font-size:13px;color:var(--sub);margin-bottom:10px;line-height:1.6;
  word-break:break-all;}
.title b{color:var(--ink);font-weight:500;}
.btns{display:flex;gap:8px;flex-wrap:wrap;}
button{font:inherit;font-size:13px;padding:7px 14px;border-radius:6px;cursor:pointer;
  border:1px solid var(--line);background:#fff;color:var(--ink);}
button:hover{border-color:#C9C6BF;background:#FAFAF9;}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff;}
button.primary:hover{background:#8C2626;}
button.done{background:#E1F5EE;border-color:#9FE1CB;color:#085041;}
button:disabled{opacity:.45;cursor:not-allowed;}
.prev{margin-top:12px;border-top:1px dashed var(--line);padding-top:12px;display:none;}
.prev.open{display:block;}
.prev iframe{width:100%;height:420px;border:1px solid var(--line);border-radius:6px;background:#fff;}
.hint{font-size:12px;color:var(--sub);margin-top:10px;line-height:1.6;}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
  background:#1A1A1A;color:#fff;padding:9px 18px;border-radius:20px;font-size:13px;
  opacity:0;transition:opacity .2s;pointer-events:none;}
.toast.on{opacity:1;}
.empty{color:var(--sub);padding:40px;text-align:center;line-height:2;}
code{background:#F1EFE8;padding:1px 5px;border-radius:3px;font-size:12px;}
</style>
</head>
<body>
<header>
  <h1>发布台</h1>
  <span class="meta">__SERIES__ ｜ 今天该发 <b id="today">—</b></span>
  <span class="meta" id="stats"></span>
</header>
<main>
  <aside id="list"></aside>
  <section id="detail"><div class="empty">左边选一关</div></section>
</main>
<div class="toast" id="toast"></div>
<script>
const OPEN = __OPEN_URL__;
let STATE = null, CUR = null, CACHE = {};

function toast(t){
  const el = document.getElementById('toast');
  el.textContent = t; el.classList.add('on');
  clearTimeout(el._t); el._t = setTimeout(()=>el.classList.remove('on'), 1600);
}

async function boot(){
  STATE = await (await fetch('/api/state')).json();
  document.getElementById('today').textContent =
    STATE.today.length ? STATE.today.map(n=>'第'+n+'关').join('、') : '（无）';
  document.getElementById('stats').innerHTML = STATE.stats.map(
    s=>`${s.plat} <b>${s.done}</b>/${s.total}`).join(' ｜ ');
  renderList();
  const first = STATE.today[0] || (STATE.items[0] && STATE.items[0].num);
  if(first) select(first);
}

function renderList(){
  const box = document.getElementById('list');
  const ready = STATE.items.filter(it=>it.meta);
  const rest = STATE.items.length - ready.length;
  const rows = ready.map(it=>{
    const dots = ['公众号','知乎','小红书'].map(p=>{
      const st = (it.ledger[p]||{}).状态 || '待发';
      return `<span class="dot ${st==='已发'?'ok':''}"></span>`;
    }).join('');
    return `<div class="item" data-num="${it.num}" onclick="select(${it.num})">
      <span class="n">${it.num}</span>
      <span><span class="t">${esc(it.meta.谜题)}</span>
      <span class="dots">${dots}</span></span></div>`;
  }).join('');
  const tail = rest ? `<div class="item" style="cursor:default;color:var(--sub);font-size:12px;">
      另有 ${rest} 关未备料<br><code>python pub_pack.py --today</code></div>` : '';
  box.innerHTML = rows + tail;
  document.querySelectorAll('.item[data-num]').forEach(el=>{
    el.classList.toggle('on', +el.dataset.num === CUR);
  });
}

function stBadge(st){
  const cls = st==='已发' ? 'ok' : (st==='跳过' ? 'warn' : '');
  return `<span class="badge ${cls}">${st}</span>`;
}

async function select(num){
  CUR = num; renderList();
  const it = STATE.items.find(x=>x.num===num);
  const box = document.getElementById('detail');
  if(!it || !it.meta){ box.innerHTML = '<div class="empty">这一关还没备料<br><code>python pub_pack.py '+num+'</code></div>'; return; }

  const m = it.meta, L = it.ledger;
  const p = (k)=> (L[k]||{}).状态 || '待发';
  const rows = [];

  rows.push(card('公众号', p('公众号'),
    `<b>${m.公众号.标题}</b>`,
    m.公众号.封面 ? `封面：${m.公众号.封面.split('\\\\').pop()}` : '⚠ 没有公众号封面，先跑 <code>make_covers_wx.py '+num+'</code>',
    [btn('复制富文本','primary',`copyRich(${num},'wx',this)`),
     btn('复制标题',`copyText('${esc(m.公众号.标题)}',this)`),
     btn('打开后台',`openPlat('公众号')`),
     btn('预览',`togglePrev(${num},'wx',this)`),
     btn('标记已发',`mark(${num},'公众号','已发')`)],
    num, 'wx'));

  const zt = m.知乎.标题 + (m.知乎.需确认 ? '  ⚠ 需人工确认（规则压缩过，可能丢半句）' : '');
  rows.push(card('知乎', p('知乎'),
    `<b>${esc(zt)}</b><br>标签：${m.知乎.标签.join(' ')}`,
    '',
    [btn('复制富文本','primary',`copyRich(${num},'zh',this)`),
     btn('复制标题',`copyText('${esc(m.知乎.标题)}',this)`),
     btn('改标题',`editTitle(${num})`),
     btn('复制标签',`copyText('${esc(m.知乎.标签.join(' '))}',this)`),
     btn('打开后台',`openPlat('知乎')`),
     btn('预览',`togglePrev(${num},'zh',this)`),
     btn('标记已发',`mark(${num},'知乎','已发')`)],
    num, 'zh'));

  const x = m.小红书;
  const xbtns = [
    btn('复制文案','primary',`copyText(${JSON.stringify(x.文案).replace(/"/g,'&quot;')},this)`),
    btn('复制标题',`copyText(${JSON.stringify(x.标题).replace(/"/g,'&quot;')},this)`),
    btn('复制标签',`copyText('${esc(x.标签.join(' '))}',this)`),
    btn('打开后台',`openPlat('小红书')`),
    btn('标记已发',`mark(${num},'小红书','已发')`)
  ];
  if(x.docx) xbtns.splice(1,0,btn('下载文档',`dl(${JSON.stringify(x.docx).replace(/"/g,'&quot;')})`));
  if(x.封面) xbtns.splice(2,0,btn('下载封面',`dl(${JSON.stringify(x.封面).replace(/"/g,'&quot;')})`));
  rows.push(card('小红书', p('小红书'),
    `<b>${x.标题}</b><br>标签：${x.标签.join(' ')}`,
    x.docx ? '文档已就绪（单次只能传 1 个文件）' : '⚠ 没有文档版，先跑 <code>mk_xhs_note.py '+num+' --docx</code>',
    xbtns, num, 'xhs'));

  box.innerHTML = rows.join('');
}

function card(name, st, body, hint, btns, num, key){
  return `<div class="card">
    <h2>${name} ${stBadge(st)}</h2>
    <div class="title">${body}</div>
    <div class="btns">${btns.join('')}</div>
    ${hint?`<div class="hint">${hint}</div>`:''}
    <div class="prev" id="prev-${key}"></div>
  </div>`;
}

function btn(label, cls, action){
  const c = (cls==='primary') ? 'primary' : '';
  return `<button class="${c}" onclick="${action}">${label}</button>`;
}

function esc(s){
  return String(s)
    .replace(/\\/g,'\\\\')
    .replace(/'/g,"\\'")
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;');
}

async function getHtml(num, key){
  const id = num+'-'+key;
  if(CACHE[id]) return CACHE[id];
  const r = await fetch(`/api/html?num=${num}&plat=${key}`);
  const t = await r.text();
  CACHE[id] = t; return t;
}

async function copyRich(num, key, el){
  const html = await getHtml(num, key);
  const div = document.createElement('div');
  div.contentEditable = 'true';
  div.style.position='fixed'; div.style.left='-9999px'; div.style.top='0';
  div.innerHTML = html;
  document.body.appendChild(div);
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  let ok = false;
  try{ ok = document.execCommand('copy'); }catch(e){}
  sel.removeAllRanges(); div.remove();
  toast(ok ? '已复制富文本，去编辑器里 Ctrl+V' : '复制失败，用「预览」全选复制');
}

function copyText(s, el){
  const ta = document.createElement('textarea');
  ta.value = s; ta.style.position='fixed'; ta.style.left='-9999px';
  document.body.appendChild(ta); ta.select();
  let ok=false; try{ ok = document.execCommand('copy'); }catch(e){}
  ta.remove();
  toast(ok ? '已复制' : '复制失败');
}

function openPlat(name){ window.open(OPEN[name], '_blank'); }

function dl(path){
  const a = document.createElement('a');
  a.href = '/asset?p=' + encodeURIComponent(path);
  a.download = path.split(/[\\\\/]/).pop();
  a.click();
}

async function togglePrev(num, key, el){
  const box = document.getElementById('prev-'+key);
  if(box.classList.contains('open')){ box.classList.remove('open'); el.textContent='预览'; return; }
  const html = await getHtml(num, key);
  box.innerHTML = `<iframe srcdoc="${html.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}"></iframe>`;
  box.classList.add('open'); el.textContent='收起';
}

async function editTitle(num){
  const it = STATE.items.find(x=>x.num===num);
  const cur = it.meta.知乎.标题;
  const t = prompt('知乎标题（建议 16 字以内，知乎会截断长标题）', cur);
  if(!t || t === cur) return;
  const r = await fetch('/api/title', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({num, plat:'知乎', title:t})});
  if(!r.ok){ toast('保存失败'); return; }
  it.meta.知乎.标题 = t;
  it.meta.知乎.需确认 = false;
  toast('标题已保存');
  select(num);
}

async function mark(num, plat, status){
  const r = await fetch('/api/mark', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({num, plat, status})});
  if(!r.ok){ toast('写入失败'); return; }
  const it = STATE.items.find(x=>x.num===num);
  it.ledger[plat] = Object.assign(it.ledger[plat]||{}, {状态:status});
  toast('已标记 ' + plat + ' ' + status);
  renderList(); select(num);
  const d = await (await fetch('/api/state')).json();
  STATE.stats = d.stats;
  document.getElementById('stats').innerHTML = STATE.stats.map(
    s=>`${s.plat} <b>${s.done}</b>/${s.total}`).join(' ｜ ');
}

boot();
</script>
</body>
</html>
"""


def collect(name):
    """扫描发布包 + 台账，拼出面板需要的状态。"""
    led = pub_ledger.load(name)
    pack_root = series.arc(name, "发布包")
    metas = {}
    if os.path.isdir(pack_root):
        for d in sorted(os.listdir(pack_root)):
            mp = os.path.join(pack_root, d, "meta.json")
            if os.path.exists(mp):
                try:
                    with open(mp, encoding="utf-8") as f:
                        m = json.load(f)
                    metas[m["关"]] = m
                except Exception:
                    pass

    nums = sorted(set(pub_ledger.all_nums(name)) | set(metas.keys()))
    items = []
    for n in nums:
        items.append({
            "num": n,
            "meta": metas.get(n),
            "ledger": led["记录"].get(str(n), {}),
        })

    stats = []
    for p in pub_ledger.PLATFORMS:
        done = sum(1 for it in items if (it["ledger"].get(p, {}) or {}).get("状态") == "已发")
        stats.append({"plat": p, "done": done, "total": len(items)})

    today, total = pub_ledger.due(name)
    return {"series": name, "items": items, "stats": stats, "today": today,
            "pending": total}


class Handler(BaseHTTPRequestHandler):
    series_name = "逻辑闯关"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/":
            html = PAGE.replace("__SERIES__", self.series_name).replace(
                "__OPEN_URL__", json.dumps(OPEN_URL, ensure_ascii=False))
            return self._send(200, html, "text/html; charset=utf-8")

        if u.path == "/api/state":
            return self._send(200, json.dumps(collect(self.series_name), ensure_ascii=False))

        if u.path == "/api/html":
            num = int(q.get("num", ["0"])[0])
            plat = q.get("plat", ["wx"])[0]
            fn = {"wx": "公众号.html", "zh": "知乎.html"}.get(plat)
            if not fn:
                return self._send(404, "no such platform")
            p = os.path.join(series.arc(self.series_name, "发布包"), "第%03d关" % num, fn)
            if not os.path.exists(p):
                return self._send(404, "not found")
            with open(p, encoding="utf-8") as f:
                return self._send(200, f.read(), "text/html; charset=utf-8")

        if u.path == "/asset":
            p = q.get("p", [""])[0]
            rp = os.path.realpath(p)
            if not rp.startswith(os.path.realpath(ROOT)):
                return self._send(403, "forbidden")
            if not os.path.isfile(rp):
                return self._send(404, "not found")
            ext = os.path.splitext(rp)[1].lower()
            ctype = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                     ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                     ".md": "text/plain; charset=utf-8"}.get(ext, "application/octet-stream")
            with open(rp, "rb") as f:
                return self._send(200, f.read(), ctype)

        return self._send(404, "not found")

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length", 0))
        if u.path == "/api/title":
            try:
                data = json.loads(self.rfile.read(n).decode("utf-8"))
                num = int(data["num"])
                plat = data.get("plat", "知乎")
                mp = os.path.join(series.arc(self.series_name, "发布包"), "第%03d关" % num, "meta.json")
                with open(mp, encoding="utf-8") as f:
                    meta = json.load(f)
                meta.setdefault(plat, {})["标题"] = data["title"]
                meta[plat]["需确认"] = False
                with open(mp, "w", encoding="utf-8") as f:
                    json.dump(meta, f, ensure_ascii=False, indent=2)
            except Exception as e:
                return self._send(400, json.dumps({"error": str(e)}, ensure_ascii=False))
            return self._send(200, json.dumps({"ok": True}))

        if u.path != "/api/mark":
            return self._send(404, "not found")
        try:
            data = json.loads(self.rfile.read(n).decode("utf-8"))
            pub_ledger.mark(self.series_name, int(data["num"]), data["plat"],
                            data.get("status", "已发"), data.get("url", ""))
        except Exception as e:
            return self._send(400, json.dumps({"error": str(e)}, ensure_ascii=False))
        return self._send(200, json.dumps({"ok": True}))


def main():
    name, rest = series.pick(sys.argv[1:])
    port, auto_open = 8765, True
    i = 0
    while i < len(rest):
        if rest[i] == "--port" and i + 1 < len(rest):
            port = int(rest[i + 1]); i += 2; continue
        if rest[i] == "--no-open":
            auto_open = False
        i += 1

    Handler.series_name = name
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = "http://127.0.0.1:%d/" % port
    print("发布台：%s" % url)
    print("合集：%s ｜ Ctrl+C 退出" % name)
    if auto_open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")


if __name__ == "__main__":
    main()
