// 头条合集：创建「逻辑闯关」
//   node pub_tt_collection.js --probe      只看创建弹窗结构（默认）
//   node pub_tt_collection.js --create     真建
const path = require('path');
const { launch, shotPath, ROOT } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const COLLECTIONS = 'https://mp.toutiao.com/profile_v4/graphic/collections';

async function clickText(ed, text, opts) {
  opts = opts || {};
  const exact = opts.exact !== false;
  const pt = await ed.evaluate(function (a) {
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const hit = all.filter(function (e) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      const t = (e.innerText || '').trim();
      if (a.maxLen && t.length > a.maxLen) return false;
      return a.ex ? t === a.t : t.indexOf(a.t) >= 0;
    });
    if (!hit.length) return null;
    hit.sort(function (x, y) {
      const rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect();
      return rx.width * rx.height - ry.width * ry.height;
    });
    const r = hit[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: (hit[0].innerText || '').trim().slice(0, 30) };
  }, { t: text, ex: exact, maxLen: opts.maxLen || 0 });
  if (!pt) return null;
  await ed.mouse.click(pt.x, pt.y);
  return pt;
}

async function dumpDialog(ed) {
  return ed.evaluate(function () {
    const vis = function (e) {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const all = Array.prototype.slice.call(document.querySelectorAll('*')).filter(vis);
    const fields = all
      .filter(function (e) { return /^(INPUT|TEXTAREA)$/.test(e.tagName); })
      .map(function (e) {
        const r = e.getBoundingClientRect();
        return {
          tag: e.tagName, type: e.type || '', ph: e.placeholder || '',
          maxLen: e.maxLength, cls: (e.className || '').toString().slice(0, 80),
          x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width),
        };
      });
    const texts = [];
    const seen = {};
    all.forEach(function (e) {
      if (e.children.length > 0) return;
      const t = (e.innerText || '').trim();
      if (!t || t.length > 40) return;
      const r = e.getBoundingClientRect();
      if (seen[t + Math.round(r.top)]) return;
      seen[t + Math.round(r.top)] = 1;
      texts.push({ t: t, x: Math.round(r.left), y: Math.round(r.top) });
    });
    const files = Array.prototype.slice.call(document.querySelectorAll('input[type=file]')).map(function (e) {
      return { accept: e.accept, cls: (e.className || '').toString().slice(0, 60) };
    });
    return { url: location.href, fields: fields, texts: texts.slice(0, 80), files: files };
  });
}

async function cropOpen(w) {
  return w.evaluate(function () {
    return (document.body.innerText || '').indexOf('封面图编辑') >= 0;
  });
}

// 上传后一定会弹「封面图编辑」。图没加载完时「确定」点不动，所以要循环到弹窗真的关掉。
async function confirmCrop(w) {
  let appeared = false;
  for (let i = 0; i < 30; i++) {
    if (await cropOpen(w)) { appeared = true; break; }
    await sleep(w, 500);
  }
  if (!appeared) return { appeared: false, clicks: 0, closed: false };
  let clicks = 0;
  for (let i = 0; i < 12; i++) {
    if (!(await cropOpen(w))) break;
    const btn = w.locator('button:has-text("确定")').last();
    await btn.click({ timeout: 4000 }).catch(function () {});
    clicks++;
    await sleep(w, 1500);
  }
  return { appeared: true, clicks: clicks, closed: !(await cropOpen(w)) };
}

(async function () {
  const argv = process.argv.slice(2);
  const doCreate = argv.indexOf('--create') >= 0;
  const doFill = argv.indexOf('--fill') >= 0;

  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const ed = page;
  const out = { steps: [] };
  try {
    await ed.goto(COLLECTIONS, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function (e) {
      out.steps.push({ step: 'goto-warn', err: String(e.message).slice(0, 120) });
    });
    await sleep(ed, 6000);

    for (const t of ['我知道了', '知道了', '跳过']) {
      const p = await clickText(ed, t, { exact: true, maxLen: 8 });
      if (p) { out.steps.push({ step: 'dismiss', text: t }); await sleep(ed, 1000); }
    }

    out.steps.push({ step: 'page', url: ed.url(), shot: await (async () => { const s = shotPath('tt-coll'); await ed.screenshot({ path: s }); return s; })() });

    const body = await ed.evaluate(function () { return (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 500); });
    out.steps.push({ step: 'body', text: body });

    const c = await clickText(ed, '创建合集', { exact: true, maxLen: 12 });
    out.steps.push({ step: 'click-创建合集', pt: c });
    await sleep(ed, 5000);

    // 「创建合集」可能同页跳转，也可能开新标签页——统一取 URL 里带 collection-publish 的那个
    let w = ed;
    for (const pg of ctx.pages()) {
      if (pg.url().indexOf('collection-publish') >= 0) { w = pg; break; }
    }
    out.steps.push({ step: 'editor', url: w.url(), pages: ctx.pages().length });

    const s2 = shotPath('tt-coll-dialog');
    await w.screenshot({ path: s2 });
    const dlg = await dumpDialog(w);
    out.steps.push({ step: 'dialog', shot: s2, dialog: dlg });

    if (doFill || doCreate) {
      // 标题：5-30 字，带主题/类别关键词
      const title = process.env.TT_COLL_TITLE || '逻辑闯关：100 道经典逻辑谜题';
      const input = w.locator('input.byte-input').first();
      await input.click();
      await input.fill(title);
      await sleep(w, 600);
      out.steps.push({ step: 'fill-title', title: title, len: title.length });

      // 封面：裁切框是 16:9，图已按 16:9 出好，进来只需点「确定」
      // 坑：图还在加载时「确定」是灰的，点了没反应，弹窗会一直挂着——所以要循环确认
      const cover = process.env.TT_COLL_COVER || path.join(
        ROOT, '02-视觉', '逻辑闯关', '合集封面', '逻辑闯关-16x9.png');
      await w.locator('input[type=file]').first().setInputFiles(cover);
      await sleep(w, 5000);
      // 坑：裁切弹窗不是上传后立刻出现，可能拖到点「创建合集」时才弹。
      // 所以这里先等一轮，提交后再等一轮，两边都要确认掉。
      const crop1 = await confirmCrop(w);
      out.steps.push({ step: 'upload-cover', file: cover, crop: crop1 });

      const s3 = shotPath('tt-coll-filled');
      await w.screenshot({ path: s3 });
      const state = await w.evaluate(function () {
        const btns = Array.prototype.slice.call(document.querySelectorAll('button,div,span'))
          .filter(function (e) {
            const t = (e.innerText || '').trim();
            const r = e.getBoundingClientRect();
            return t === '创建合集' && r.width > 0 && r.height > 0 && e.children.length <= 1;
          })
          .map(function (e) {
            const r = e.getBoundingClientRect();
            return { cls: (e.className || '').toString().slice(0, 70), disabled: !!e.disabled,
              x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) };
          });
        return {
          url: location.href,
          text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 600),
          btns: btns,
        };
      });
      out.steps.push({ step: 'filled', shot: s3, state: state });

      if (doCreate) {
        // 按钮用 class 定位：页面上「创建合集」还有面包屑/标题两处同名文本，按文字点会点到面包屑
        // 提交可能被裁切弹窗拦下：点一次 → 确认裁切 → 若还停在编辑页就再点一次
        for (let round = 1; round <= 3; round++) {
          const b = w.locator('button.byte-btn-primary:has-text("创建合集")').last();
          await b.click({ timeout: 15000 }).catch(function () {});
          out.steps.push({ step: 'submit', round: round });
          await sleep(w, 4000);

          const crop = await confirmCrop(w);
          out.steps.push({ step: 'crop-on-submit', round: round, crop: crop });

          await sleep(w, 4000);
          const still = await w.evaluate(function () {
            return /collection-publish/.test(location.href);
          }).catch(function () { return true; });
          if (!still) { out.steps.push({ step: 'left-editor', round: round }); break; }
        }

        const s4 = shotPath('tt-coll-after');
        await w.screenshot({ path: s4 });
        const after = await w.evaluate(function () {
          return { url: location.href, text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 500) };
        });
        out.steps.push({ step: 'after', shot: s4, state: after });

        // 回合集列表核对：标题在不在
        await w.goto(COLLECTIONS, { waitUntil: 'domcontentloaded' }).catch(function () {});
        await sleep(w, 5000);
        const s5 = shotPath('tt-coll-verify');
        await w.screenshot({ path: s5 });
        const verify = await w.evaluate(function () {
          return { url: location.href, text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 600) };
        });
        out.steps.push({ step: 'verify', shot: s5, state: verify });
      }
    }

    console.log(JSON.stringify(out, null, 1));
  } catch (e) {
    let shot = null;
    try { shot = shotPath('tt-coll-error'); await ed.screenshot({ path: shot }); } catch (_) {}
    console.log(JSON.stringify({ error: String((e && e.message) || e), shot: shot, steps: out.steps }, null, 1));
  } finally {
    await ctx.close();
  }
})();
