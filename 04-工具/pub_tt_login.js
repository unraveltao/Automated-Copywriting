// 打开今日头条创作者后台，检测登录态。未登录时保持窗口等你扫码。
//   node pub_tt_login.js        等 10 分钟
//   node pub_tt_login.js 15     等 15 分钟
//
// 登录态判据：.toutiao.com 上有 sessionid cookie
const { launch, shotPath } = require('./pub_browser');

const WAIT_MIN = Number(process.argv[2] || 10);

async function hasLogin(ctx) {
  const cs = await ctx.cookies('https://mp.toutiao.com');
  return cs.some(function (c) { return c.name === 'sessionid' && c.value && c.value.length > 10; });
}

(async function () {
  const { ctx, page, profile } = await launch({ headless: false, profile: 'toutiao' });
  try {
    await page.goto('https://mp.toutiao.com/auth/page/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    let ok = await hasLogin(ctx);
    const shot1 = shotPath('tt-login');
    await page.screenshot({ path: shot1 });
    console.log(JSON.stringify({ step: 'open', url: page.url(), profile: profile, loggedIn: ok, shot: shot1 }));

    if (!ok) {
      console.log(JSON.stringify({ step: 'need-scan', msg: '请在弹出的浏览器窗口扫码登录今日头条，脚本会一直等' }));
      const deadline = Date.now() + WAIT_MIN * 60 * 1000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(3000);
        try {
          if (await hasLogin(ctx)) { ok = true; break; }
        } catch (e) { /* 跳转时忽略 */ }
      }
      const shot2 = shotPath('tt-after-login');
      try { await page.screenshot({ path: shot2 }); } catch (e) {}
      console.log(JSON.stringify({ step: 'after-wait', url: page.url(), loggedIn: ok, shot: shot2 }));
    }

    if (ok) {
      await page.goto('https://mp.toutiao.com/profile_v4/index', { waitUntil: 'domcontentloaded' }).catch(function () {});
      await page.waitForTimeout(4000);
      const shot3 = shotPath('tt-home');
      await page.screenshot({ path: shot3 });
      console.log(JSON.stringify({ step: 'ready', url: page.url(), shot: shot3 }));
    } else {
      console.log(JSON.stringify({ step: 'timeout', msg: '没等到登录，重跑本脚本再扫一次' }));
    }
  } finally {
    await ctx.close();
  }
})().catch(function (e) {
  console.log(JSON.stringify({ step: 'error', error: String((e && e.message) || e) }));
  process.exit(1);
});
