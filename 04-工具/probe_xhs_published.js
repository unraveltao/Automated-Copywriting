// 只读：列出小红书「长文」已发布的作品标题，用来校准台账
//   node probe_xhs_published.js
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const PUBLISH = 'https://creator.xiaohongshu.com/publish/publish?source=official';

async function tap(page, text) {
  const pt = await page.evaluate(function (t) {
    const c = [];
    document.querySelectorAll('button, a, div, span, li').forEach(function (e) {
      if ((e.innerText || '').trim() !== t) return;
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (r.width < 10 || r.height < 10) return;
      if (s.display === 'none' || s.visibility === 'hidden') return;
      c.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width });
    });
    if (!c.length) return null;
    c.sort(function (a, b) { return a.w - b.w; });
    return c[0];
  }, text);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
}

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'xhs' });
  const out = { steps: [] };
  try {
    await page.goto(PUBLISH, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(page, 7000);
    if (/\/login/.test(page.url())) throw new Error('小红书登录态失效');

    await tap(page, '写长文');
    await sleep(page, 6000);

    const grab = async function () {
      return page.evaluate(function () {
        const t = (document.body.innerText || '').replace(/\n{2,}/g, '\n');
        const titles = (t.match(/第\s*\d+\s*关[^\n]{0,40}/g) || []);
        return {
          url: location.href,
          titles: Array.from(new Set(titles.map(function (s) { return s.trim(); }))),
          hasCreate: /新的创作/.test(t),
          body: t.slice(0, 700),
        };
      });
    };

    out.steps.push({ step: 'longform-list', data: await grab() });
    const s = shotPath('xhs-published');
    await page.screenshot({ path: s });
    out.steps.push({ step: 'shot', shot: s });

    console.log(JSON.stringify(out, null, 1));
  } catch (e) {
    out.error = String((e && e.message) || e);
    try { out.shot = shotPath('xhs-published-err'); await page.screenshot({ path: out.shot }); } catch (_) {}
    console.log(JSON.stringify(out, null, 1));
  } finally {
    await ctx.close();
  }
})();
