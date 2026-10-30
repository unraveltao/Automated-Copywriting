// 头条合集去重：同名合集多于 1 个时，删掉多余的（保留第一个）
//   node pub_tt_collection_dedupe.js           干跑，只报数量
//   node pub_tt_collection_dedupe.js --go      真删
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const COLLECTIONS = 'https://mp.toutiao.com/profile_v4/graphic/collections';
const GO = process.argv.includes('--go');

// 列出「合集标题 + 该行删除按钮坐标」
async function rows(ed) {
  return ed.evaluate(function () {
    const vis = function (e) {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const del = Array.prototype.slice.call(document.querySelectorAll('*'))
      .filter(function (e) {
        if (!vis(e)) return false;
        if (e.children.length > 0) return false;
        return (e.innerText || '').trim() === '删除';
      })
      .map(function (e) {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: Math.round(r.top) };
      })
      .sort(function (a, b) { return a.top - b.top; });

    const titles = Array.prototype.slice.call(document.querySelectorAll('*'))
      .filter(function (e) {
        if (!vis(e) || e.children.length > 0) return false;
        const t = (e.innerText || '').trim();
        return t.indexOf('逻辑闯关') === 0 && t.length > 4;
      })
      .map(function (e) {
        const r = e.getBoundingClientRect();
        return { t: (e.innerText || '').trim(), top: Math.round(r.top) };
      })
      .sort(function (a, b) { return a.top - b.top; });

    return { del: del, titles: titles };
  });
}

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const out = { steps: [] };
  try {
    await page.goto(COLLECTIONS, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(page, 6000);

    let r = await rows(page);
    out.steps.push({ step: 'list', count: r.del.length, titles: r.titles });

    if (r.del.length <= 1) {
      out.steps.push({ step: 'nothing-to-do', count: r.del.length });
    } else {
      // 从最后一个往回删，保留第一条
      for (let i = r.del.length - 1; i >= 1; i--) {
        const d = r.del[i];
        await page.mouse.click(d.x, d.y);
        await sleep(page, 2500);

        const s1 = shotPath('tt-dedupe-confirm');
        await page.screenshot({ path: s1 });

        const dlg = await page.evaluate(function () {
          const vis = function (e) {
            const r = e.getBoundingClientRect();
            const s = getComputedStyle(e);
            return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
          };
          const btns = Array.prototype.slice.call(document.querySelectorAll('button,span,div'))
            .filter(function (e) {
              if (!vis(e) || e.children.length > 0) return false;
              const t = (e.innerText || '').trim();
              return ['确定', '确认', '删除', '确认删除', '取消'].indexOf(t) >= 0;
            })
            .map(function (e) {
              const b = e.getBoundingClientRect();
              return { t: (e.innerText || '').trim(), x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
            });
          return {
            text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 300),
            btns: btns,
          };
        });
        out.steps.push({ step: 'confirm-dialog', shot: s1, dlg: dlg });

        if (GO) {
          // 注意：行内也有一个「删除」，按文字取第一个会点到行按钮。
          // 弹窗里的确认键优先取「确定 / 确认 / 确认删除」，最后才退回「删除」。
          const order = ['确定', '确认', '确认删除', '删除'];
          let target = null;
          for (const t of order) {
            target = dlg.btns.find(function (b) { return b.t === t; });
            if (target) break;
          }
          if (target) {
            await page.mouse.click(target.x, target.y);
            out.steps.push({ step: 'clicked', t: target.t });
            await sleep(page, 4000);
          } else {
            out.steps.push({ step: 'no-confirm-btn' });
          }
        }
        await page.goto(COLLECTIONS, { waitUntil: 'domcontentloaded' }).catch(function () {});
        await sleep(page, 5000);
        r = await rows(page);
        out.steps.push({ step: 'recount', count: r.del.length });
        if (r.del.length <= 1) break;
      }
    }

    const s2 = shotPath('tt-dedupe-final');
    await page.screenshot({ path: s2 });
    out.steps.push({ step: 'final', shot: s2, count: (await rows(page)).del.length });
    console.log(JSON.stringify(out, null, 1));
  } finally {
    await ctx.close();
  }
})().catch(function (e) {
  console.log(JSON.stringify({ step: 'error', error: String((e && e.message) || e) }));
});
