// 检查头条登录/注册状态：只导航 + 报告地址，不点任何东西
//   node pub_tt_state.js
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const ed = page;
  try {
    await ed.goto('https://mp.toutiao.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function (e) {
      console.log(JSON.stringify({ step: 'goto-warn', error: String((e && e.message) || e).slice(0, 120) }));
    });
    await sleep(ed, 6000);

    const cs = await ctx.cookies('https://mp.toutiao.com');
    const hasSession = cs.some(function (c) { return c.name === 'sessionid' && c.value && c.value.length > 10; });

    const info = await ed.evaluate(function () {
      return {
        url: location.href,
        title: document.title,
        text: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 400),
      };
    });
    const s = shotPath('tt-state');
    await ed.screenshot({ path: s });
    console.log(JSON.stringify({ step: 'state', hasSession: hasSession, ...info, shot: s }, null, 1));
  } finally {
    await ctx.close();
  }
})().catch(function (e) {
  console.log(JSON.stringify({ step: 'error', error: String((e && e.message) || e) }));
});
