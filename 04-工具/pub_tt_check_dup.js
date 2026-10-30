// 重复检测：这个关号是不是已经发过了
//   node pub_tt_check_dup.js 4
// 输出 {"dup":true,"matches":[...]} —— dup 为 true 就不要发
//
// 为什么需要：台账是本地记录，可能和线上不一致（文章被删、被下架、手动发过）。
// 发布前用线上列表做一次事实核查，比信任台账可靠。
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const ARTICLES = 'https://mp.toutiao.com/profile_v4/graphic/articles';
const num = Number(process.argv[2]);

function parse() {
  const vis = function (e) {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const titles = Array.prototype.slice.call(document.querySelectorAll('*'))
    .filter(function (e) {
      if (!vis(e) || e.children.length > 0) return false;
      return /^第\d+关[｜|]/.test((e.innerText || '').trim());
    })
    .map(function (e) { return (e.innerText || '').trim(); });
  const body = document.body.innerText || '';
  const m = body.match(/共\s*(\d+)\s*条内容/);
  return {
    titles: Array.from(new Set(titles)),
    total: m ? Number(m[1]) : null,
    hasNext: /下一页/.test(body),
    url: location.href,
  };
}

(async function () {
  if (!num) {
    console.log(JSON.stringify({ error: '用法：node pub_tt_check_dup.js <关号>' }));
    process.exitCode = 2;
    return;
  }
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const out = { num: num, pages: [], all: [], dup: false, matches: [] };
  try {
    await page.goto(ARTICLES, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(page, 7000);

    // 翻页收集：最多 10 页，够覆盖 100 篇（每页 10–20 条）
    for (let i = 0; i < 10; i++) {
      const r = await page.evaluate(parse);
      out.pages.push({ page: i + 1, count: r.titles.length, total: r.total });
      r.titles.forEach(function (t) { if (out.all.indexOf(t) < 0) out.all.push(t); });

      // 找到目标就提前收工
      if (out.all.some(function (t) { return new RegExp('^第' + num + '关[｜|]').test(t); })) break;
      if (!r.hasNext) break;

      const next = page.locator('text=下一页').last();
      if (!(await next.count())) break;
      await next.click({ timeout: 5000 }).catch(function () {});
      await sleep(page, 3500);
    }

    const re = new RegExp('^第' + num + '关[｜|]');
    out.matches = out.all.filter(function (t) { return re.test(t); });
    out.dup = out.matches.length > 0;
    out.total_on_site = out.all.length;
    out.shot = shotPath('tt-dup-' + num);
    await page.screenshot({ path: out.shot });
  } catch (e) {
    out.error = String((e && e.message) || e);
    process.exitCode = 2;
  } finally {
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 1));
  if (out.dup) process.exitCode = 1;
})();
