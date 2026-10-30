// 探头条「合集」：作品管理 → 合集，看现有合集与创建入口
//   node pub_tt_probe_collection.js
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

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

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const ed = page;
  const out = { steps: [] };
  try {
    await ed.goto('https://mp.toutiao.com/profile_v4/index', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(ed, 6000);

    // 关掉引导气泡
    for (const t of ['我知道了', '知道了', '跳过']) {
      const p = await clickText(ed, t, { exact: true });
      if (p) { out.steps.push({ step: 'dismiss', text: t }); await sleep(ed, 1200); }
    }

    const c1 = await clickText(ed, '作品管理', { exact: false });
    await sleep(ed, 5000);
    out.steps.push({ step: 'click-作品管理', pt: c1, url: ed.url() });

    const s1 = shotPath('tt-manage');
    await ed.screenshot({ path: s1 });

    const tabs = await ed.evaluate(function () {
      const all = Array.prototype.slice.call(document.querySelectorAll('*'));
      const res = [];
      const seen = {};
      all.forEach(function (e) {
        const r = e.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return;
        if (e.children.length > 0) return;
        const t = (e.innerText || '').trim();
        if (!t || t.length > 8) return;
        if (r.top > 260) return;
        const k = t + '@' + Math.round(r.top);
        if (seen[k]) return;
        seen[k] = 1;
        res.push({ t: t, x: Math.round(r.left), y: Math.round(r.top) });
      });
      return res;
    });
    out.steps.push({ step: 'manage', shot: s1, url: ed.url(), tabs: tabs });

    const c2 = await clickText(ed, '合集', { exact: true });
    await sleep(ed, 5000);
    const s2 = shotPath('tt-collection');
    await ed.screenshot({ path: s2 });

    const d = await ed.evaluate(function () {
      return {
        url: location.href,
        text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 800),
      };
    });
    out.steps.push({ step: 'collection', clicked: c2, shot: s2, detail: d });

    console.log(JSON.stringify(out, null, 1));
  } catch (e) {
    let shot = null;
    try { shot = shotPath('tt-collection-error'); await ed.screenshot({ path: shot }); } catch (_) {}
    console.log(JSON.stringify({ error: String((e && e.message) || e), shot: shot, steps: out.steps }, null, 1));
  } finally {
    await ctx.close();
  }
})();
