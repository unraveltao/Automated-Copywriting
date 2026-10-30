// 探路：左侧封面区域结构
const { launch, shotPath } = require('./pub_browser');

(async () => {
  const { ctx, page } = await launch({ headless: false });
  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const token = (page.url().match(/token=(\d+)/) || [])[1];
  await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const info = await page.evaluate(() => {
    // 找 x < 320 且 y 在 80..340 之间的元素
    const cands = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 100 && r.height > 60 && r.left < 320 && r.top > 80 && r.top < 400) {
        cands.push({
          tag: el.tagName,
          id: el.id,
          cls: typeof el.className === 'string' ? el.className : '',
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          txt: (el.innerText || '').slice(0, 40),
        });
      }
    });
    return cands.slice(0, 30);
  });
  console.log(JSON.stringify({ step: 'cover-cands', info }, null, 1));

  const shot = shotPath('wx-cover-probe');
  await page.screenshot({ path: shot });
  console.log(JSON.stringify({ shot }));
  await ctx.close();
})().catch((e) => { console.log(JSON.stringify({ error: String(e.message || e) })); process.exit(1); });
