// 小红书登录保障（公共模块）：任何要操作创作者中心的脚本，第一步都调它
//
// 为什么单独抽出来：小红书的登录态**关掉浏览器就失效**（web_session 虽然标着持久，
// 服务端下次启动直接 401），所以「登录」和「发布」必须在同一个进程里跑完。
//
// 判据（三处坑都踩过，别再简化）：
//  - web_session cookie 游客也有 → 不能用它判登录
//  - waitUntil:'commit' 只表示导航提交，SPA 跳 /login 在之后 → 不能用它判跳转
//  - 真判据：发布页 domcontentloaded + 等 5 秒后，URL 里没有 /login，且页面上有编辑器字样
const PUBLISH = 'https://creator.xiaohongshu.com/publish/publish?source=official';
const LOGIN_PAGE = 'https://www.xiaohongshu.com/login';

const { sleep } = require('./pub_browser');   // 统一走速度开关 PUB_SPEED

async function tryPublish(page) {
  try {
    await page.goto(PUBLISH, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(page, 5000);
    const u = page.url();
    const text = await page.evaluate(() => (document.body.innerText || '').slice(0, 800)).catch(() => '');
    const hasEditor = /上传图文|写长文|发布笔记|上传视频/.test(text);
    return { ok: !/\/login/.test(u) && hasEditor, url: u, hasEditor };
  } catch (e) {
    return { ok: false, url: 'goto-error: ' + String((e && e.message) || e).split('\n')[0] };
  }
}

/**
 * 确保已登录，未登录就开二维码等人扫。
 * @param {object} ctx  browser context
 * @param {object} page 用于展示二维码的页面
 * @param {object} opts { waitMin, onNeedScan(shot) }
 * @returns {{ok:boolean, url:string}}
 */
async function ensureLogin(ctx, page, opts = {}) {
  const waitMin = opts.waitMin ?? 10;
  const onNeedScan = opts.onNeedScan || (() => {});

  let st = await tryPublish(page);
  if (st.ok) return st;

  // 开二维码（主站登录页默认就是二维码；创作者中心那个默认是短信）
  const qrPage = page;
  await qrPage.goto(LOGIN_PAGE, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(qrPage, 4000);
  await onNeedScan();

  const pollPage = await ctx.newPage();
  const deadline = Date.now() + waitMin * 60 * 1000;
  while (!st.ok && Date.now() < deadline) {
    await sleep(pollPage, 12000);
    st = await tryPublish(pollPage);
    console.log(JSON.stringify({ step: 'poll', t: new Date().toTimeString().slice(0, 8), ok: st.ok, url: st.url }));
  }
  if (pollPage !== page) await pollPage.close().catch(() => {});
  return st;
}

module.exports = { ensureLogin, tryPublish, PUBLISH, LOGIN_PAGE, sleep };
