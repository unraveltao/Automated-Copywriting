// 打开头条绑定/注册页，等你把手机绑定和注册流程走完，检测到进创作者后台就退出
//   node pub_tt_reg.js 20     最多等 20 分钟
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const WAIT_MIN = Number(process.argv[2] || 20);

function inCreator(url) {
  return /mp\.toutiao\.com\/profile_v4/.test(url) && !/sso\.toutiao\.com/.test(url);
}

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  try {
    await page.goto('https://mp.toutiao.com/profile_v4/index', { waitUntil: 'domcontentloaded' });
    await sleep(page, 5000);

    console.log(JSON.stringify({ step: 'open', url: page.url() }));

    const deadline = Date.now() + WAIT_MIN * 60 * 1000;
    let last = page.url();
    let done = inCreator(last);

    while (!done && Date.now() < deadline) {
      await sleep(page, 4000);
      let u = '';
      try { u = page.url(); } catch (e) { continue; }
      if (u !== last) {
        last = u;
        const s = shotPath('tt-reg-step');
        try { await page.screenshot({ path: s }); } catch (e) {}
        console.log(JSON.stringify({ step: 'url-change', url: u, shot: s }));
      }
      done = inCreator(u);
    }

    const s2 = shotPath('tt-reg-final');
    try { await page.screenshot({ path: s2 }); } catch (e) {}
    console.log(JSON.stringify({ step: done ? 'ready' : 'timeout', url: page.url(), shot: s2 }));
  } finally {
    await ctx.close();
  }
})().catch(function (e) {
  console.log(JSON.stringify({ step: 'error', error: String((e && e.message) || e) }));
  process.exit(1);
});
