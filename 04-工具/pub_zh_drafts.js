// 知乎草稿箱：列出 / 删除指定草稿
//   node pub_zh_drafts.js                    只列，不动
//   node pub_zh_drafts.js --delete=第1关     删掉标题以「第1关」开头的草稿
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);
const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : null;
};
const DEL = argOf('delete');

async function clickText(ed, text, exact = true) {
  const pt = await ed.evaluate(({ t, ex }) => {
    const els = [...document.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      const txt = (e.innerText || '').trim();
      return ex ? txt === t : txt.includes(t);
    });
    if (!els.length) return null;
    els.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { t: text, ex: exact });
  if (!pt) return false;
  await ed.mouse.click(pt.x, pt.y);
  return true;
}

(async () => {
  const { ctx, page } = await launch({ headless: false, profile: 'zhihu' });
  const ed = page;
  const steps = [];
  try {
    await ed.goto('https://www.zhihu.com/creator/manage/creation/all', { waitUntil: 'domcontentloaded' });
    await sleep(ed, 7000);

    // 点「草稿箱」标签
    const okTab = await clickText(ed, '草稿箱', false);
    await sleep(ed, 5000);
    const shot0 = shotPath('zh-drafts-tab');
    await ed.screenshot({ path: shot0 });
    steps.push({ step: 'drafts-tab', clicked: okTab, shot: shot0 });

    const titles = await ed.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll('*')) {
        if (e.children.length) continue;
        const t = (e.innerText || '').trim();
        if (/^第\d+关/.test(t) && t.length > 5) out.push(t);
      }
      return [...new Set(out)];
    });
    steps.push({ step: 'list', titles });

    if (DEL) {
      const target = titles.find((t) => t.startsWith(DEL));
      if (!target) throw new Error(`草稿箱里没有以「${DEL}」开头的草稿`);
      steps.push({ step: 'target', target });

      // 卡片上直接有「删除」按钮，按标题的纵向位置锁定同一行的那个
      const card = await ed.evaluate((t) => {
        const leaf = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && (e.innerText || '').trim() === t);
        if (!leaf) return null;
        const r = leaf.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
      }, target);
      if (!card) throw new Error('找不到草稿卡片');
      await ed.mouse.move(card.x, card.y);
      await sleep(ed, 1200);

      const delPt = await ed.evaluate((top) => {
        const all = [...document.querySelectorAll('*')].filter((e) => {
          const r = e.getBoundingClientRect();
          if (!(r.width > 0 && r.height > 0)) return false;
          const t = (e.innerText || '').trim();
          return t.includes('删除') && t.length <= 8 && r.width < 200 && r.height < 60;
        });
        if (!all.length) return { pt: null, cands: [] };
        const cands = all.map((e) => {
          const r = e.getBoundingClientRect();
          return { t: (e.innerText || '').trim(), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        });
        const inBand = all.filter((e) => {
          const r = e.getBoundingClientRect();
          return r.top > top - 80 && r.top < top + 200;
        });
        const pick = (inBand.length ? inBand : all).sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return ra.width * ra.height - rb.width * rb.height;
        })[0];
        const r = pick.getBoundingClientRect();
        return { pt: { x: r.left + r.width / 2, y: r.top + r.height / 2 }, cands };
      }, card.top);
      steps.push({ step: 'delete-btn', pt: delPt.pt, cands: delPt.cands });
      if (!delPt.pt) throw new Error('卡片上找不到「删除」');

      await ed.mouse.click(delPt.pt.x, delPt.pt.y);
      await sleep(ed, 2500);
      const shot2 = shotPath('zh-draft-confirm');
      await ed.screenshot({ path: shot2 });
      steps.push({ step: 'confirm-dialog', shot: shot2 });

      // 确认框里再点一次「删除」/「确定」
      const bodyHas = await ed.evaluate(() => /确定要删除|删除后不可恢复|确认删除/.test(document.body.innerText));
      steps.push({ step: 'confirm-needed', bodyHas });
      if (bodyHas) {
        const ok2 = await clickText(ed, '删除', true) || await clickText(ed, '确定', true);
        steps.push({ step: 'confirm-click', ok: ok2 });
        await sleep(ed, 3000);
      }
      const shot3 = shotPath('zh-draft-after');
      await ed.screenshot({ path: shot3 });
      const after = await ed.evaluate(() => {
        const out = [];
        for (const e of document.querySelectorAll('*')) {
          if (e.children.length) continue;
          const t = (e.innerText || '').trim();
          if (/^第\d+关/.test(t) && t.length > 5) out.push(t);
        }
        return [...new Set(out)];
      });
      steps.push({ step: 'after', shot: shot3, titles: after, deleted: !after.includes(target) });
    }

    console.log(JSON.stringify({ ok: true, steps }, null, 1));
  } catch (e) {
    let shot = null;
    try { shot = shotPath('zh-drafts-error'); await ed.screenshot({ path: shot }); } catch (_) {}
    console.log(JSON.stringify({ ok: false, error: String((e && e.message) || e), shot, steps }, null, 1));
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
