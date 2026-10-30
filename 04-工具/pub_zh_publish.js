// 知乎文章发布
//
//   node pub_zh_publish.js 1              填充到编辑器，停住等确认（默认干跑）
//   node pub_zh_publish.js 1 --go         填充后直接发布
//   node pub_zh_publish.js 1 --gate       填充后等 04-工具/.zh-go 文件出现再发布
//   node pub_zh_publish.js 1 --at="2026-10-31 12:00"   定时发布
//
//   可选：--no-cover 不上传封面 / --no-timer 不设定时
//
// 环境变量：
//   ZH_WAIT_SEC   gate 模式等待秒数，默认 900
const fs = require('fs');
const path = require('path');
const { launch, shotPath, ROOT } = require('./pub_browser');

const num = Number(process.argv[2]);
const GO = process.argv.includes('--go');
const GATE = process.argv.includes('--gate');
const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : null;
};
const AT = argOf('at');                       // "YYYY-MM-DD HH:MM"
const NO_COVER = process.argv.includes('--no-cover');
const WAIT_SEC = Number(process.env.ZH_WAIT_SEC || 900);
const GATE_FILE = path.join(__dirname, '.zh-go');

const log = (o) => console.log(JSON.stringify(o));
const { sleep } = require('./pub_browser');   // 统一走速度开关 PUB_SPEED
const steps = [];

// —— 知乎标题：规范要求 ≤16 字 ——
const TITLE_MAP = {
  1: '第1关｜守卫难题：怎样找到宝箱？',
  2: '第2关｜骑士与骗子岛：哪句话没人说得出？',
  3: '第3关｜卡片翻面：该翻哪两张？',
  4: '第4关｜蓝眼睛岛民：一句废话改变一切',
  5: '第5关｜帽子问题：他没说，你该听出什么？',
  6: '第6关｜三门问题：那扇门说了什么？',
  7: '第7关｜体检假阳性：阳性就是有病吗？',
  8: '第8关｜生日悖论：23 人为啥就够了？',
  9: '第9关｜双信封悖论：看到 100 元换不换？',
  10: '第10关｜季终：三份材料你先信哪个？',
};

// 11 关以后：按「第N关｜谜题名：钩子」自动压到 16 字内
function zhTitle(n, raw) {
  if (TITLE_MAP[n]) return TITLE_MAP[n];
  const m = raw.match(/^第(\d+)关｜(.+?)：(.+)$/);
  if (!m) return raw.slice(0, 16);
  const head = `第${m[1]}关｜${m[2]}：`;
  const room = 16 - head.length - 1; // 留一个问号
  let hook = m[3].replace(/[？?]$/, '');
  if (hook.length > room) hook = hook.slice(0, Math.max(2, room));
  return `${head}${hook}？`;
}

// —— 找物料 ——
function findArticle(n) {
  const dir = path.join(ROOT, '01-内容', '逻辑闯关');
  const pre = `第${n}关｜`;
  const f = fs.readdirSync(dir).find((x) => x.startsWith(pre) && x.endsWith('.md'));
  if (!f) throw new Error(`找不到第${n}关的物料`);
  return path.join(dir, f);
}

// —— Markdown → HTML（够用就好，覆盖本系列用到的语法）——
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}
function mdToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  let inQuote = false;
  let listType = null;

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t) { closeList(); closeQuote(); i++; continue; }

    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { closeList(); closeQuote(); out.push('<hr>'); i++; continue; }

    // 标题
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList(); closeQuote();
      const lv = Math.min(h[1].length + 1, 6); // # → h2（h1 留给标题框）
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      i++; continue;
    }

    // 引用
    if (/^>\s?/.test(t)) {
      closeList();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push(`<p>${inline(t.replace(/^>\s?/, ''))}</p>`);
      i++; continue;
    }
    closeQuote();

    // 有序 / 无序列表
    const ul = t.match(/^[-*+]\s+(.*)$/);
    const ol = t.match(/^\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (listType && listType !== want) closeList();
      if (!listType) { out.push(`<${want}>`); listType = want; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      i++; continue;
    }
    closeList();

    // 普通段落（连续非空行合并）
    const buf = [t];
    i++;
    while (i < lines.length) {
      const nx = lines[i].trim();
      if (!nx || /^(#{1,6}\s|>|[-*+]\s|\d+\.\s|-{3,}$)/.test(nx)) break;
      buf.push(nx);
      i++;
    }
    out.push(`<p>${inline(buf.join(''))}</p>`);
  }
  closeList(); closeQuote();
  return out.join('\n');
}

// —— 按可见文字点 ——
async function pointOfText(ed, text, opts = {}) {
  return ed.evaluate(({ t, exact, minTop }) => {
    const els = [...document.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      const txt = (e.innerText || '').trim();
      if (!(r.width > 0 && r.height > 0)) return false;
      if (r.top < minTop) return false;
      return exact ? txt === t : txt.includes(t);
    });
    if (!els.length) return null;
    els.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, txt: (els[0].innerText || '').trim().slice(0, 30) };
  }, { t: text, exact: opts.exact !== false, minTop: opts.minTop ?? 0 });
}

// —— 正文粘贴：优先用 paste 事件（Draft.js 认这个）——
async function paste(ed, html, plain) {
  return ed.evaluate(({ h, p }) => {
    const el = document.querySelector('.public-DraftEditor-content');
    if (!el) return false;
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/html', h);
    dt.setData('text/plain', p);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return true;
  }, { h: html, p: plain });
}

// 正文结构指纹：判断是否真的渲染成了标题/引用/分隔线
async function bodyShape(ed) {
  return ed.evaluate(() => {
    const root = document.querySelector('.public-DraftEditor-content');
    if (!root) return null;
    const q = (s) => root.querySelectorAll(s).length;
    return {
      chars: (root.innerText || '').length,
      h2: q('h2'), h3: q('h3'), h4: q('h4'),
      blockquote: q('blockquote'),
      hr: q('hr'),
      li: q('li'),
      strong: q('strong'),
      p: q('p'),
      sample: (root.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 200),
    };
  });
}

// —— 主流程 ——
(async () => {
  const articlePath = findArticle(num);
  const raw = fs.readFileSync(articlePath, 'utf8');
  const rawTitle = (raw.match(/^#\s+(.+)$/m) || [])[1] || '';
  const bodyMd = raw.replace(/^#\s+.+\n?/, '').trim();
  const title = zhTitle(num, rawTitle);
  steps.push({ step: 'material', file: path.basename(articlePath), rawTitle, title, titleLen: title.length, bodyChars: bodyMd.length });

  const html = mdToHtml(bodyMd);

  const { ctx, page } = await launch({ headless: false, profile: 'zhihu' });
  const ed = page;
  try {
    await ed.goto('https://zhuanlan.zhihu.com/write', { waitUntil: 'domcontentloaded' });
    await sleep(ed, 6000);
    steps.push({ step: 'editor-open', url: ed.url() });

    // 1. 标题
    const ta = ed.locator('textarea[placeholder*="请输入标题"]').first();
    if (!(await ta.count())) throw new Error('找不到标题输入框');
    await ta.click();
    await ta.fill(title);
    await sleep(ed, 800);
    const gotTitle = await ta.inputValue();
    steps.push({ step: 'title', got: gotTitle, ok: gotTitle === title });
    if (gotTitle !== title) throw new Error(`标题没填对：期望「${title}」，实际「${gotTitle}」`);

    // 2. 正文
    const box = ed.locator('.public-DraftEditor-content').first();
    if (!(await box.count())) throw new Error('找不到正文编辑区');
    await box.click();
    await sleep(ed, 500);
    await paste(ed, html, bodyMd);
    await sleep(ed, 4000);

    let shape = await bodyShape(ed);
    steps.push({ step: 'body-paste', shape });

    // 如果没渲染出结构（可能 Markdown 模式吞了 HTML），改用逐行纯文本兜底
    if (!shape || shape.chars < 50 || (shape.h2 === 0 && shape.h3 === 0 && shape.blockquote === 0)) {
      steps.push({ step: 'body-fallback', note: 'HTML 没渲染出结构，改贴纯文本 Markdown' });
      await box.click();
      await ed.keyboard.press('Control+A');
      await ed.keyboard.press('Backspace');
      await sleep(ed, 800);
      await paste(ed, '', bodyMd);
      await sleep(ed, 4000);
      shape = await bodyShape(ed);
      steps.push({ step: 'body-fallback-shape', shape });
    }

    // 3. 封面（知乎的 file input 是隐藏的，直接 setInputFiles 最稳）
    if (!NO_COVER) {
      const coverFile = path.join(ROOT, '02-视觉', '逻辑闯关', '公众号封面', `第${num}关-${rawTitle.split('｜')[1].split('：')[0]}.png`);
      if (fs.existsSync(coverFile)) {
        const fileInput = ed.locator('input.UploadPicture-input').first();
        const cnt = await fileInput.count();
        if (cnt) {
          await fileInput.setInputFiles(coverFile);
          await sleep(ed, 6000);
          steps.push({ step: 'cover', file: path.basename(coverFile), ok: true, via: 'input.UploadPicture-input' });
        } else {
          steps.push({ step: 'cover', ok: false, note: '找不到 input.UploadPicture-input' });
        }
      } else {
        steps.push({ step: 'cover', ok: false, note: '封面文件不存在：' + coverFile });
      }
    }

    await sleep(ed, 3000);
    const shot = shotPath(`zh-${num}-ready`);
    await ed.screenshot({ path: shot });
    steps.push({ step: 'ready', shot });

    // 4. 决定是否发布
    if (!GO && !GATE) {
      log({ ok: true, dryRun: true, num, title, steps });
      return;
    }

    if (GATE) {
      log({ ok: true, waiting: true, num, title, shot, msg: `等 ${GATE_FILE} 出现后自动发布` });
      const deadline = Date.now() + WAIT_SEC * 1000;
      while (Date.now() < deadline) {
        if (fs.existsSync(GATE_FILE)) break;
        await sleep(ed, 2000);
      }
      if (!fs.existsSync(GATE_FILE)) {
        log({ ok: false, num, reason: 'gate-timeout', steps });
        return;
      }
      try { fs.unlinkSync(GATE_FILE); } catch (e) {}
      steps.push({ step: 'gate-open' });
    }

    // 5. 发布
    const pubBtn = await ed.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const b = [...document.querySelectorAll('button')].filter((e) => vis(e) && (e.innerText || '').trim() === '发布');
      if (!b.length) return null;
      const e = b[b.length - 1];
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!pubBtn) throw new Error('找不到「发布」按钮');
    await ed.mouse.click(pubBtn.x, pubBtn.y);
    await sleep(ed, 4000);

    const shotDlg = shotPath(`zh-${num}-publish-dialog`);
    await ed.screenshot({ path: shotDlg });
    const dlgText = await ed.evaluate(() => (document.body.innerText || '').slice(0, 600).replace(/\n{2,}/g, '\n'));
    steps.push({ step: 'after-publish-click', shot: shotDlg, text: dlgText });

    log({ ok: true, num, title, shot: shotDlg, steps });
  } catch (e) {
    let shot = null;
    try { shot = shotPath(`zh-${num}-error`); await ed.screenshot({ path: shot }); } catch (_) {}
    log({ ok: false, num, error: String((e && e.message) || e), shot, steps });
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
