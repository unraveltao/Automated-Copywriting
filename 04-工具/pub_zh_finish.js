// 知乎收尾：从草稿箱续编辑 → 加话题 → 传封面 →（可选）发布
//
//   node pub_zh_finish.js 8            只做到发布前，截图给你看
//   node pub_zh_finish.js 8 --go       真发布
//   node pub_zh_finish.js 8 --tags=概率论,数学,思维方法
const fs = require('fs');
const path = require('path');
const { launch, shotPath, ROOT } = require('./pub_browser');

const sleep = (p, ms) => p.waitForTimeout(ms);
const num = Number(process.argv[2]);
const GO = process.argv.includes('--go');
const argOf = function (k) {
  const a = process.argv.find(function (x) { return x.indexOf('--' + k + '=') === 0; });
  return a ? a.slice(k.length + 3) : null;
};
const TAGS = (argOf('tags') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
const PREFIX = '第' + num + '关';
const steps = [];
const log = function (o) { console.log(JSON.stringify(o)); };

async function clickText(ed, text, opts) {
  opts = opts || {};
  const exact = opts.exact !== false;
  const pt = await ed.evaluate(function (a) {
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const hit = all.filter(function (e) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      const t = (e.innerText || '').trim();
      return a.exact ? t === a.t : t.indexOf(a.t) >= 0;
    });
    if (!hit.length) return null;
    hit.sort(function (x, y) {
      const rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect();
      return rx.width * rx.height - ry.width * ry.height;
    });
    const r = hit[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { t: text, exact: exact });
  if (!pt) return false;
  await ed.mouse.click(pt.x, pt.y);
  return true;
}

// 从草稿箱打开草稿
async function openDraft(ctx, ed) {
  await ed.goto('https://www.zhihu.com/creator/manage/creation/all', { waitUntil: 'domcontentloaded' });
  await sleep(ed, 7000);
  await clickText(ed, '草稿箱', { exact: false });
  await sleep(ed, 5000);

  const row = await ed.evaluate(function (pre) {
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const leaf = all.filter(function (e) {
      return e.children.length === 0 && (e.innerText || '').trim().indexOf(pre) === 0;
    })[0];
    if (!leaf) return null;
    const r = leaf.getBoundingClientRect();
    return { title: leaf.innerText.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
  }, PREFIX);
  if (!row) throw new Error('草稿箱里没有 ' + PREFIX + ' 的草稿');
  steps.push({ step: 'find-draft', title: row.title });

  await ed.mouse.move(row.x, row.y);
  await sleep(ed, 1200);
  const editPt = await ed.evaluate(function (top) {
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const hit = all.filter(function (e) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      const t = (e.innerText || '').trim();
      return t.indexOf('编辑') >= 0 && t.length < 8 && r.top > top - 80 && r.top < top + 200;
    });
    if (!hit.length) return null;
    hit.sort(function (x, y) {
      const rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect();
      return rx.width * rx.height - ry.width * ry.height;
    });
    const r = hit[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, row.top);
  if (!editPt) throw new Error('找不到「编辑」按钮');
  await ed.mouse.click(editPt.x, editPt.y);
  await sleep(ed, 8000);

  const pages = ctx.pages();
  const w = pages[pages.length - 1];
  await w.waitForLoadState('domcontentloaded').catch(function () {});
  await sleep(w, 3000);
  steps.push({ step: 'editor', url: w.url().slice(0, 80) });
  return w;
}

// 读当前已加的话题
async function existingTopics(w) {
  return w.evaluate(function () {
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const row = all.filter(function (e) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 100 && r.height > 10 && r.height < 120)) return false;
      return (e.innerText || '').trim().indexOf('文章话题') === 0;
    })[0];
    if (!row) return [];
    return String(row.innerText || '').split('\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return s && s !== '文章话题' && s.indexOf('添加话题') < 0; });
  });
}

// 加话题：搜索 → 点第一条匹配
async function addTopics(w, tags) {
  const have = await existingTopics(w);
  steps.push({ step: 'topics-before', have: have });
  for (const tag of tags) {
    if (have.some(function (h) { return h === tag || h.indexOf(tag) >= 0; })) {
      steps.push({ step: 'topic-skip', tag: tag, note: '已存在' });
      continue;
    }
    await w.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(w, 1200);

    let input = w.locator('input[placeholder="搜索话题..."]').first();
    // 搜索框默认是收起的，要先点「+ 添加话题」
    if (!(await input.count()) || !(await input.isVisible().catch(function () { return false; }))) {
      const okAdd = await clickText(w, '添加话题', { exact: false });
      steps.push({ step: 'topic-open', tag: tag, clicked: okAdd });
      await sleep(w, 2000);
      input = w.locator('input[placeholder="搜索话题..."]').first();
    }
    if (!(await input.count()) || !(await input.isVisible().catch(function () { return false; }))) {
      steps.push({ step: 'topic', tag: tag, ok: false, note: '搜索框没出现' });
      continue;
    }

    await input.click();
    await sleep(w, 600);
    await input.fill('');
    await input.type(tag, { delay: 90 });
    await sleep(w, 2500);

    const opts = await w.evaluate(function () {
      const all = Array.prototype.slice.call(document.querySelectorAll('*'));
      const hit = all.filter(function (e) {
        const r = e.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return false;
        if (e.children.length > 0) return false;
        const t = (e.innerText || '').trim();
        return t.length > 0 && t.length < 20 && r.width < 400 && r.height < 60;
      });
      return hit.map(function (e) {
        const r = e.getBoundingClientRect();
        return { t: (e.innerText || '').trim(), x: Math.round(r.left), y: Math.round(r.top) };
      });
    });
    steps.push({ step: 'topic-search', tag: tag, n: opts.length, sample: opts.slice(0, 25) });

    // 在搜索框下方找与关键词最接近的一项
    const pick = opts
      .filter(function (o) { return o.y > 380; })
      .filter(function (o) { return o.t.indexOf(tag) >= 0 || tag.indexOf(o.t) >= 0; })
      .sort(function (a, b) { return Math.abs(a.t.length - tag.length) - Math.abs(b.t.length - tag.length); })[0];

    if (!pick) { steps.push({ step: 'topic', tag: tag, ok: false, note: '下拉里没有匹配项' }); continue; }
    await w.mouse.click(pick.x + 20, pick.y + 8);
    await sleep(w, 1800);
    steps.push({ step: 'topic', tag: tag, ok: true, picked: pick.t });
  }
}

// 传封面
async function uploadCover(w, file) {
  const already = await w.evaluate(function () {
    // 没上传时会有「+ 添加文章封面」占位；上传后占位消失
    const hasPlaceholder = (document.body.innerText || '').indexOf('添加文章封面') >= 0;
    const box = document.querySelector('.UploadPicture-wrapper');
    const imgs = box ? box.querySelectorAll('img').length : 0;
    return { hasPlaceholder: hasPlaceholder, imgs: imgs, exists: !hasPlaceholder || imgs > 0 };
  });
  steps.push({ step: 'cover-check', detail: already });
  if (already.exists) { steps.push({ step: 'cover-skip', note: '已有封面' }); return; }

  const label = w.locator('label.UploadPicture-wrapper').first();
  if (!(await label.count())) { steps.push({ step: 'cover', ok: false, note: '找不到封面 label' }); return; }

  let chooser = null;
  try {
    const p = w.waitForEvent('filechooser', { timeout: 6000 }).catch(function () { return null; });
    await label.click();
    chooser = await p;
  } catch (e) { chooser = null; }

  if (chooser) {
    await chooser.setFiles(file);
    await sleep(w, 7000);
    steps.push({ step: 'cover', ok: true, via: 'filechooser', file: path.basename(file) });
  } else {
    const inp = w.locator('input.UploadPicture-input').first();
    if (await inp.count()) {
      await inp.setInputFiles(file);
      await sleep(w, 7000);
      steps.push({ step: 'cover', ok: true, via: 'setInputFiles', file: path.basename(file) });
    } else {
      steps.push({ step: 'cover', ok: false, note: '两种方式都失败' });
    }
  }

  const hasImg = await w.evaluate(function () {
    const box = document.querySelector('.UploadPicture-wrapper') || document.body;
    return { imgs: box.querySelectorAll('img').length, bg: getComputedStyle(box).backgroundImage.slice(0, 40) };
  });
  steps.push({ step: 'cover-verify', hasImg: hasImg });
}

// 收录进专栏「逻辑闯关」（知乎没有独立的「合集」，专栏就是合集）
// 入口：专栏页 → 「收录内容」抽屉 → 该文章那一行的「收录」
const COL_URL = 'https://www.zhihu.com/column/c_2097038288662152717';
const COL_NAME = '逻辑闯关';

async function includeToColumn(w) {
  await w.goto(COL_URL, { waitUntil: 'domcontentloaded' });
  await sleep(w, 6000);

  const before = await w.evaluate(function (pre) {
    const txt = document.body.innerText || '';
    const m = txt.match(/·\s*(\d+)\s*篇内容/);
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const inList = all.some(function (e) {
      if (e.children.length > 0) return false;
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      return (e.innerText || '').trim().indexOf(pre) === 0;
    });
    return { count: m ? Number(m[1]) : null, hasTarget: inList };
  }, PREFIX);
  steps.push({ step: 'column-before', column: COL_NAME, detail: before });

  if (before.hasTarget) {
    steps.push({ step: 'column-skip', note: '已在专栏里' });
    return true;
  }

  const opened = await clickText(w, '收录内容', { exact: true });
  await sleep(w, 3500);
  steps.push({ step: 'column-drawer', opened: opened });
  if (!opened) return false;

  const target = await w.evaluate(function (pre) {
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const leaf = all.filter(function (e) {
      if (e.children.length > 0) return false;
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      return (e.innerText || '').trim().indexOf(pre) === 0;
    })[0];
    if (!leaf) return null;
    const rowY = leaf.getBoundingClientRect().top;
    const btns = all.filter(function (e) {
      const rr = e.getBoundingClientRect();
      if (!(rr.width > 0 && rr.height > 0)) return false;
      if ((e.innerText || '').trim() !== '收录') return false;
      return Math.abs(rr.top - rowY) < 60;
    });
    if (!btns.length) return { title: leaf.innerText.trim(), btn: null };
    btns.sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
    const br = btns[0].getBoundingClientRect();
    return { title: leaf.innerText.trim(), btn: { x: br.left + br.width / 2, y: br.top + br.height / 2 } };
  }, PREFIX);

  steps.push({ step: 'column-target', target: target });
  if (!target || !target.btn) return false;

  await w.mouse.click(target.btn.x, target.btn.y);
  await sleep(w, 4000);
  await w.keyboard.press('Escape').catch(function () {});
  await sleep(w, 1200);

  await w.reload({ waitUntil: 'domcontentloaded' });
  await sleep(w, 6000);
  const after = await w.evaluate(function (pre) {
    const txt = document.body.innerText || '';
    const m = txt.match(/·\s*(\d+)\s*篇内容/);
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const inList = all.some(function (e) {
      if (e.children.length > 0) return false;
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      return (e.innerText || '').trim().indexOf(pre) === 0;
    });
    return { count: m ? Number(m[1]) : null, hasTarget: inList };
  }, PREFIX);
  steps.push({ step: 'column-after', detail: after });
  return after.hasTarget;
}

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'zhihu' });
  let w = page;
  try {
    w = await openDraft(ctx, page);

    const state = await w.evaluate(function () {
      const ta = document.querySelector('textarea[placeholder*="请输入标题"]');
      const body = document.querySelector('.public-DraftEditor-content');
      return { title: ta ? ta.value : null, bodyChars: body ? (body.innerText || '').length : null };
    });
    steps.push({ step: 'state', state: state });

    if (TAGS.length) await addTopics(w, TAGS);

    // 封面
    const coverFile = path.join(ROOT, '02-视觉', '逻辑闯关', '公众号封面', '第' + num + '关-' + (await w.evaluate(function () {
      const ta = document.querySelector('textarea[placeholder*="请输入标题"]');
      return ta ? ta.value : '';
    })).split('｜')[1].split('：')[0] + '.png');
    if (fs.existsSync(coverFile)) await uploadCover(w, coverFile);
    else steps.push({ step: 'cover', ok: false, note: '封面不存在：' + coverFile });

    await w.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(w, 1500);
    const shot = shotPath('zh-' + num + '-final');
    await w.screenshot({ path: shot });
    steps.push({ step: 'ready', shot: shot });

    // 顶部截图，确认标题和开头
    await w.evaluate(function () { window.scrollTo(0, 0); });
    await sleep(w, 1500);
    const shotTop = shotPath('zh-' + num + '-top');
    await w.screenshot({ path: shotTop });
    steps.push({ step: 'top', shot: shotTop });

    await w.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(w, 1500);

    if (!GO) {
      log({ ok: true, dryRun: true, num: num, shot: shot, top: shotTop, steps: steps });
      return;
    }

    const pubPt = await w.evaluate(function () {
      const all = Array.prototype.slice.call(document.querySelectorAll('button'));
      const hit = all.filter(function (e) {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (e.innerText || '').trim() === '发布';
      });
      if (!hit.length) return null;
      const e = hit[hit.length - 1];
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!pubPt) throw new Error('找不到「发布」按钮');
    await w.mouse.click(pubPt.x, pubPt.y);
    await sleep(w, 5000);

    const shot2 = shotPath('zh-' + num + '-after-publish');
    await w.screenshot({ path: shot2 });

    // 可能出现二次确认弹窗
    let confirmed = false;
    for (let i = 0; i < 6; i++) {
      const has = await w.evaluate(function () { return /确认发布|确定发布|继续发布/.test(document.body.innerText); });
      if (!has) break;
      const ok = await clickText(w, '确认发布', { exact: false }) || await clickText(w, '确定发布', { exact: false }) || await clickText(w, '继续发布', { exact: false });
      steps.push({ step: 'confirm', round: i + 1, ok: ok });
      if (ok) { confirmed = true; await sleep(w, 6000); }
      else break;
    }
    steps.push({ step: 'confirmed', confirmed: confirmed });

    const shot3 = shotPath('zh-' + num + '-result');
    await w.screenshot({ path: shot3 });
    const tail = await w.evaluate(function () {
      return { url: location.href, text: (document.body.innerText || '').slice(-700) };
    });
    steps.push({ step: 'after-publish', shot: shot3, url: tail.url, tail: tail.text });

    // 发布后自动收录进专栏「逻辑闯关」
    let inColumn = false;
    try {
      inColumn = await includeToColumn(w);
    } catch (e) {
      steps.push({ step: 'column-error', error: String((e && e.message) || e) });
    }
    steps.push({ step: 'column', ok: inColumn, name: COL_NAME });

    log({ ok: true, num: num, go: true, shot: shot3, url: tail.url, column: inColumn, steps: steps });
  } catch (e) {
    let shot = null;
    try { shot = shotPath('zh-' + num + '-finish-error'); await w.screenshot({ path: shot }); } catch (_) {}
    log({ ok: false, num: num, error: String((e && e.message) || e), shot: shot, steps: steps });
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
