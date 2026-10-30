// 今日头条编辑器探针：只读，不发内容
//   node pub_tt_probe.js
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

async function dump(ed) {
  return ed.evaluate(function () {
    const out = { url: location.href, title: document.title, inputs: [], editables: [], buttons: [], flags: {}, bodyText: '' };
    const all = Array.prototype.slice.call(document.querySelectorAll('*'));
    all.forEach(function (e) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
      const tag = e.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        out.inputs.push({
          tag: tag,
          ph: e.getAttribute('placeholder') || '',
          cls: String(e.className || '').slice(0, 70),
          rect: rect,
          val: String(e.value || '').slice(0, 30)
        });
      }
      const ce = e.getAttribute('contenteditable');
      if (ce === 'true' || ce === '') {
        out.editables.push({
          tag: tag,
          cls: String(e.className || '').slice(0, 70),
          rect: rect,
          text: String(e.innerText || '').trim().slice(0, 50)
        });
      }
      if (tag === 'BUTTON' || e.getAttribute('role') === 'button') {
        const t = (e.innerText || '').trim();
        if (t && t.length < 12) out.buttons.push({ t: t, cls: String(e.className || '').slice(0, 60), rect: rect });
      }
    });
    const txt = document.body.innerText || '';
    out.flags = {
      有AI声明: /AI|人工智能/.test(txt),
      有定时发布: /定时发布|定时/.test(txt),
      有原创: /原创/.test(txt),
      有封面: /封面/.test(txt),
      有标签: /标签/.test(txt),
      有分类: /分类|频道/.test(txt),
    };
    out.bodyText = txt.replace(/\n{2,}/g, '\n').slice(0, 1500);
    return out;
  });
}

(async function () {
  const { ctx, page } = await launch({ headless: false, profile: 'toutiao' });
  const ed = page;
  try {
    await ed.goto('https://mp.toutiao.com/profile_v4/graphic/publish', { waitUntil: 'domcontentloaded' });
    await sleep(ed, 8000);

    const s1 = shotPath('tt-probe-open');
    await ed.screenshot({ path: s1 });
    const d = await dump(ed);
    console.log(JSON.stringify({ step: 'probe', shot: s1, inputs: d.inputs, editables: d.editables, flags: d.flags, bodyText: d.bodyText }, null, 1));

    // 往下滚，看发布设置区
    await ed.evaluate(function () { window.scrollTo(0, document.body.scrollHeight); });
    await sleep(ed, 2500);
    const s2 = shotPath('tt-probe-bottom');
    await ed.screenshot({ path: s2 });
    const d2 = await dump(ed);
    console.log(JSON.stringify({ step: 'bottom', shot: s2, buttons: d2.buttons.slice(0, 40), flags: d2.flags }, null, 1));
  } catch (e) {
    console.log(JSON.stringify({ step: 'error', error: String((e && e.message) || e) }));
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
