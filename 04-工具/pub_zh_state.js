// 知乎状态检查：草稿箱有几份、/write 是否恢复上次草稿、封面入口在哪
//   node pub_zh_state.js
const { launch, shotPath } = require('./pub_browser');
const sleep = (p, ms) => p.waitForTimeout(ms);

(async () => {
  const { ctx, page } = await launch({ headless: false, profile: 'zhihu' });
  const ed = page;
  const out = { steps: [] };
  try {
    // 1. 草稿箱
    await ed.goto('https://www.zhihu.com/creator/manage/creation/all', { waitUntil: 'domcontentloaded' });
    await sleep(ed, 6000);
    const s1 = shotPath('zh-drafts');
    await ed.screenshot({ path: s1 });
    const drafts = await ed.evaluate(() => {
      const txt = document.body.innerText || '';
      const m = txt.match(/草稿[（(](\d+)[)）]/);
      return { count: m ? Number(m[1]) : null, text: txt.replace(/\n{2,}/g, '\n').slice(0, 800) };
    });
    out.steps.push({ step: 'drafts', shot: s1, ...drafts });

    // 2. /write 是否恢复
    await ed.goto('https://zhuanlan.zhihu.com/write', { waitUntil: 'domcontentloaded' });
    await sleep(ed, 7000);
    const restored = await ed.evaluate(() => {
      const ta = document.querySelector('textarea[placeholder*="请输入标题"]');
      const body = document.querySelector('.public-DraftEditor-content');
      return {
        title: ta ? ta.value : null,
        bodyChars: body ? (body.innerText || '').length : null,
        bodyHead: body ? (body.innerText || '').slice(0, 80) : null,
      };
    });
    const s2 = shotPath('zh-rewrite');
    await ed.screenshot({ path: s2 });
    out.steps.push({ step: 'rewrite', shot: s2, ...restored });

    // 3. 封面入口：找隐藏 file input + 可点区域
    await ed.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(ed, 2000);
    const cover = await ed.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const inputs = [...document.querySelectorAll('input[type=file]')].map((e) => ({
        accept: e.getAttribute('accept') || '',
        cls: (e.className || '').toString().slice(0, 60),
        visible: vis(e),
      }));
      const hit = [...document.querySelectorAll('*')].filter((e) => vis(e) && /添加文章封面/.test(e.innerText || '') && (e.innerText || '').length < 30)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { tag: e.tagName, cls: (e.className || '').toString().slice(0, 70), rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
        });
      return { fileInputs: inputs, hit };
    });
    const s3 = shotPath('zh-cover-area');
    await ed.screenshot({ path: s3 });
    out.steps.push({ step: 'cover', shot: s3, ...cover });

    console.log(JSON.stringify(out, null, 1));
  } catch (e) {
    console.log(JSON.stringify({ step: 'error', error: String((e && e.message) || e) }));
  } finally {
    await ctx.close();
  }
})();
