// 打开知乎登录页，检测登录态。未登录时保持窗口打开等你扫码。
//   node pub_zh_login.js          等 10 分钟
//   node pub_zh_login.js 15       等 15 分钟
//
// 登录态判据：cookie 里有 z_c0（知乎的登录票据），比看页面元素稳。
const { launch, shotPath } = require('./pub_browser');

const WAIT_MIN = Number(process.argv[2] || 10);

async function hasLogin(ctx) {
  const cs = await ctx.cookies('https://www.zhihu.com');
  return cs.some((c) => c.name === 'z_c0' && c.value && c.value.length > 10);
}

(async () => {
  const { ctx, page, profile } = await launch({ headless: false, profile: 'zhihu' });
  await page.goto('https://www.zhihu.com/signin?next=%2F', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  let ok = await hasLogin(ctx);
  const shot1 = shotPath('zh-login');
  await page.screenshot({ path: shot1 });
  console.log(JSON.stringify({ step: 'open', url: page.url(), profile, loggedIn: ok, shot: shot1 }));

  if (!ok) {
    console.log(JSON.stringify({ step: 'need-scan', msg: '请在弹出的浏览器窗口扫码登录知乎，脚本会一直等' }));
    const deadline = Date.now() + WAIT_MIN * 60 * 1000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      try {
        if (await hasLogin(ctx)) { ok = true; break; }
      } catch (e) { /* 页面跳转时忽略 */ }
    }
    const shot2 = shotPath('zh-after-login');
    try { await page.screenshot({ path: shot2 }); } catch (e) {}
    console.log(JSON.stringify({ step: 'after-wait', url: page.url(), loggedIn: ok, shot: shot2 }));
  }

  if (ok) {
    // 顺手确认创作者中心能进
    await page.goto('https://www.zhihu.com/creator', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(3000);
    const shot3 = shotPath('zh-creator');
    await page.screenshot({ path: shot3 });
    console.log(JSON.stringify({ step: 'ready', url: page.url(), shot: shot3 }));
  } else {
    console.log(JSON.stringify({ step: 'timeout', msg: '没等到登录，重跑本脚本再扫一次' }));
  }

  await ctx.close();
})().catch((e) => {
  console.log(JSON.stringify({ step: 'error', error: String((e && e.message) || e) }));
  process.exit(1);
});
