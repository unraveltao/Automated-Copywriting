// 探路：打开图文编辑器，把关键元素结构 dump 出来
const { launch, shotPath } = require('./pub_browser');

(async () => {
  const { ctx, page } = await launch({ headless: false });
  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const url = page.url();
  const token = (url.match(/token=(\d+)/) || [])[1];
  console.log(JSON.stringify({ step: 'home', token, url }));

  // 新版编辑器入口
  const editUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`;
  await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const shot = shotPath('wx-editor-probe');
  await page.screenshot({ path: shot });
  console.log(JSON.stringify({ step: 'editor', url: page.url(), title: await page.title(), shot }));

  const info = await page.evaluate(() => {
    const pick = (el) => {
      if (!el) return null;
      const attrs = {};
      for (const a of el.attributes || []) attrs[a.name] = a.value;
      return { tag: el.tagName, id: el.id, cls: el.className, attrs, text: (el.innerText || '').slice(0, 60) };
    };
    const q = (s) => pick(document.querySelector(s));
    const frames = Array.from(document.querySelectorAll('iframe')).map((f) => ({
      id: f.id, cls: f.className, src: (f.src || '').slice(0, 120),
    }));
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]')).map(pick);
    return {
      title: q('.js_title input, #title, input.js_title, textarea.js_title'),
      author: q('#author, input.js_author, .js_author input'),
      frames,
      editables,
      buttons: Array.from(document.querySelectorAll('button, a.btn, .weui-desktop-btn')).slice(0, 40)
        .map((b) => (b.innerText || '').trim()).filter(Boolean),
      placeholders: Array.from(document.querySelectorAll('[placeholder]')).map((e) => ({
        ph: e.getAttribute('placeholder'), tag: e.tagName, id: e.id, cls: e.className,
      })),
    };
  });
  console.log(JSON.stringify({ step: 'dom', info }, null, 1));

  await ctx.close();
})().catch((e) => { console.log(JSON.stringify({ step: 'error', error: String(e && e.message || e) })); process.exit(1); });
