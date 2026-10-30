// 探「定时发布」的时间选择器结构（只读探测，用假标题，探完不确认）
//
// 目的：搞清楚点「定时发布」之后弹什么——日历？输入框？有没有限制？
// 做法：填一个假标题 → 点「定时发布」→ dump 弹层结构 → 截图 → 按 ESC 关掉
// 安全：标题带 TEST-DELETE-ME，万一真被排期了，一眼能认出来并手动删。
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const EDITOR = 'https://mp.toutiao.com/profile_v4/graphic/publish';
const DUMMY = 'TEST-DELETE-ME-探测定时发布';

async function tap(page, text) {
  const pt = await page.evaluate(function (t) {
    const c = [];
    document.querySelectorAll('button, a, div, span').forEach(function (e) {
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

function dumpModal() {
  const vis = function (e) {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const inputs = [];
  document.querySelectorAll('input, textarea').forEach(function (e) {
    if (!vis(e)) return;
    const r = e.getBoundingClientRect();
    inputs.push({
      tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || '',
      placeholder: e.getAttribute('placeholder') || '',
      value: (e.value || '').slice(0, 40),
      cls: String(e.className || '').slice(0, 60),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) },
    });
  });
  // 弹层里的可点文本（确定/取消/日期数字等）
  const texts = [];
  document.querySelectorAll('button, span, div, li, td').forEach(function (e) {
    if (e.children.length > 0 || !vis(e)) return;
    const t = (e.innerText || '').trim();
    if (!t || t.length > 24) return;
    const r = e.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    texts.push({ t: t, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  });
  const body = (document.body.innerText || '').replace(/\n{2,}/g, '\n');
  return {
    url: location.href,
    inputs: inputs,
    texts: texts.slice(0, 80),
    // 页面上所有提到"定时/时间/日期/小时内/天内"的提示语
    hints: Array.from(new Set(
      body.split('\n').map(function (s) { return s.trim(); })
        .filter(function (s) { return s && s.length < 70 && /定时|时间|日期|小时内|天内|之前|之后|不能早于|不能晚于/.test(s); })
    )).slice(0, 30),
  };
}

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const out = { steps: [] };
  try {
    await page.goto(EDITOR, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(page, 8000);
    if (/sso|passport/.test(page.url())) throw new Error('登录态失效：' + page.url());

    // 填假标题，让「定时发布」可点
    const ta = page.locator('textarea[placeholder*="标题"]').first();
    if (await ta.count()) {
      await ta.click();
      await ta.fill(DUMMY);
      await sleep(page, 800);
      out.steps.push({ step: 'title', ok: (await ta.inputValue()) === DUMMY });
    }

    // 正文字段给一点点，避免校验拦住
    const box = page.locator('.ProseMirror, [contenteditable="true"]').first();
    if (await box.count()) {
      await box.click();
      await sleep(page, 400);
      await page.keyboard.type('探测用占位正文，不要发布。');
      await sleep(page, 800);
    }

    await page.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(page, 1500);

    const hit = await tap(page, '定时发布');
    out.steps.push({ step: 'click-schedule', hit: hit });
    await sleep(page, 4000);

    const s1 = shotPath('tt-schedule-1');
    await page.screenshot({ path: s1 });
    out.steps.push({ step: 'after-click', shot: s1, dump: await page.evaluate(dumpModal) });

    // 再等一会，有的弹层是异步渲染
    await sleep(page, 3000);
    const s2 = shotPath('tt-schedule-2');
    await page.screenshot({ path: s2 });
    out.steps.push({ step: 'settled', shot: s2, dump: await page.evaluate(dumpModal) });

    // 不确认，按 ESC 关掉
    await page.keyboard.press('Escape');
    await sleep(page, 2000);
    const s3 = shotPath('tt-schedule-3');
    await page.screenshot({ path: s3 });
    out.steps.push({
      step: 'escaped', shot: s3,
      stillOpen: await page.evaluate(function () { return /定时发布/.test(document.body.innerText || ''); }),
    });

    console.log(JSON.stringify(out, null, 1));
  } catch (e) {
    out.error = String((e && e.message) || e);
    try { out.shot = shotPath('tt-schedule-err'); await page.screenshot({ path: out.shot }); } catch (_) {}
    console.log(JSON.stringify(out, null, 1));
  } finally {
    await ctx.close();
  }
})();
