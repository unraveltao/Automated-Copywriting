// 把已发布的知乎文章收录进专栏「逻辑闯关」
//
//   node pub_zh_column.js 8            收录第8关
//   node pub_zh_column.js 8 --dry      只看状态，不点
//
// 入口：专栏页 → 「收录内容」→ 抽屉里找到该文章 → 点「收录」
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const num = Number(process.argv[2]);
const DRY = process.argv.includes('--dry');
const PREFIX = '第' + num + '关';
const COL_URL = 'https://www.zhihu.com/column/c_2097038288662152717';
const COL_NAME = '逻辑闯关';
const steps = [];
const log = function (o) { console.log(JSON.stringify(o)); };

async function clickText(ed, text, exact) {
  const pt = await ed.evaluate(function (a) {
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const hit = all.filter(function (e) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      const t = (e.innerText || '').trim();
      return a.ex ? t === a.t : t.indexOf(a.t) >= 0;
    });
    if (!hit.length) return null;
    hit.sort(function (x, y) {
      const rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect();
      return rx.width * rx.height - ry.width * ry.height;
    });
    const r = hit[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { t: text, ex: exact !== false });
  if (!pt) return false;
  await ed.mouse.click(pt.x, pt.y);
  return true;
}

// 读专栏当前篇数 + 是否已含目标关
async function columnState(ed) {
  return ed.evaluate(function (pre) {
    const txt = document.body.innerText || '';
    const m = txt.match(/·\s*(\d+)\s*篇内容/) || txt.match(/已更内容\s*·\s*(\d+)/);
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    const inList = all.some(function (e) {
      if (e.children.length > 0) return false;
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      return (e.innerText || '').trim().indexOf(pre) === 0;
    });
    return { count: m ? Number(m[1]) : null, hasTarget: inList };
  }, PREFIX);
}

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'zhihu' });
  const ed = page;
  try {
    await ed.goto(COL_URL, { waitUntil: 'domcontentloaded' });
    await sleep(ed, 6000);

    const before = await columnState(ed);
    steps.push({ step: 'column-before', column: COL_NAME, before: before });

    if (before.hasTarget) {
      log({ ok: true, num: num, skipped: true, reason: '已在专栏里', before: before, steps: steps });
      return;
    }
    if (DRY) {
      const s = shotPath('zh-column-dry');
      await ed.screenshot({ path: s });
      log({ ok: true, num: num, dryRun: true, before: before, shot: s, steps: steps });
      return;
    }

    // 打开收录抽屉
    const opened = await clickText(ed, '收录内容', true);
    await sleep(ed, 3500);
    steps.push({ step: 'drawer-open', opened: opened });
    if (!opened) throw new Error('找不到「收录内容」按钮');

    // 在抽屉里定位目标文章那一行，再点同一行的「收录」
    const target = await ed.evaluate(function (pre) {
      const all = Array.prototype.slice.call(document.querySelectorAll('*'));
      const leaf = all.filter(function (e) {
        if (e.children.length > 0) return false;
        const r = e.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return false;
        return (e.innerText || '').trim().indexOf(pre) === 0;
      })[0];
      if (!leaf) return null;
      const r = leaf.getBoundingClientRect();
      const rowY = r.top;

      // 同一纵向区间内的「收录」按钮，取最靠左的那个（抽屉在右侧）
      const btns = all.filter(function (e) {
        const rr = e.getBoundingClientRect();
        if (!(rr.width > 0 && rr.height > 0)) return false;
        if ((e.innerText || '').trim() !== '收录') return false;
        return Math.abs(rr.top - rowY) < 60;
      });
      if (!btns.length) return { title: leaf.innerText.trim(), rowY: rowY, btn: null };
      btns.sort(function (a, b) { return a.getBoundingClientRect().left - b.getBoundingClientRect().left; });
      const br = btns[0].getBoundingClientRect();
      return { title: leaf.innerText.trim(), rowY: rowY, btn: { x: br.left + br.width / 2, y: br.top + br.height / 2 } };
    }, PREFIX);

    steps.push({ step: 'target', target: target });
    if (!target || !target.btn) throw new Error('抽屉里找不到 ' + PREFIX + ' 的「收录」按钮');

    await ed.mouse.click(target.btn.x, target.btn.y);
    await sleep(ed, 4000);

    const s1 = shotPath('zh-column-after-click');
    await ed.screenshot({ path: s1 });
    steps.push({ step: 'clicked', shot: s1 });

    // 关掉抽屉（点空白或按 Esc），再校验
    await ed.keyboard.press('Escape').catch(function () {});
    await sleep(ed, 1500);
    await ed.reload({ waitUntil: 'domcontentloaded' });
    await sleep(ed, 6000);

    const after = await columnState(ed);
    const s2 = shotPath('zh-column-verified');
    await ed.screenshot({ path: s2 });
    steps.push({ step: 'verified', after: after, shot: s2 });

    const ok = after.hasTarget && (before.count == null || after.count == null || after.count > before.count);
    log({ ok: ok, num: num, before: before, after: after, shot: s2, steps: steps });
    if (!ok) process.exitCode = 1;
  } catch (e) {
    let shot = null;
    try { shot = shotPath('zh-column-error'); await ed.screenshot({ path: shot }); } catch (_) {}
    log({ ok: false, num: num, error: String((e && e.message) || e), shot: shot, steps: steps });
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
