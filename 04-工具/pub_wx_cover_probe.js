// 公众号封面选择弹窗探测：点「拖拽或选择封面」，把弹出的对话框结构 dump 出来
//   node pub_wx_cover_probe.js
const { launch, shotPath, sleep } = require('./pub_browser');
const log = (o) => console.log(JSON.stringify(o, null, 1));

(async () => {
  const { ctx, page } = await launch({ headless: false, profile: 'wx' });
  try {
    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await sleep(page, 2500);
    const token = (page.url().match(/token=(\d+)/) || [])[1];
    if (!token) throw new Error('登录态失效');

    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.select-cover__btn', { timeout: 30000 });
    await sleep(page, 3000);

    await page.locator('.select-cover__btn').first().click();
    await sleep(page, 3500);

    const dump = await page.evaluate(() => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const info = (e) => {
        const r = e.getBoundingClientRect();
        return {
          tag: e.tagName.toLowerCase(),
          cls: String(e.className || '').slice(0, 60),
          text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        };
      };
      // 找可见的弹层（dialog / modal / 遮罩层里的内容）
      const dialogs = [...document.querySelectorAll('.weui-desktop-dialog,[class*="dialog"],[class*="modal"],[class*="picker"]')]
        .filter(vis).map(info).slice(0, 12);
      const clickable = [...document.querySelectorAll('button,a,[role="button"],[class*="btn"],span,li')]
        .filter((e) => vis(e) && (e.innerText || '').trim().length <= 12 && (e.innerText || '').trim())
        .map(info).slice(0, 45);
      return {
        dialogs,
        clickable,
        files: [...document.querySelectorAll('input[type="file"]')].map((e) => ({
          accept: e.accept || '', cls: String(e.className || '').slice(0, 40),
        })),
        bodyTail: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(-500),
      };
    });

    const shot = shotPath('wx-cover-probe');
    await page.screenshot({ path: shot });
    log({ ok: true, shot, ...dump });
  } catch (e) {
    let shot = null;
    try { shot = shotPath('wx-cover-probe-error'); await page.screenshot({ path: shot }); } catch (_) {}
    log({ ok: false, error: String((e && e.message) || e).split('\n')[0], shot });
    process.exitCode = 1;
  } finally {
    await ctx.close().catch(() => {});
  }
})();
