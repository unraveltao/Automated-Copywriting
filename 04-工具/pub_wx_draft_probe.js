// 公众号「新建图文」页结构探测：只读，不填不提交
//   node pub_wx_draft_probe.js
// 输出：标题输入框、正文编辑器（含 iframe / contenteditable）、封面上传入口、保存草稿按钮、截图
//
// 为什么要单独探：公众号编辑器是老 UEditor + 新 ProseMirror 混着用，
// 正文可能在一个 iframe 里，也可能在 contenteditable 里，盲写脚本必然翻车。
const { launch, shotPath, sleep } = require('./pub_browser');

const log = (o) => console.log(JSON.stringify(o, null, 1));

(async () => {
  const { ctx, page } = await launch({ headless: false, profile: 'wx' });
  try {
    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await sleep(page, 3000);
    const token = (page.url().match(/token=(\d+)/) || [])[1];
    if (!token) {
      const shot = shotPath('wx-draft-no-login');
      await page.screenshot({ path: shot });
      log({ ok: false, error: '登录态失效，需要 node pub_wx_login.js 扫码', shot });
      return;
    }

    const url = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await sleep(page, 8000);

    const dump = async (target) => target.evaluate(() => {
      const vis = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const info = (e) => {
        const r = e.getBoundingClientRect();
        return {
          tag: e.tagName.toLowerCase(),
          id: e.id || '',
          cls: String(e.className || '').slice(0, 70),
          ph: e.getAttribute('placeholder') || '',
          text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        };
      };
      return {
        inputs: [...document.querySelectorAll('input,textarea')].filter(vis).map(info).slice(0, 25),
        editable: [...document.querySelectorAll('[contenteditable="true"]')].filter(vis).map(info).slice(0, 12),
        files: [...document.querySelectorAll('input[type="file"]')].map((e) => ({
          accept: e.accept || '', cls: String(e.className || '').slice(0, 40), hidden: !vis(e),
        })),
        buttons: [...document.querySelectorAll('button,a,[role="button"],[class*="btn"]')]
          .filter((e) => vis(e) && (e.innerText || '').trim())
          .map(info).slice(0, 40),
        bodyText: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 700),
      };
    });

    const main = await dump(page);
    const frames = [];
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      try {
        frames.push({ url: f.url().slice(0, 90), ...(await dump(f)) });
      } catch (e) { frames.push({ url: f.url().slice(0, 90), error: 'cross-origin' }); }
    }

    const shot = shotPath('wx-draft-probe');
    await page.screenshot({ path: shot });
    log({ ok: true, url: page.url().slice(0, 120), shot, main, frames });
  } catch (e) {
    let shot = null;
    try { shot = shotPath('wx-draft-probe-error'); await page.screenshot({ path: shot }); } catch (_) {}
    log({ ok: false, error: String((e && e.message) || e).split('\n')[0], shot });
    process.exitCode = 1;
  } finally {
    await ctx.close().catch(() => {});
  }
})();
