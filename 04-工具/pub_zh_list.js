// 列出知乎账号已发布的文章（爬创作中心「文章」标签页）
//   node pub_zh_list.js
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

async function clickText(ed, text) {
  const pt = await ed.evaluate((t) => {
    const els = [...document.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (e.innerText || '').trim() === t && e.children.length === 0;
    });
    if (!els.length) return null;
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, text);
  if (!pt) return false;
  await ed.mouse.click(pt.x, pt.y);
  return true;
}

(async () => {
  const { ctx, page } = await launch({ headless: false, profile: 'zhihu' });
  const ed = page;
  try {
    await ed.goto('https://www.zhihu.com/creator/manage/creation/all', { waitUntil: 'domcontentloaded' });
    await sleep(ed, 7000);

    const clicked = await clickText(ed, '文章');
    await sleep(ed, 5000);

    // 往下滚，加载更多
    for (let i = 0; i < 4; i++) {
      await ed.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(ed, 2000);
    }
    await ed.evaluate(() => window.scrollTo(0, 0));
    await sleep(ed, 1500);

    const shot = shotPath('zh-article-list');
    await ed.screenshot({ path: shot });

    const titles = await ed.evaluate(() => {
      const out = [];
      const walk = (root) => {
        for (const e of root.querySelectorAll('*')) {
          if (e.children.length) continue;
          const t = (e.innerText || '').trim();
          if (/^第\d+关/.test(t) && t.length > 5) out.push(t);
        }
      };
      walk(document.body);
      return [...new Set(out)];
    });

    const bodyText = await ed.evaluate(() => (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 2500));

    console.log(JSON.stringify({ clicked, shot, count: titles.length, titles, bodyText }, null, 1));
  } catch (e) {
    console.log(JSON.stringify({ error: String((e && e.message) || e) }));
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
