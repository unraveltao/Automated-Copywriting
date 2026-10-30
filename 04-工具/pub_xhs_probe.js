// 小红书页面结构探测：不填不提交，只把 DOM 里能点的东西列出来
//   node pub_xhs_probe.js                    探测发布页（默认 tab）
//   node pub_xhs_probe.js 写长文              切到「写长文」再探
//   node pub_xhs_probe.js 写长文 "" 新的创作   切 tab 后再点某个按钮（会跟进新开的标签页）
// 会自动处理登录（未登录时开二维码等人扫）
const { launch, shotPath } = require('./pub_browser');
const { ensureLogin, PUBLISH, sleep } = require('./pub_xhs_ensure');

const log = (o) => console.log(JSON.stringify(o, null, 2));
const TAB = process.argv[2] || '';
const URL_ = process.argv[3] || PUBLISH;
const CLICK = process.argv[4] || '';

async function dump(page, tag) {
  const info = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const pick = (e) => ({
      tag: e.tagName.toLowerCase(),
      type: e.type || '',
      ph: e.getAttribute('placeholder') || '',
      cls: (e.className && String(e.className).slice(0, 70)) || '',
      text: (e.innerText || e.value || '').trim().slice(0, 26),
    });
    const near = (re) => [...document.querySelectorAll('*')].filter((e) => vis(e) && re.test(e.innerText || '') && (e.innerText || '').length < 30).map(pick).slice(0, 20);
    return {
      url: location.href,
      bodyText: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 4000),
      buttons: [...document.querySelectorAll('button,[role="button"]')].filter(vis).map(pick).slice(0, 60),
      inputs: [...document.querySelectorAll('input')].filter(vis).map(pick).slice(0, 30),
      editables: [...document.querySelectorAll('[contenteditable="true"],textarea')].filter(vis).map(pick).slice(0, 15),
      files: [...document.querySelectorAll('input[type=file]')].map((e) => ({ accept: e.getAttribute('accept') || '', cls: String(e.className || '').slice(0, 50) })),
      ai: near(/排版|模板|AI/),
      collection: near(/合集|收录/),
      timer: near(/定时|发布设置|立即发布/),
    };
  });
  const shot = shotPath(tag);
  await page.screenshot({ path: shot });
  return { shot, info };
}

(async () => {
  const { ctx, page } = await launch({ headless: false, profile: 'xhs' });
  try {
    const st = await ensureLogin(ctx, page, {
      waitMin: 8,
      onNeedScan: async () => {
        const s = shotPath('xhs-qr');
        await page.screenshot({ path: s }).catch(() => {});
        console.log(JSON.stringify({ step: 'need-scan', msg: '请扫窗口里的二维码', shot: s }));
      },
    });
    console.log(JSON.stringify({ step: 'login', ...st }));
    if (!st.ok) { await ctx.close(); process.exitCode = 2; return; }

    if (URL_ && URL_ !== PUBLISH) await page.goto(URL_, { waitUntil: 'domcontentloaded' });
    await sleep(page, 6000);

    if (TAB) {
      const clicked = await page.evaluate((t) => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const el = [...document.querySelectorAll('*')].filter((e) => vis(e) && (e.innerText || '').trim() === t)
          .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
        if (!el) return false;
        el.click();
        return true;
      }, TAB);
      await sleep(page, 7000);
      console.log(JSON.stringify({ step: 'tab-click', tab: TAB, clicked }));
    }

    let cur = page;

    if (CLICK) {
      // 「新的创作」可能开新标签页，也可能就地跳转，两条路都接
      const popupP = ctx.waitForEvent('page', { timeout: 12000 }).catch(() => null);
      const clicked = await page.evaluate((t) => {
        const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        const el = [...document.querySelectorAll('button,[role="button"],a,div')]
          .filter((e) => vis(e) && (e.innerText || '').trim() === t)
          .sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0];
        if (!el) return false;
        el.click();
        return true;
      }, CLICK);
      const popup = await popupP;
      if (popup) cur = popup;
      await sleep(cur, 9000);
      console.log(JSON.stringify({ step: 'click', text: CLICK, clicked, popup: !!popup, url: cur.url() }));
    }

    const r = await dump(cur, 'xhs-probe');
    log({ ok: true, ...r });
  } catch (e) {
    let shot = null;
    try { shot = shotPath('xhs-probe-error'); await page.screenshot({ path: shot }); } catch (_) {}
    log({ ok: false, error: String((e && e.message) || e).split('\n')[0], shot });
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
