// 探头条发布页：封面区 / 合集入口 / 作品声明 的位置与可操作元素
//   node pub_tt_probe_publish.js 1
const fs = require('fs');
const path = require('path');
const { launch, shotPath, ROOT } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

const EDITOR = 'https://mp.toutiao.com/profile_v4/graphic/publish';
const num = Number(process.argv[2] || 1);

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const out = {};
  try {
    await page.goto(EDITOR, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(page, 8000);
    for (const t of ['我知道了', '知道了', '跳过']) {
      const p = await page.evaluate(function (txt) {
        const all = Array.prototype.slice.call(document.querySelectorAll('*'));
        const hit = all.filter(function (e) {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (e.innerText || '').trim() === txt;
        });
        if (!hit.length) return null;
        const r = hit[0].getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, t).catch(function () { return null; });
      if (p) { await page.mouse.click(p.x, p.y); await sleep(page, 1000); }
    }

    out.fileInputs = await page.evaluate(function () {
      return Array.prototype.slice.call(document.querySelectorAll('input[type=file]')).map(function (e) {
        const r = e.getBoundingClientRect();
        return { accept: e.accept, hidden: r.width === 0, cls: String(e.className || '').slice(0, 60) };
      });
    });

    out.anchors = await page.evaluate(function () {
      const want = ['展示封面', '添加至合集', '作品声明', '发文设置', '声明首发', '添加位置'];
      const res = {};
      const all = Array.prototype.slice.call(document.querySelectorAll('*'));
      want.forEach(function (w) {
        const hit = all.filter(function (e) {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (e.innerText || '').trim().indexOf(w) === 0 && (e.innerText || '').trim().length < 12;
        }).map(function (e) {
          const r = e.getBoundingClientRect();
          return { t: (e.innerText || '').trim(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), tag: e.tagName };
        });
        res[w] = hit.slice(0, 3);
      });
      return res;
    });

    // 滚到底部看看还有什么
    await page.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(page, 1500);
    const sBottom = shotPath('tt-probe-pub-bottom');
    await page.screenshot({ path: sBottom });
    out.bottomShot = sBottom;

    await page.evaluate(function () { window.scrollTo(0, 0); });
    await sleep(page, 800);
    const sTop = shotPath('tt-probe-pub-top');
    await page.screenshot({ path: sTop });
    out.topShot = sTop;

    // 点「发文设置」看展开什么
    const setBtn = await page.evaluate(function () {
      const all = Array.prototype.slice.call(document.querySelectorAll('*'));
      const hit = all.filter(function (e) {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (e.innerText || '').trim() === '发文设置';
      });
      if (!hit.length) return null;
      const r = hit[hit.length - 1].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    out.setBtn = setBtn;
    if (setBtn) {
      await page.mouse.click(setBtn.x, setBtn.y);
      await sleep(page, 2500);
      const sSet = shotPath('tt-probe-pub-set');
      await page.screenshot({ path: sSet });
      out.setShot = sSet;
      out.setText = await page.evaluate(function () {
        return (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(-900);
      });
    }

    console.log(JSON.stringify(out, null, 1));
  } finally {
    await ctx.close();
  }
})().catch(function (e) {
  console.log(JSON.stringify({ error: String((e && e.message) || e) }));
});
