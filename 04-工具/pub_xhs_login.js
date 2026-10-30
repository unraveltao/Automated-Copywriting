// 小红书登录 + 登录成功后原地 dump 发布页结构（同一个进程，避免登录态丢失）
//   node pub_xhs_login.js          等 10 分钟
//   node pub_xhs_login.js 15       等 15 分钟
//
// 三个坑（都踩过了）：
//  1. 创作者中心登录页默认「短信登录」，二维码藏在卡片右上角切换图标后面；
//     主站 https://www.xiaohongshu.com/login 默认就是二维码，扫码走主站更省事。
//  2. web_session 这个 cookie 游客也有，光看它必然误判「已登录」。
//  3. 用 waitUntil:'commit' 判跳转也是假阳性——commit 只表示导航提交，
//     SPA 跳 /login 是之后 JS 干的。必须 domcontentloaded + 等几秒再看 URL。
//
// 真判据：创作者中心发布页停留后 URL 里没有 /login，且页面上有「上传图文 / 写长文」这类字样。
const { launch, shotPath } = require('./pub_browser');

const WAIT_MIN = Number(process.argv[2] || 10);
const PUBLISH = 'https://creator.xiaohongshu.com/publish/publish?source=official';
const { sleep } = require('./pub_browser');   // 统一走速度开关 PUB_SPEED

// 发布页是否真的进去了
async function tryPublish(pageB) {
  try {
    await pageB.goto(PUBLISH, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(pageB, 5000);
    const u = pageB.url();
    const text = await pageB.evaluate(() => (document.body.innerText || '').slice(0, 500)).catch(() => '');
    const hasEditor = /上传图文|写长文|发布笔记|拖拽|上传视频/.test(text);
    return { ok: !/\/login/.test(u) && hasEditor, url: u, hasEditor, text: text.replace(/\n{2,}/g, '\n').slice(0, 200) };
  } catch (e) {
    return { ok: false, url: 'goto-error: ' + String((e && e.message) || e).split('\n')[0] };
  }
}

// 把发布页能点的东西列出来
async function dump(pageB) {
  return pageB.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const pick = (e) => ({
      tag: e.tagName.toLowerCase(),
      type: e.type || '',
      ph: e.getAttribute('placeholder') || '',
      cls: (e.className && String(e.className).slice(0, 80)) || '',
      text: (e.innerText || e.value || '').trim().slice(0, 30),
    });
    return {
      url: location.href,
      bodyText: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 3000),
      tabs: [...document.querySelectorAll('[class*="tab"],[role="tab"]')].filter(vis).map(pick).slice(0, 20),
      buttons: [...document.querySelectorAll('button')].filter(vis).map(pick).slice(0, 50),
      inputs: [...document.querySelectorAll('input')].map(pick).slice(0, 30),
      editables: [...document.querySelectorAll('[contenteditable="true"],textarea')].filter(vis).map(pick).slice(0, 15),
      files: [...document.querySelectorAll('input[type=file]')].map((e) => ({ accept: e.getAttribute('accept') || '', cls: String(e.className || '').slice(0, 60) })),
      aiTexts: [...document.querySelectorAll('*')].filter((e) => vis(e) && /AI\s*排版|一键排版|智能排版|AI排版/.test(e.innerText || '') && (e.innerText || '').length < 20).map(pick).slice(0, 15),
    };
  });
}

(async () => {
  const { ctx, page, profile } = await launch({ headless: false, profile: 'xhs' });
  const pageB = await ctx.newPage();

  // 可能早就登录过
  let st = await tryPublish(pageB);
  console.log(JSON.stringify({ step: 'probe', ...st, profile }));

  if (!st.ok) {
    await page.goto('https://www.xiaohongshu.com/login', { waitUntil: 'domcontentloaded' });
    await sleep(page, 4000);
    const shot1 = shotPath('xhs-qr');
    await page.screenshot({ path: shot1 });
    console.log(JSON.stringify({ step: 'need-scan', msg: '请用小红书 App 扫窗口里的二维码', shot: shot1 }));

    const deadline = Date.now() + WAIT_MIN * 60 * 1000;
    while (!st.ok && Date.now() < deadline) {
      await sleep(pageB, 12000);
      st = await tryPublish(pageB);
      console.log(JSON.stringify({ step: 'poll', t: new Date().toTimeString().slice(0, 8), ...st }));
    }
  }

  if (!st.ok) {
    console.log(JSON.stringify({ step: 'timeout', url: st.url }));
    await ctx.close();
    process.exitCode = 2;
    return;
  }

  // 登录确认后，重新进一次发布页再 dump（第二次才是干净状态）
  await sleep(pageB, 2000);
  st = await tryPublish(pageB);
  const info = await dump(pageB);
  const shot = shotPath('xhs-publish-page');
  await pageB.screenshot({ path: shot });
  console.log(JSON.stringify({ step: 'ready', shot, info }, null, 2));

  await ctx.close();
})().catch((e) => {
  console.log(JSON.stringify({ step: 'error', error: String((e && e.message) || e).split('\n')[0] }));
  process.exit(1);
});
