// 探「定时发布」：精确点按钮 + 带封面过校验
//   node pub_tt_probe_schedule2.js
// 只探测，不确认排期；标题带 TEST-DELETE-ME 便于识别。
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const EDITOR = 'https://mp.toutiao.com/profile_v4/graphic/publish';
const DUMMY = 'TEST-DELETE-ME-探测定时发布';
const COVER = process.argv[2] || '';

async function dumpAll(page) {
  return page.evaluate(function () {
    const vis = function (e) {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    // 找 z-index 高的浮层（弹层/气泡/toast）
    const layers = [];
    document.querySelectorAll('div,section,aside').forEach(function (e) {
      const s = getComputedStyle(e);
      const z = parseInt(s.zIndex || '0', 10);
      const pos = s.position;
      if (!vis(e)) return;
      if (z < 100 && pos !== 'fixed') return;
      const r = e.getBoundingClientRect();
      if (r.width < 80 || r.height < 40) return;
      layers.push({
        pos: pos, z: z,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        text: (e.innerText || '').replace(/\n+/g, ' | ').slice(0, 200),
      });
    });
    const inputs = [];
    document.querySelectorAll('input, textarea').forEach(function (e) {
      if (!vis(e)) return;
      inputs.push({
        type: e.getAttribute('type') || '',
        placeholder: e.getAttribute('placeholder') || '',
        value: (e.value || '').slice(0, 30),
        cls: String(e.className || '').slice(0, 50),
      });
    });
    const body = (document.body.innerText || '').replace(/\n{2,}/g, '\n');
    return {
      layers: layers.slice(0, 12),
      inputs: inputs,
      hints: Array.from(new Set(body.split('\n').map(function (s) { return s.trim(); })
        .filter(function (s) { return s && s.length < 80 && /定时|时间|日期|小时内|天内|之前|之后|不能早于|不能晚于|请选择|请设置/.test(s); }))).slice(0, 20),
    };
  });
}

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const out = { steps: [] };
  try {
    await page.goto(EDITOR, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(page, 8000);
    if (/sso|passport/.test(page.url())) throw new Error('登录态失效');

    const ta = page.locator('textarea[placeholder*="标题"]').first();
    await ta.click();
    await ta.fill(DUMMY);
    await sleep(page, 600);

    const box = page.locator('.ProseMirror, [contenteditable="true"]').first();
    await box.click();
    await sleep(page, 400);
    await page.keyboard.type('探测用占位正文，不要发布。');
    await sleep(page, 600);

    // 封面：点 + → 素材弹窗传图 → 确定（和发布脚本同一套）
    if (COVER) {
      await page.evaluate(function () {
        const el = Array.prototype.slice.call(document.querySelectorAll('*'))
          .find(function (e) { return (e.innerText || '').trim() === '展示封面'; });
        if (el) el.scrollIntoView({ block: 'center' });
      });
      await sleep(page, 1500);
      // 直接给第一个 file input 传图（封面框在页面上）
      const n = await page.locator('input[type=file]').count();
      let set = false;
      for (let i = 0; i < n; i++) {
        await page.locator('input[type=file]').nth(i).setInputFiles(COVER).catch(function () {});
        await sleep(page, 2500);
        const added = await page.evaluate(function () {
          return /已上传\s*\d+\s*张图片/.test(document.body.innerText || '');
        });
        if (added) { set = true; break; }
      }
      // 素材弹窗确定
      for (let i = 0; i < 6; i++) {
        const still = await page.evaluate(function () { return /上传图片/.test(document.body.innerText || ''); });
        if (!still) break;
        await page.getByRole('button', { name: '确定' }).last().click({ timeout: 4000 }).catch(function () {});
        await sleep(page, 2500);
      }
      out.steps.push({ step: 'cover', set: set });
      await sleep(page, 2000);
    }

    await page.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(page, 1500);

    // 精确点：先按 role，再按文本，最后按坐标
    let how = '';
    const btn = page.locator('button:has-text("定时发布")').last();
    if (await btn.count()) {
      const bb = await btn.boundingBox().catch(function () { return null; });
      await btn.click({ timeout: 6000 }).catch(function () {});
      how = 'locator:' + JSON.stringify(bb);
    } else {
      const pt = await page.evaluate(function () {
        const c = [];
        document.querySelectorAll('button, div, span').forEach(function (e) {
          if ((e.innerText || '').trim() !== '定时发布') return;
          const r = e.getBoundingClientRect();
          if (r.width < 10) return;
          c.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width });
        });
        if (!c.length) return null;
        c.sort(function (a, b) { return b.w - a.w; });
        return c[0];
      });
      if (pt) { await page.mouse.click(pt.x, pt.y); how = 'coord:' + JSON.stringify(pt); }
    }
    out.steps.push({ step: 'click', how: how });

    for (const wait of [1500, 3000, 3000]) {
      await sleep(page, wait);
      const s = shotPath('tt-sched');
      await page.screenshot({ path: s });
      out.steps.push({ step: 'dump+' + wait, shot: s, dump: await dumpAll(page) });
    }

    await page.keyboard.press('Escape');
    await sleep(page, 1500);
    const s2 = shotPath('tt-sched-esc');
    await page.screenshot({ path: s2 });
    out.steps.push({ step: 'escaped', shot: s2 });

    console.log(JSON.stringify(out, null, 1));
  } catch (e) {
    out.error = String((e && e.message) || e);
    try { out.shot = shotPath('tt-sched-err'); await page.screenshot({ path: out.shot }); } catch (_) {}
    console.log(JSON.stringify(out, null, 1));
  } finally {
    await ctx.close();
  }
})();
