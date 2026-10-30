// 四平台连通性检查（只读，不发任何东西）
//   node pub_conn_check.js
//
// 每个平台用各自的浏览器档案打开一个「后台首页 / 发布页」，只判断三件事：
//   1. 域名能不能访问（HTTP 层）
//   2. 登录态还在不在（页面有没有被踢回登录页）
//   3. 发布入口在不在（页面上有没有「写文章 / 上传图文 / 发布」这类字样）
// 不点任何按钮，不新建草稿，不发任何内容。
const { launch, shotPath } = require('./pub_browser');

const { sleep } = require('./pub_browser');   // 统一走速度开关 PUB_SPEED

const PLATFORMS = [
  {
    key: 'wx',
    name: '公众号',
    profile: 'wx',
    url: 'https://mp.weixin.qq.com/',
    // 登录后会被重定向到 /cgi-bin/home?t=home/index&token=...
    judge: (url, text) => ({
      loggedIn: /\/cgi-bin\/home/.test(url) && /token=/.test(url),
      entry: /新的创作|图文消息|草稿箱|发表/.test(text),
    }),
  },
  {
    key: 'zhihu',
    name: '知乎',
    profile: 'zhihu',
    url: 'https://www.zhihu.com/creator',
    judge: (url, text, cookies) => ({
      loggedIn: !/signin|\/login/.test(url) && cookies.some((c) => c.name === 'z_c0' && c.value),
      entry: /创作中心|写文章|发布/.test(text),
    }),
  },
  {
    key: 'xhs',
    name: '小红书',
    profile: 'xhs',
    url: 'https://creator.xiaohongshu.com/publish/publish?source=official',
    judge: (url, text) => ({
      loggedIn: !/\/login/.test(url) && /上传图文|写长文|发布笔记/.test(text),
      entry: /上传图文|写长文|发布笔记/.test(text),
    }),
  },
  {
    key: 'toutiao',
    name: '今日头条',
    profile: 'toutiao',
    url: 'https://mp.toutiao.com/profile_v4/index',
    judge: (url, text) => ({
      loggedIn: !/auth\/page\/login|\/login/.test(url) && /发布|创作|主页/.test(text),
      entry: /发布|图文|作品管理/.test(text),
    }),
  },
];

async function httpProbe(url) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal });
    clearTimeout(timer);
    return { ok: true, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 80), ms: Date.now() - t0 };
  }
}

(async () => {
  const only = process.argv[2] || '';
  const list = only ? PLATFORMS.filter((p) => p.key === only) : PLATFORMS;
  const results = [];
  for (const p of list) {
    const r = { key: p.key, name: p.name, url: p.url };
    r.http = await httpProbe(p.url);

    const t0 = Date.now();
    let ctx;
    try {
      const l = await launch({ headless: false, profile: p.profile });
      ctx = l.ctx;
      const page = l.page;
      // 用 commit：头条这类 SPA 的 domcontentloaded 会被长连接拖住，直接超时
      await page.goto(p.url, { waitUntil: 'commit', timeout: 45000 });
      await sleep(page, 9000);

      const url = page.url();
      const text = await page.evaluate(() => (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 1200)).catch(() => '');
      const cookies = await ctx.cookies(url).catch(() => []);
      const j = p.judge(url, text, cookies);

      r.finalUrl = url;
      r.title = await page.title().catch(() => '');
      r.loggedIn = j.loggedIn;
      r.entry = j.entry;
      r.sample = text.replace(/\n/g, ' / ').slice(0, 160);
      r.shot = shotPath(`conn-${p.key}`);
      await page.screenshot({ path: r.shot }).catch(() => {});
      r.ok = true;
    } catch (e) {
      r.ok = false;
      r.error = String((e && e.message) || e).split('\n')[0];
    } finally {
      if (ctx) await ctx.close().catch(() => {});
      r.ms = Date.now() - t0;
    }
    results.push(r);
    console.log(JSON.stringify(r));
  }

  const summary = results.map((r) => ({
    platform: r.name,
    http: r.http.ok ? `HTTP ${r.http.status}` : `网络失败(${r.http.error})`,
    login: r.loggedIn ? '已登录' : '未登录',
    entry: r.entry ? '发布入口可见' : '未见发布入口',
    note: r.ok ? '' : r.error,
  }));
  console.log('\n===== 汇总 =====');
  console.log(JSON.stringify(summary, null, 1));
})();
