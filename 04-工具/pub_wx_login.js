// 打开公众号后台，检测登录态。未登录时保持窗口打开等你扫码。
const { launch, shotPath } = require('./pub_browser');

const WAIT_MIN = Number(process.argv[2] || 10);

function loggedIn(url) {
  return /\/cgi-bin\/home/.test(url) || /token=\d+/.test(url);
}

(async () => {
  const { ctx, page } = await launch({ headless: false });
  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  let ok = loggedIn(page.url());
  const shot1 = shotPath('wx-login');
  await page.screenshot({ path: shot1 });

  console.log(JSON.stringify({ step: 'open', url: page.url(), loggedIn: ok, shot: shot1 }));

  if (!ok) {
    const deadline = Date.now() + WAIT_MIN * 60 * 1000;
    let last = '';
    while (Date.now() < deadline) {
      await page.waitForTimeout(3000);
      if (loggedIn(page.url())) { ok = true; break; }
      // 页面可能跳转，避免 frame detached
      try {
        const u = page.url();
        if (u !== last) { last = u; console.log(JSON.stringify({ step: 'poll', url: u })); }
      } catch (e) { /* ignore */ }
    }
    const shot2 = shotPath('wx-after-login');
    try { await page.screenshot({ path: shot2 }); } catch (e) {}
    console.log(JSON.stringify({ step: 'after-wait', url: page.url(), loggedIn: ok, shot: shot2 }));
  }

  if (ok) {
    console.log(JSON.stringify({ step: 'ready', url: page.url() }));
  } else {
    console.log(JSON.stringify({ step: 'need-scan', msg: '未检测到登录，请扫码后重跑' }));
  }

  // 保持浏览器存活，交给你扫码；脚本本身退出但 profile 已落盘
  await ctx.close();
})().catch((e) => {
  console.log(JSON.stringify({ step: 'error', error: String(e && e.message || e) }));
  process.exit(1);
});
