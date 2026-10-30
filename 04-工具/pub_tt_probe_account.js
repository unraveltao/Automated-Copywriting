// 探头条：发布权益是否可用 / 「完善账号信息」到底要什么
//   node pub_tt_probe_account.js
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const out = {};
  try {
    // 1) 直接进发布页，看会不会被拦
    await page.goto('https://mp.toutiao.com/profile_v4/graphic/publish', {
      waitUntil: 'domcontentloaded', timeout: 60000,
    }).catch(function (e) { out.gotoErr = String(e.message).slice(0, 120); });
    await sleep(page, 6000);

    out.publishUrl = page.url();
    out.publishShot = shotPath('tt-account-publish');
    await page.screenshot({ path: out.publishShot });

    out.publishText = await page.evaluate(function () {
      return (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 600);
    });

    // 2) 回到首页，点「立即完善」，看弹的是表单还是实名
    await page.goto('https://mp.toutiao.com/profile_v4/index', { waitUntil: 'domcontentloaded' }).catch(function () {});
    await sleep(page, 4000);

    const clicked = await page.evaluate(function () {
      const all = Array.prototype.slice.call(document.querySelectorAll('*'));
      const hit = all.filter(function (e) {
        const r = e.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return false;
        return (e.innerText || '').trim() === '立即完善';
      });
      if (!hit.length) return null;
      const r = hit[0].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    out.foundBtn = !!clicked;
    if (clicked) {
      await page.mouse.click(clicked.x, clicked.y);
      await sleep(page, 5000);
      out.afterUrl = page.url();
      out.afterShot = shotPath('tt-account-complete');
      await page.screenshot({ path: out.afterShot });
      out.afterText = await page.evaluate(function () {
        return (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 800);
      });
      out.fields = await page.evaluate(function () {
        const vis = function (e) {
          const r = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
        };
        return Array.prototype.slice.call(document.querySelectorAll('input,textarea,select'))
          .filter(vis)
          .map(function (e) {
            return { tag: e.tagName, type: e.type || '', ph: e.placeholder || '', name: e.name || '' };
          }).slice(0, 25);
      });
    }
    console.log(JSON.stringify(out, null, 1));
  } finally {
    await ctx.close();
  }
})().catch(function (e) {
  console.log(JSON.stringify({ step: 'error', error: String((e && e.message) || e) }));
});
