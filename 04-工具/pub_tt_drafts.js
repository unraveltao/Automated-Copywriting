// 头条草稿箱：列 / 删
//   node pub_tt_drafts.js           只列
//   node pub_tt_drafts.js --go      删草稿（**带硬闸门**，确认在草稿箱才删）
//
// 2026-10-30 事故：旧版先跳 /graphic/articles（文章列表），再点「草稿箱」标签。
// 那个点击一旦失败，页面停在文章列表上，脚本照样找「删除」并删掉——已发布的文章被删了。
// 旧注释还写着"发过的不受影响"，这个假设是错的：它只假设了点击会成功。
//
// 现在的闸门（任一不满足就拒绝删除，只列不删）：
//   1. 页面必须没有「展现 / 阅读」这类数据列——草稿箱没有数据，文章列表有
//   2. 必须能看到草稿箱的计数（共 N 条）
//   3. 每个待删项所在行不能含「已发布 / 审核中 / 审核未通过」
// 三道都不满足宁可不动手：草稿留着不碍事，删错文章补不回来。
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const ARTICLES = 'https://mp.toutiao.com/profile_v4/graphic/articles';
const GO = process.argv.includes('--go');

// 用坐标点最内层元素：标签是 div>span 嵌套，getByText 会点到不可点的外层
async function tap(page, text) {
  const pt = await page.evaluate(function (t) {
    const c = [];
    document.querySelectorAll('button, a, div, span, li').forEach(function (e) {
      if ((e.innerText || '').trim() !== t) return;
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      if (r.width < 10 || r.height < 10) return;
      if (s.display === 'none' || s.visibility === 'hidden') return;
      c.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width });
    });
    if (!c.length) return null;
    c.sort(function (a, b) { return a.w - b.w; });
    return c[0];
  }, text);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
}

async function openDrafts(page) {
  await page.goto(ARTICLES, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(page, 5000);
  for (let i = 0; i < 3; i++) {
    await tap(page, '草稿箱');
    await sleep(page, 4000);
    if (await isDraftsPage(page)) return true;
  }
  return false;
}

// 判别是不是真的在草稿箱：文章列表有「展现/阅读」，草稿箱没有
async function isDraftsPage(page) {
  return page.evaluate(function () {
    const t = document.body.innerText || '';
    const hasStats = /展现\s*\d+/.test(t) || /阅读\s*\d+/.test(t);
    const hasDraftMark = /共\s*\d+\s*条/.test(t);
    return !hasStats && hasDraftMark;
  });
}

async function list(page) {
  return page.evaluate(function () {
    const vis = function (e) {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const rows = [];
    // 每个「删除」按钮往上找它所在的行，把行文本一起带回来，用来判断状态
    Array.prototype.slice.call(document.querySelectorAll('*')).forEach(function (e) {
      if (!vis(e) || e.children.length > 0) return;
      const t = (e.innerText || '').trim();
      if (t !== '删除' && t !== '删除草稿') return;
      const r = e.getBoundingClientRect();
      let row = e, rowText = '';
      for (let i = 0; i < 6 && row; i++) {
        row = row.parentElement;
        if (row && (row.innerText || '').length > 20) { rowText = row.innerText; break; }
      }
      rows.push({
        t: t, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
        top: Math.round(r.top), rowText: (rowText || '').replace(/\n+/g, ' ').slice(0, 80),
      });
    });
    rows.sort(function (a, b) { return a.top - b.top; });

    const titles = Array.prototype.slice.call(document.querySelectorAll('*'))
      .filter(function (e) {
        if (!vis(e) || e.children.length > 0) return false;
        return /^第\d+关｜/.test((e.innerText || '').trim());
      })
      .map(function (e) {
        return { t: (e.innerText || '').trim().slice(0, 30), top: Math.round(e.getBoundingClientRect().top) };
      })
      .sort(function (a, b) { return a.top - b.top; });

    return { url: location.href, del: rows, titles: titles };
  });
}

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const out = { steps: [] };
  try {
    const onDrafts = await openDrafts(page);
    out.steps.push({ step: 'open-drafts', onDrafts: onDrafts, url: page.url() });

    let r = await list(page);
    out.steps.push({ step: 'list', count: r.del.length, titles: r.titles });

    if (GO) {
      // 闸门一：必须在草稿箱
      if (!onDrafts || !(await isDraftsPage(page))) {
        out.steps.push({ step: 'abort', reason: '没能确认在草稿箱页面，拒绝删除（宁可留着草稿，也不误删文章）' });
        console.log(JSON.stringify(out, null, 1));
        return;
      }

      for (let guard = 0; guard < 20; guard++) {
        r = await list(page);
        if (!r.del.length) break;

        // 闸门二：逐项校验，行里出现已发布状态就整轮停
        const bad = r.del.find(function (d) {
          return /已发布|审核中|审核未通过/.test(d.rowText || '');
        });
        if (bad) {
          out.steps.push({ step: 'abort', reason: '待删项里出现已发布状态，拒绝删除', row: bad.rowText });
          break;
        }

        const d = r.del[0];
        await page.mouse.click(d.x, d.y);
        await sleep(page, 2000);

        const pt = await page.evaluate(function () {
          const c = [];
          document.querySelectorAll('button, span, div').forEach(function (e) {
            if (e.children.length > 0) return;
            const t = (e.innerText || '').trim();
            if (t !== '确定' && t !== '确认') return;
            const r = e.getBoundingClientRect();
            if (r.width < 5) return;
            c.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
          });
          return c.length ? c[c.length - 1] : null;
        });
        if (pt) await page.mouse.click(pt.x, pt.y);
        await sleep(page, 3000);
        out.steps.push({ step: 'deleted', round: guard + 1, row: d.rowText });

        if (!(await openDrafts(page))) {
          out.steps.push({ step: 'abort', reason: '删完回不到草稿箱，停手' });
          break;
        }
        await sleep(page, 1500);
      }
    }

    r = await list(page);
    const s = shotPath('tt-drafts-final');
    await page.screenshot({ path: s });
    out.steps.push({ step: 'final', left: r.del.length, titles: r.titles, shot: s });
    console.log(JSON.stringify(out, null, 1));
  } finally {
    await ctx.close();
  }
})().catch(function (e) {
  console.log(JSON.stringify({ error: String((e && e.message) || e) }));
});
