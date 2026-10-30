// 今日头条图文发布
//
//   node pub_tt_publish.js 8            填充到编辑器，停住（截图给你看）
//   node pub_tt_publish.js 8 --go       真发布
//   node pub_tt_publish.js 8 --probe    只 dump 编辑器结构，不动内容
//
// 选项：--no-cover 不传封面
const fs = require('fs');
const path = require('path');
const { launch, shotPath, ROOT } = require('./pub_browser');
const { mdToHtml, ttTitle } = require('./pub_md');

const { sleep } = require('./pub_browser');   // 统一走速度开关 PUB_SPEED
const num = Number(process.argv[2]);
const GO = process.argv.includes('--go');
const PROBE = process.argv.includes('--probe');
const PROBE_SCHEDULE = process.argv.includes('--probe-schedule');
const NO_COVER = process.argv.includes('--no-cover');
const EDITOR = 'https://mp.toutiao.com/profile_v4/graphic/publish';
const steps = [];
const log = function (o) { console.log(JSON.stringify(o)); };

// —— 找物料 ——
function findArticle(n) {
  const dir = path.join(ROOT, '01-内容', '逻辑闯关');
  const pre = '第' + n + '关｜';
  const f = fs.readdirSync(dir).find(function (x) { return x.indexOf(pre) === 0 && x.slice(-3) === '.md'; });
  if (!f) throw new Error('找不到第' + n + '关的物料');
  return path.join(dir, f);
}

// 按可见文字点（取面积最小的那个）
async function clickText(ed, text, opts) {
  opts = opts || {};
  const exact = opts.exact !== false;
  const pt = await ed.evaluate(function (a) {
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const hit = all.filter(function (e) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      const t = (e.innerText || '').trim();
      return a.ex ? t === a.t : t.indexOf(a.t) >= 0;
    });
    if (!hit.length) return null;
    hit.sort(function (x, y) {
      const rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect();
      return rx.width * rx.height - ry.width * ry.height;
    });
    const r = hit[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: (hit[0].innerText || '').trim().slice(0, 20) };
  }, { t: text, ex: exact });
  if (!pt) return null;
  await ed.mouse.click(pt.x, pt.y);
  return pt;
}

// 粘贴 HTML（ProseMirror / 富文本编辑器认 paste 事件）
async function pasteHtml(ed, html, plain) {
  return ed.evaluate(function (a) {
    const cands = Array.prototype.slice.call(document.querySelectorAll('.ProseMirror, .ql-editor, [contenteditable="true"]'));
    const el = cands.filter(function (e) {
      const r = e.getBoundingClientRect();
      return r.width > 200 && r.height > 100;
    })[0];
    if (!el) return { ok: false, note: '没找到大的 contenteditable' };
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/html', a.h);
    dt.setData('text/plain', a.p);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return { ok: true, cls: String(el.className || '').slice(0, 60) };
  }, { h: html, p: plain });
}

async function bodyShape(ed) {
  return ed.evaluate(function () {
    const cands = Array.prototype.slice.call(document.querySelectorAll('.ProseMirror, .ql-editor, [contenteditable="true"]'));
    const el = cands.filter(function (e) {
      const r = e.getBoundingClientRect();
      return r.width > 200 && r.height > 100;
    })[0];
    if (!el) return null;
    const q = function (s) { return el.querySelectorAll(s).length; };
    return {
      chars: (el.innerText || '').length,
      h1: q('h1'), h2: q('h2'), h3: q('h3'), h4: q('h4'),
      blockquote: q('blockquote'), hr: q('hr'), li: q('li'), strong: q('strong'), p: q('p'),
      sample: (el.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 200),
    };
  });
}

// 关掉可能的引导弹窗
async function dismiss(ed) {
  const TEXTS = ['我知道了', '知道了', '我知道了，开始创作', '关闭', '下次再说', '跳过'];
  for (let i = 0; i < 3; i++) {
    let hit = null;
    for (const t of TEXTS) {
      hit = await clickText(ed, t, { exact: true });
      if (hit) { steps.push({ step: 'dismiss', text: t }); break; }
    }
    if (!hit) break;
    await sleep(ed, 1200);
  }
}

async function probe(ed) {
  return ed.evaluate(function () {
    const out = { inputs: [], editables: [], buttons: [], flags: {}, bodyText: '' };
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    all.forEach(function (e) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') {
        out.inputs.push({ tag: e.tagName, ph: e.getAttribute('placeholder') || '', cls: String(e.className || '').slice(0, 60), rect: rect });
      }
      const ce = e.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') {
        out.editables.push({ cls: String(e.className || '').slice(0, 60), rect: rect, text: String(e.innerText || '').trim().slice(0, 40) });
      }
      if (e.tagName === 'BUTTON') {
        const t = (e.innerText || '').trim();
        if (t && t.length < 12) out.buttons.push({ t: t, rect: rect });
      }
    });
    const txt = document.body.innerText || '';
    out.flags = {
      有AI声明: /AI\s*生成|人工智能|作品声明/.test(txt),
      有定时发布: /定时发布|定时/.test(txt),
      有原创: /原创/.test(txt),
      有封面: /封面/.test(txt),
      有标签: /标签/.test(txt),
    };
    out.bodyText = txt.replace(/\n{2,}/g, '\n').slice(0, 1200);
    return out;
  });
}

// —— 设置区（正文下方的长条）——
async function scrollToText(ed, text) {
  return ed.evaluate(function (t) {
    const hit = Array.prototype.slice.call(document.querySelectorAll('*')).filter(function (e) {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (e.innerText || '').trim() === t;
    })[0];
    if (!hit) return false;
    hit.scrollIntoView({ block: 'center' });
    return true;
  }, text);
}

// 封面区的「+」占位框：加号是图标不是文字，按「虚线边框 + 尺寸」定位最稳
async function findPlusBox(ed) {
  return ed.evaluate(function () {
    const vis = function (e) {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const label = Array.prototype.slice.call(document.querySelectorAll('*')).filter(function (e) {
      return vis(e) && (e.innerText || '').trim() === '展示封面';
    })[0];
    const ly = label ? label.getBoundingClientRect().top : 0;

    const dashed = Array.prototype.slice.call(document.querySelectorAll('div')).filter(function (e) {
      if (!vis(e)) return false;
      const s = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const dash = /dashed|dotted/.test(s.borderStyle) || /dashed|dotted/.test(s.outlineStyle);
      return dash && r.width > 120 && r.width < 260 && r.height > 120 && r.height < 260;
    });
    if (dashed.length) {
      dashed.sort(function (a, b) {
        return Math.abs(a.getBoundingClientRect().top - ly) - Math.abs(b.getBoundingClientRect().top - ly);
      });
      const r = dashed[0].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, via: 'dashed' };
    }

    // 退路：从「展示封面」往下量一个固定偏移
    if (label) {
      const r = label.getBoundingClientRect();
      return { x: r.left + 120, y: r.top + 96, via: 'offset' };
    }
    return null;
  });
}

// 发完会弹「作品同步授权」（同步到懂车帝/住小帮）。这是账号级授权，
// 不该由发布脚本替账号做主，一律点取消。
async function cancelSyncDialog(ed) {
  const open = await ed.evaluate(function () {
    return /作品同步授权/.test(document.body.innerText || '');
  });
  if (!open) return { shown: false };
  const btn = ed.getByRole('button', { name: '取消' }).last();
  if (await btn.count()) {
    await btn.click({ timeout: 5000 }).catch(function () {});
    await sleep(ed, 1500);
  }
  const still = await ed.evaluate(function () { return /作品同步授权/.test(document.body.innerText || ''); });
  return { shown: true, closed: !still };
}


async function uploadCover(ed, file) {
  await scrollToText(ed, '展示封面');
  await sleep(ed, 1200);
  await dismiss(ed); // 「支持为文章添加城市」的蓝色提示条会挡住封面框
  await sleep(ed, 800);

  const plus = await findPlusBox(ed);
  if (!plus) return { ok: false, note: '找不到封面占位框' };
  await ed.mouse.click(plus.x, plus.y);
  await sleep(ed, 3000);

  const dlgOpen = await ed.evaluate(function () {
    return /上传图片/.test(document.body.innerText || '');
  });

  let set = false;
  // 页面上不止一个 file input（编辑器插图、封面素材弹窗各有一个），
  // 逐个试，直到弹窗里出现「已上传 N 张图片」为止。
  const cnt = await ed.locator('input[type=file]').count();
  for (let i = 0; i < cnt; i++) {
    await ed.locator('input[type=file]').nth(i).setInputFiles(file).catch(function () {});
    await sleep(ed, 2500);
    const added = await ed.evaluate(function () {
      return /已上传\s*\d+\s*张图片/.test(document.body.innerText || '');
    });
    if (added) { set = true; break; }
  }

  // 点弹窗右下角的「确定」，图没处理完时按钮是灰的，所以重试几轮
  let clicks = 0;
  for (let i = 0; i < 6; i++) {
    const still = await ed.evaluate(function () { return /上传图片/.test(document.body.innerText || ''); });
    if (!still) break;
    const ok = ed.getByRole('button', { name: '确定' }).last();
    await ok.click({ timeout: 5000 }).catch(function () {});
    clicks++;
    await sleep(ed, 2500);
  }

  const closed = !(await ed.evaluate(function () { return /上传图片/.test(document.body.innerText || ''); }));
  return { ok: set && closed, set: set, dlgOpen: dlgOpen, clicks: clicks, closed: closed, via: plus.via };
}


  // 用 locator 而不是按坐标点：它会自己滚进视野、等元素可点，
  // 前面的封面上传会改变滚动位置，按坐标点很容易点空。
async function addToCollection(ed, name) {
  // 用 locator 而不是按坐标点：它会自己滚进视野、等元素可点，
  // 前面的封面上传会改变滚动位置，按坐标点很容易点空。
  const btn = ed.getByText('添加至合集', { exact: false }).first();
  if (!(await btn.count())) return { ok: false, note: '找不到「添加至合集」' };
  await btn.scrollIntoViewIfNeeded().catch(function () {});
  await btn.click({ timeout: 10000 }).catch(function () {});
  await sleep(ed, 3500);

  const shot = shotPath('tt-coll-pick');
  await ed.screenshot({ path: shot });

  const dlgText = await ed.evaluate(function () {
    const d = document.querySelector('[role=dialog], .byte-modal, .byte-drawer');
    const src = d || document.body;
    return (src.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 500);
  });

  const item = ed.getByText(name, { exact: false }).first();
  if (!(await item.count())) {
    return { ok: false, note: '弹窗里没找到合集「' + name + '」', shot: shot, dlg: dlgText };
  }
  await item.click({ timeout: 8000 }).catch(function () {});
  await sleep(ed, 1200);

  const okBtn = ed.getByRole('button', { name: '确定' }).first();
  let confirmed = false;
  if (await okBtn.count()) {
    await okBtn.click({ timeout: 8000 }).catch(function () {});
    confirmed = true;
  } else {
    const alt = ed.getByText('确定', { exact: true }).last();
    if (await alt.count()) { await alt.click({ timeout: 6000 }).catch(function () {}); confirmed = true; }
  }
  await sleep(ed, 2500);

  const s2 = shotPath('tt-coll-picked');
  await ed.screenshot({ path: s2 });
  return { ok: true, picked: name, confirm: confirmed, shot: s2, dlg: dlgText };
}

// 「同时发布微头条」默认勾着，会多出一条重复内容，关掉
// 它的 checkbox 是隐藏的（真实控件是自绘的），所以直接在页面里调 click()
async function uncheckMicro(ed) {
  return ed.evaluate(function () {
    const vis = function (e) {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const lab = Array.prototype.slice.call(document.querySelectorAll('*')).filter(function (e) {
      return vis(e) && (e.innerText || '').trim().indexOf('发布得更多收益') >= 0;
    })[0];
    if (!lab) return { ok: false, note: '没找到微头条那行' };

    let box = lab;
    for (let i = 0; i < 8 && box; i++) {
      const inp = box.querySelector && box.querySelector('input[type=checkbox]');
      if (inp) {
        if (inp.checked) inp.click();
        return { ok: true, before: true, after: inp.checked, clicked: true };
      }
      box = box.parentElement;
    }
    return { ok: false, note: '没找到 checkbox' };
  });
}


(async function () {
  const articlePath = findArticle(num);
  const raw = fs.readFileSync(articlePath, 'utf8');
  const rawTitle = (raw.match(/^#\s+(.+)$/m) || [])[1] || '';
  const bodyMd = raw.replace(/^#\s+.+\n?/, '').trim();
  const title = ttTitle(num, rawTitle);
  const html = mdToHtml(bodyMd);

  const coverFile = path.join(ROOT, '02-视觉', '逻辑闯关', '公众号封面',
    '第' + num + '关-' + rawTitle.split('｜')[1].split('：')[0] + '.png');

  steps.push({
    step: 'material',
    file: path.basename(articlePath),
    rawTitle: rawTitle,
    title: title,
    titleLen: title.length,
    bodyChars: bodyMd.length,
    cover: fs.existsSync(coverFile) ? path.basename(coverFile) : null,
  });

  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const ed = page;
  try {
    await ed.goto(EDITOR, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(ed, 8000);

    if (/sso\.toutiao\.com|passport/.test(ed.url())) {
      throw new Error('登录态失效或账号未完成注册，当前地址：' + ed.url());
    }
    steps.push({ step: 'editor', url: ed.url() });

    await dismiss(ed);

    if (PROBE) {
      const s = shotPath('tt-probe-' + num);
      await ed.screenshot({ path: s });
      const d = await probe(ed);
      log({ ok: true, probe: true, shot: s, detail: d, steps: steps });
      return;
    }

    // 1. 标题
    let ta = ed.locator('textarea[placeholder*="标题"]').first();
    if (!(await ta.count())) ta = ed.locator('input[placeholder*="标题"]').first();
    if (!(await ta.count())) throw new Error('找不到标题输入框');
    await ta.click();
    await ta.fill(title);
    await sleep(ed, 800);
    const gotTitle = await ta.inputValue().catch(function () { return ''; });
    steps.push({ step: 'title', got: gotTitle, ok: gotTitle === title });
    if (gotTitle !== title) throw new Error('标题没填对：期望「' + title + '」，实际「' + gotTitle + '」');

    // 2. 正文
    const pasted = await pasteHtml(ed, html, bodyMd);
    steps.push({ step: 'body-paste', pasted: pasted });
    await sleep(ed, 5000);
    let shape = await bodyShape(ed);
    steps.push({ step: 'body-shape', shape: shape });

    if (!shape || shape.chars < 50) {
      // 兜底：先点进正文区再贴
      const box = ed.locator('.ProseMirror, [contenteditable="true"]').first();
      if (await box.count()) {
        await box.click();
        await sleep(ed, 600);
        const p2 = await pasteHtml(ed, html, bodyMd);
        await sleep(ed, 5000);
        shape = await bodyShape(ed);
        steps.push({ step: 'body-retry', pasted: p2, shape: shape });
      }
    }

    // 3. 封面：点 + → 素材弹窗传图 → 确定
    if (!NO_COVER && fs.existsSync(coverFile)) {
      const up = await uploadCover(ed, coverFile);
      const sCover = shotPath('tt-' + num + '-cover');
      await ed.screenshot({ path: sCover });
      steps.push({ step: 'cover', file: path.basename(coverFile), up: up, shot: sCover });
    }


    // 4. 加合集
    const coll = await addToCollection(ed, process.env.TT_COLLECTION || '逻辑闯关');
    steps.push({ step: 'collection', result: coll });

    // 5. 关掉「同时发布微头条」——只要文章，不要多一条重复的微头条
    const micro = await uncheckMicro(ed);
    steps.push({ step: 'micro', result: micro });

    // 5.5 探测「定时发布」弹层：只 dump 结构，不排期、不发布
    //    封面是必填项，没设上时点定时发布会静默无反应——所以这段必须放在封面之后
    if (PROBE_SCHEDULE) {
      await ed.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
      await sleep(ed, 1500);
      const btn = ed.locator('button:has-text("定时发布")').last();
      const bb = await btn.boundingBox().catch(function () { return null; });
      // 点之前先读按钮自身状态：disabled / aria-disabled / class 里有没有 disabled
      const attrs = await btn.evaluate(function (e) {
        return {
          disabled: !!e.disabled, aria: e.getAttribute('aria-disabled'),
          cls: String(e.className || '').slice(0, 120),
          html: e.outerHTML.slice(0, 300),
        };
      }).catch(function () { return null; });
      const before = await ed.evaluate(function () { return document.body.innerText || ''; });
      await btn.click({ timeout: 8000 }).catch(function () {});
      // 点后 8 秒内每 1 秒抓一次，抓一闪而过的 toast
      const changes = [];
      for (let i = 0; i < 8; i++) {
        await sleep(ed, 1000);
        const now = await ed.evaluate(function () { return document.body.innerText || ''; });
        if (now !== before) {
          const added = now.split('\n').filter(function (s) { return s.trim() && before.indexOf(s.trim()) < 0; });
          if (added.length) changes.push({ t: i + 1, added: added.slice(0, 6) });
        }
      }
      const shot = shotPath('tt-sched-probe');
      await ed.screenshot({ path: shot });
      const dump = await ed.evaluate(function () {
        const vis = function (e) {
          const r = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        // 不限 z-index，把所有浮在正文之上的绝对/固定层都收上来
        const layers = [];
        document.querySelectorAll('div, section, aside, ul').forEach(function (e) {
          if (!vis(e)) return;
          const s = getComputedStyle(e);
          if (s.position !== 'fixed' && s.position !== 'absolute') return;
          const r = e.getBoundingClientRect();
          if (r.width < 60 || r.height < 30) return;
          if (r.top > window.innerHeight || r.bottom < 0) return;
          layers.push({
            pos: s.position, z: s.zIndex,
            rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
            text: (e.innerText || '').replace(/\n+/g, ' | ').slice(0, 240),
          });
        });
        const fields = [];
        document.querySelectorAll('input').forEach(function (e) {
          if (!vis(e)) return;
          const r = e.getBoundingClientRect();
          fields.push({
            type: e.getAttribute('type') || '', ph: e.getAttribute('placeholder') || '',
            val: (e.value || '').slice(0, 30), cls: String(e.className || '').slice(0, 50),
            rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) },
          });
        });
        return { layers: layers.slice(0, 12), fields: fields };
      });
      steps.push({ step: 'probe-schedule', btn: bb, attrs: attrs, changes: changes, shot: shot, dump: dump });
      log({ ok: true, probeSchedule: true, num: num, shot: shot, steps: steps });
      return;
    }

    await sleep(ed, 2000);
    await ed.evaluate(function () { window.scrollTo(0, 0); });
    await sleep(ed, 1200);
    const shotTop = shotPath('tt-' + num + '-top');
    await ed.screenshot({ path: shotTop });

    await ed.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(ed, 1500);
    const shotBottom = shotPath('tt-' + num + '-bottom');
    await ed.screenshot({ path: shotBottom });
    steps.push({ step: 'ready', shotTop: shotTop, shotBottom: shotBottom });

    const d = await probe(ed);
    steps.push({ step: 'state', flags: d.flags, buttons: d.buttons.slice(0, 25) });

    if (!GO) {
      log({ ok: true, dryRun: true, num: num, title: title, shotTop: shotTop, shotBottom: shotBottom, steps: steps });
      return;
    }

    // 6. 发布
    await ed.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(ed, 1500);
    const hitPub = await clickText(ed, '预览并发布', { exact: true });
    steps.push({ step: 'click-publish', hit: hitPub });
    await sleep(ed, 7000);

    const sPub = shotPath('tt-' + num + '-pub');
    await ed.screenshot({ path: sPub });
    const pubState = await ed.evaluate(function () {
      return { url: location.href, text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(-700) };
    });
    steps.push({ step: 'after-publish-click', shot: sPub, state: pubState });

    // 预览页/弹窗里可能还要再点一次「确认发布」
    // 注意：不能盲点「确定」——发完会弹「作品同步授权」，点确定会把作品同步到懂车帝/住小帮，
    // 那是账号级授权，不是本次发布该做的决定。这里只认「确认发布 / 确定发布」。
    for (let round = 1; round <= 2; round++) {
      let hit = null;
      for (const t of ['确认发布', '确定发布']) {
        hit = await clickText(ed, t, { exact: true });
        if (hit) { steps.push({ step: 'confirm', round: round, text: t }); break; }
      }
      if (!hit) break;
      await sleep(ed, 6000);
      const s2 = shotPath('tt-' + num + '-pub' + round);
      await ed.screenshot({ path: s2 });
      steps.push({
        step: 'after-confirm', round: round, shot: s2,
        state: await ed.evaluate(function () {
          return { url: location.href, text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(-500) };
        }),
      });
      await cancelSyncDialog(ed);
    }

    // 7. 核对：去作品管理看第一行
    await ed.goto('https://mp.toutiao.com/profile_v4/graphic/articles', { waitUntil: 'domcontentloaded' }).catch(function () {});
    await sleep(ed, 6000);
    const sList = shotPath('tt-' + num + '-list');
    await ed.screenshot({ path: sList });
    const listState = await ed.evaluate(function () {
      return { url: location.href, text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 700) };
    });
    steps.push({ step: 'verify-list', shot: sList, state: listState });

    log({ ok: true, num: num, go: true, title: title, shotTop: shotTop, shotBottom: shotBottom, steps: steps });
  } catch (e) {
    let shot = null;
    try { shot = shotPath('tt-' + num + '-error'); await ed.screenshot({ path: shot }); } catch (_) {}
    log({ ok: false, num: num, error: String((e && e.message) || e), shot: shot, steps: steps });
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
