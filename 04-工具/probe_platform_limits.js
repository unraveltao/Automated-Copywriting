// 多平台发布规则实测：只读探针
//
// 目的：把"各平台到底限多少字"从传闻变成实测数字。
// 做法：打开各平台编辑器（不填不存不发布），读三样东西——
//   1. 标题输入框的 maxlength 属性（硬限制，最可信）
//   2. 标题框附近的"0/30"这类计数器文本
//   3. 页面里所有"最多 N 字 / 不超过 N / N 字以内"的提示语（含上下文）
//
// 用法：
//   node probe_platform_limits.js            # 全部四个平台
//   node probe_platform_limits.js wx zhihu   # 指定平台
//
// 不会写入任何内容，也不会创建草稿。打开编辑器即退出。
const { launch, shotPath } = require('./pub_browser');

const sleep = (p, ms) => p.waitForTimeout(ms);

// 各平台编辑页入口。wx 需要先拿 token，见 resolveUrl。
const PLATFORMS = {
  wx: {
    name: '公众号',
    url: 'https://mp.weixin.qq.com/',
    async resolveUrl(page) {
      const u = page.url();
      const m = u.match(/token=(\d+)/);
      if (!m) {
        // token 可能不在地址栏，去页面脚本里捞
        const t = await page.evaluate(function () {
          const html = document.documentElement.innerHTML;
          const hit = html.match(/token["'\s:=]+(\d{5,})/);
          return hit ? hit[1] : '';
        }).catch(function () { return ''; });
        if (!t) return null;
        return 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=' + t + '&lang=zh_CN';
      }
      return 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=' + m[1] + '&lang=zh_CN';
    },
  },
  zhihu: {
    name: '知乎',
    url: 'https://zhuanlan.zhihu.com/write',
  },
  xhs: {
    name: '小红书',
    url: 'https://creator.xiaohongshu.com/publish/publish?source=official',
    // 小红书发布页默认停在「上传视频」，必须走「写长文 → 新的创作」才出标题框
    async prepare(ctx, page) {
      // 用坐标点，别用 getByText：按钮是 div>span 嵌套，getByText 会点到外层不可点层。
      // 取 innerText 完全相等、且宽度最小的那个（= 最内层），点它的中心。
      const tap = async function (text) {
        const pt = await page.evaluate(function (t) {
          const cands = [];
          document.querySelectorAll('button, a, div, span').forEach(function (e) {
            if ((e.innerText || '').trim() !== t) return;
            const r = e.getBoundingClientRect();
            const st = getComputedStyle(e);
            if (r.width < 10 || r.height < 10) return;
            if (st.display === 'none' || st.visibility === 'hidden') return;
            cands.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width });
          });
          if (!cands.length) return null;
          cands.sort(function (a, b) { return a.w - b.w; });
          return cands[0];
        }, text);
        if (!pt) return false;
        await page.mouse.click(pt.x, pt.y);
        return true;
      };
      // 「新的创作」会新开一个标签页，编辑器在那个新页里，必须跟过去
      const pickEditor = async function () {
        for (const p of ctx.pages()) {
          if (await p.locator('textarea[placeholder="输入标题"]').count()) return p;
        }
        return null;
      };

      for (let i = 0; i < 4; i++) {
        const cur = await pickEditor();
        if (cur) return cur;
        if (!(await page.locator('textarea[placeholder="输入标题"]').count())) {
          await tap('写长文');
          await sleep(page, 5000);
        }
        await tap('新的创作');
        for (let w = 0; w < 6; w++) {
          await sleep(page, 2000);
          const p = await pickEditor();
          if (p) return p;
        }
      }
      return null;
    },
  },
  toutiao: {
    name: '今日头条',
    url: 'https://mp.toutiao.com/profile_v4/graphic/publish',
  },
};

// 在页面里跑：找标题框 + 捞限制提示语
function inspect() {
  const vis = function (e) {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  };
  const txt = function (e) { return (e.innerText || e.value || '').trim(); };

  // 1. 标题类输入框：placeholder / class / id 里带标题字样的
  const fields = [];
  Array.prototype.slice.call(document.querySelectorAll('input, textarea, [contenteditable="true"]'))
    .forEach(function (e) {
      const sig = [e.getAttribute('placeholder') || '', e.className || '', e.id || '', e.getAttribute('name') || ''].join(' ');
      if (!/标题|题目|title/i.test(sig)) return;
      const r = e.getBoundingClientRect();
      fields.push({
        tag: e.tagName.toLowerCase(),
        placeholder: e.getAttribute('placeholder') || '',
        id: e.id || '',
        cls: String(e.className || '').slice(0, 70),
        maxlength: e.getAttribute('maxlength') || null,
        maxLengthProp: typeof e.maxLength === 'number' && e.maxLength >= 0 ? e.maxLength : null,
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        visible: vis(e),
      });
    });

  // 2. 计数器："0/30"、"0 / 64"、"还可以输入 30 字"
  const counters = [];
  const reCounter = /(\d{1,3})\s*\/\s*(\d{1,3})|还可以输入\s*(\d{1,4})\s*字|已输入\s*(\d{1,4})/;
  Array.prototype.slice.call(document.querySelectorAll('*')).forEach(function (e) {
    if (e.children.length > 0) return;
    const t = (e.innerText || '').trim();
    if (!t || t.length > 30) return;
    if (!reCounter.test(t)) return;
    if (!vis(e)) return;
    counters.push({ text: t, y: Math.round(e.getBoundingClientRect().top) });
  });

  // 3. 页面里所有明说的限制
  const limits = [];
  const reLimit = /(最多|不超过|至多|限)\s*(\d{1,4})\s*(个|张|字|条|篇|字以内)?|(\d{1,4})\s*字以内|(\d{1,4})\s*个字/;
  Array.prototype.slice.call(document.querySelectorAll('*')).forEach(function (e) {
    if (e.children.length > 0) return;
    const t = (e.innerText || '').trim();
    if (!t || t.length > 60) return;
    if (!reLimit.test(t)) return;
    limits.push(t);
  });

  return {
    url: location.href,
    title: document.title,
    fields: fields,
    counters: counters.slice(0, 20),
    limits: Array.from(new Set(limits)).slice(0, 40),
    bodyEditors: Array.prototype.slice.call(document.querySelectorAll('[contenteditable="true"], .ProseMirror, .ql-editor'))
      .filter(vis).length,
  };
}

(async function () {
  const want = process.argv.slice(2).filter(function (a) { return PLATFORMS[a]; });
  const list = want.length ? want : Object.keys(PLATFORMS);
  const out = [];

  for (const key of list) {
    const cfg = PLATFORMS[key];
    const rec = { platform: key, name: cfg.name, steps: [] };
    let ctx;
    try {
      const r = await launch({ headless: false, profile: key });
      ctx = r.ctx;
      let page = r.page;

      await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(page, 6000);

      if (cfg.resolveUrl) {
        const u = await cfg.resolveUrl(page);
        if (!u) throw new Error('拿不到 token，可能未登录');
        await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(page, 8000);
      }

      if (/login|signin|passport|sso/i.test(page.url())) {
        throw new Error('登录态失效：' + page.url());
      }

      if (cfg.prepare) {
        const p2 = await cfg.prepare(ctx, page);
        rec.prepared = !!p2;
        if (!p2) throw new Error('进不去编辑器（准备步骤失败）');
        page = p2;
        await sleep(page, 2500);
      }

      const data = await page.evaluate(inspect);
      rec.data = data;
      const shot = shotPath('probe-' + key);
      await page.screenshot({ path: shot });
      rec.shot = shot;
    } catch (e) {
      rec.error = String((e && e.message) || e);
      try { rec.shot = shotPath('probe-' + key + '-err'); await ctx.pages()[0].screenshot({ path: rec.shot }); } catch (_) {}
    } finally {
      try { await ctx.close(); } catch (_) {}
    }
    out.push(rec);
    console.error('[done] ' + key + (rec.error ? ' ERR ' + rec.error : ''));
  }

  console.log(JSON.stringify(out, null, 1));
})();
