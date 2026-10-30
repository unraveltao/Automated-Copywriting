// 小红书「写长文」发布（完整版）
//
//   node pub_xhs_publish.js 8                       干跑：填内容 + 一键排版 + 选第一个模板，停在排版页
//   node pub_xhs_publish.js 8 --go                  真发：一路到发布设置 → 合集 → 定时 → 发布
//   node pub_xhs_publish.js 8 --go --at=16:30       指定定时时间（默认当前 +2 小时）
//   node pub_xhs_publish.js 8 --go --no-publish     走完全流程但不点「发布」，只截图核对
//
// 2026-10-30 实测到的关键事实（别再猜）：
//  1. 小红书发文不需要上传图片：写长文 → 标题/正文 → 「一键排版」→ 选模板 → 7 张图文卡片自动生成
//  2. 第一个模板固定是「大图纯享」，默认就勾着
//  3. 图片生成要等（「笔记图片生成中，请稍后…」），没生成完点「下一步」无效
//  4. 发布页有个新手引导浮层「图片可以编辑啦」，会挡住标题和正文，要点「我知道了」
//  5. 合集在「内容设置 → 加入长文合集 → 选择合集」，列表里是「逻辑闯关 长文」
//  6. 「定时发布」是「更多设置」里的一个开关，点文字没用，得点开关本身
//  7. 登录态不跨进程：登录和发布必须同一进程跑完（ensureLogin 负责）
const fs = require('fs');
const path = require('path');
const { launch, shotPath, ROOT } = require('./pub_browser');
const { ensureLogin, PUBLISH, sleep } = require('./pub_xhs_ensure');

const num = Number(process.argv[2]);
const GO = process.argv.includes('--go');
const NO_PUBLISH = process.argv.includes('--no-publish');
const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : null;
};
const AT = argOf('at');                       // "HH:MM"
const COLLECTION = argOf('collection') || '逻辑闯关';
const WAIT_MIN = Number(process.env.XHS_WAIT_SEC || 10);

const log = (o) => console.log(JSON.stringify(o));
const steps = [];

// —— 物料 ——
function findArticle(n) {
  const dir = path.join(ROOT, '01-内容', '逻辑闯关');
  const pre = `第${n}关｜`;
  const f = fs.readdirSync(dir).find((x) => x.startsWith(pre) && x.endsWith('.md'));
  if (!f) throw new Error(`找不到第${n}关的母稿`);
  return path.join(dir, f);
}

// 小红书正文（短文案）：优先读发布包里的 meta.json，没有就从母稿压一段
function xhsDesc(n) {
  const pack = path.join(ROOT, '06-存档', '逻辑闯关', '发布包', `第${String(n).padStart(3, '0')}关`, 'meta.json');
  if (fs.existsSync(pack)) {
    const m = JSON.parse(fs.readFileSync(pack, 'utf8'));
    if (m['小红书'] && m['小红书'].文案) return m['小红书'].文案.trim();
  }
  return '';
}

function mdToPlain(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  for (let raw of lines) {
    let t = raw.trim();
    if (!t) { out.push(''); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { out.push(''); continue; }
    t = t.replace(/^#{1,6}\s+/, '');
    t = t.replace(/^>\s?/, '');
    t = t.replace(/^[-*+]\s+/, '· ');
    t = t.replace(/\*\*(.+?)\*\*/g, '$1');
    t = t.replace(/`([^`]+)`/g, '$1');
    out.push(t);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// —— 小工具 ——
async function bodyText(page) {
  return page.evaluate(() => (document.body.innerText || '')).catch(() => '');
}

async function waitForText(page, re, ms = 60000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const t = await bodyText(page);
    if (re.test(t)) return true;
    await sleep(page, 2000);
  }
  return false;
}

async function clickText(page, text, opts = {}) {
  const box = await page.evaluate(({ t, exact }) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const els = [...document.querySelectorAll('button,[role="button"],a,div,span,li')]
      .filter((e) => vis(e) && (exact ? (e.innerText || '').trim() === t : (e.innerText || '').includes(t)));
    if (!els.length) return null;
    els.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    els[0].scrollIntoView({ block: 'center' });
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: (els[0].innerText || '').trim().slice(0, 24) };
  }, { t: text, exact: opts.exact !== false });
  if (!box) return null;
  await page.mouse.click(box.x, box.y);
  return box;
}

// 点「某个文字所在行」里的开关（定时发布 / 原创声明都是这种结构）
// 两个坑：
//  1. 类名里带 switch 的元素很多（custom-switch-text-desc 之类都是文字），真正的是 .d-switch
//  2. 开关和文字不一定在同一个容器里，按 closest 找会落空 → 改成按同一行垂直位置就近匹配
async function clickSwitchByLabel(page, label) {
  const box = await page.evaluate((lab) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const labelEl = [...document.querySelectorAll('*')]
      .filter((e) => vis(e) && (e.innerText || '').trim() === lab)
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!labelEl) return null;
    labelEl.scrollIntoView({ block: 'center' });
    const lr = labelEl.getBoundingClientRect();
    const ly = lr.top + lr.height / 2;
    const cands = [...document.querySelectorAll('.d-switch')].filter(vis).map((sw) => {
      const r = sw.getBoundingClientRect();
      return { sw, r, dy: Math.abs(r.top + r.height / 2 - ly), right: r.left > lr.left };
    }).sort((a, b) => a.dy - b.dy);
    const best = cands.find((c) => c.dy < 40 && c.right);
    if (!best) return null;
    const r = best.r;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, dy: Math.round(best.dy), cls: String(best.sw.className).slice(0, 50) };
  }, label);
  if (!box) return null;
  await sleep(page, 800);
  await page.mouse.click(box.x, box.y);
  return box;
}

// 定时开关打开后，把时间选择器整块读出来（日历格子 + 时间列表 + 输入框）
async function dumpPicker(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const p = (e) => ({
      tag: e.tagName.toLowerCase(),
      cls: (e.className && String(e.className).slice(0, 60)) || '',
      text: (e.innerText || e.value || '').trim().slice(0, 30),
      val: e.value || '',
    });
    const pop = [...document.querySelectorAll('[class*="picker"],[class*="calendar"],[class*="popover"],[class*="dropdown"],[class*="popup"]')]
      .filter((e) => vis(e) && e.getBoundingClientRect().width > 150);
    return {
      pops: pop.slice(0, 5).map((e) => ({ cls: String(e.className).slice(0, 60), text: (e.innerText || '').replace(/\n+/g, '|').slice(0, 600) })),
      timeTexts: [...document.querySelectorAll('*')].filter((e) => vis(e) && /^\d{1,2}:\d{2}$/.test((e.innerText || '').trim())).map(p).slice(0, 20),
      inputs: [...document.querySelectorAll('input')].filter(vis).map(p).slice(0, 20),
      rows: [...document.querySelectorAll('*')].filter((e) => vis(e) && /发布时间|定时/.test(e.innerText || '') && (e.innerText || '').length < 40).map(p).slice(0, 10),
    };
  });
}

async function dump(page, tag, tail = 1200) {
  const info = await page.evaluate(() => ({
    url: location.href,
    text: (document.body.innerText || '').replace(/\n{2,}/g, '\n'),
    inputs: [...document.querySelectorAll('input')].filter((e) => {
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    }).map((e) => ({ ph: e.getAttribute('placeholder') || '', val: e.value, cls: String(e.className || '').slice(0, 50) })),
  }));
  const shot = shotPath(tag);
  await page.screenshot({ path: shot });
  return { shot, url: info.url, tail: info.text.slice(-tail), inputs: info.inputs };
}

// —— 主流程 ——
(async () => {
  const articlePath = findArticle(num);
  const raw = fs.readFileSync(articlePath, 'utf8');
  const rawTitle = (raw.match(/^#\s+(.+)$/m) || [])[1] || '';
  const article = mdToPlain(raw.replace(/^#\s+.+\n?/, ''));
  const desc = xhsDesc(num) || '这一关的招式，都整理在下面的图文里了，往下翻。';
  steps.push({ step: 'material', title: rawTitle, titleLen: rawTitle.length, articleChars: article.length, descChars: desc.length });
  if (rawTitle.length > 64) throw new Error(`标题超 64 字：${rawTitle.length}`);

  // 定时时间：默认当前 +2 小时，取整到 5 分钟
  const target = (() => {
    if (AT) return AT;
    const d = new Date(Date.now() + 2 * 3600 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })();
  steps.push({ step: 'schedule', at: target });

  const { ctx, page } = await launch({ headless: false, profile: 'xhs' });
  try {
    const st = await ensureLogin(ctx, page, {
      waitMin: WAIT_MIN,
      onNeedScan: async () => {
        const s = shotPath('xhs-qr');
        await page.screenshot({ path: s }).catch(() => {});
        log({ step: 'need-scan', msg: '请扫窗口里的二维码', shot: s });
      },
    });
    steps.push({ step: 'login', ok: st.ok, url: st.url });
    if (!st.ok) throw new Error('登录没成功');

    // 1. 写长文 → 新的创作（标签页有时渲染慢，点了没反应，要重试）
    const scanFn = async () => {
      const s = shotPath('xhs-qr');
      await page.screenshot({ path: s }).catch(() => {});
      log({ step: 'need-scan', msg: '登录态掉了，请再扫一次窗口里的二维码', shot: s });
    };

    await page.goto(PUBLISH, { waitUntil: 'domcontentloaded' });
    await sleep(page, 6000);

    // 小红书会在中途踢回登录页（实测有），这里兜一次
    if (/\/login/.test(page.url())) {
      steps.push({ step: 'login-dropped', url: page.url() });
      const st2 = await ensureLogin(ctx, page, { waitMin: WAIT_MIN, onNeedScan: scanFn });
      steps.push({ step: 'relogin', ok: st2.ok });
      if (!st2.ok) throw new Error('重新登录失败');
      await page.goto(PUBLISH, { waitUntil: 'domcontentloaded' });
      await sleep(page, 5000);
    }

    let onLong = false;
    for (let i = 0; i < 5 && !onLong; i++) {
      await clickText(page, '写长文');
      await sleep(page, 5000);
      onLong = await waitForText(page, /新的创作/, 8000);
      steps.push({ step: 'tab-write', try: i + 1, onLong });
    }
    if (!onLong) throw new Error('切不到「写长文」标签');

    let editorOk = false;
    for (let i = 0; i < 3 && !editorOk; i++) {
      await clickText(page, '新的创作');
      await sleep(page, 8000);
      editorOk = (await page.locator('textarea[placeholder="输入标题"]').count()) > 0;
      steps.push({ step: 'new', try: i + 1, editorOk });
    }
    if (!editorOk) throw new Error('打不开长文编辑器');
    const ed = page;
    steps.push({ step: 'editor', url: ed.url() });

    // 2. 标题
    const ta = ed.locator('textarea[placeholder="输入标题"]').first();
    if (!(await ta.count())) throw new Error('找不到标题框');
    await ta.click();
    await ta.fill(rawTitle);
    await sleep(ed, 1000);
    const gotTitle = await ta.inputValue();
    steps.push({ step: 'title', ok: gotTitle === rawTitle });
    if (gotTitle !== rawTitle) throw new Error('标题没填对');

    // 3. 正文
    const box = ed.locator('.tiptap.ProseMirror').first();
    if (!(await box.count())) throw new Error('找不到正文编辑区');
    await box.click();
    await sleep(ed, 500);
    await ed.evaluate((txt) => {
      const el = document.querySelector('.tiptap.ProseMirror');
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', txt);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, article);
    await sleep(ed, 4000);
    const bodyLen = await ed.evaluate(() => (document.querySelector('.tiptap.ProseMirror')?.innerText || '').length);
    steps.push({ step: 'body', chars: bodyLen });
    if (bodyLen < article.length * 0.8) throw new Error(`正文没贴全：${bodyLen}/${article.length}`);

    // 4. 一键排版（AI 排版）
    if (!(await clickText(ed, '一键排版'))) throw new Error('找不到「一键排版」');
    // 原来这里盲等 8 秒再轮询，纯浪费：waitForText 自己会轮询，条件一满足就往下走
    if (!(await waitForText(ed, /选择模板/, 60000))) throw new Error('排版结果没出来');
    const layoutShot = await dump(ed, `xhs-${num}-layout`);
    steps.push({ step: 'layout', shot: layoutShot.shot });

    // 5. 第一个模板「大图纯享」
    const tpl = await clickText(ed, '大图纯享');
    steps.push({ step: 'template', hit: tpl });
    await sleep(ed, 2000);

    if (!GO) {
      log({ ok: true, dryRun: true, num, title: rawTitle, at: target, steps });
      return;
    }

    // 6. 下一步（图片没生成完点了没用，要重试）
    let onSettings = false;
    for (let i = 0; i < 8 && !onSettings; i++) {
      await clickText(ed, '下一步');
      onSettings = await waitForText(ed, /内容设置/, 20000);
      steps.push({ step: 'next', try: i + 1, onSettings });
    }
    if (!onSettings) throw new Error('进不了发布设置页（图片可能一直没生成完）');
    await sleep(ed, 3000);

    // 7. 关掉新手引导浮层
    for (let i = 0; i < 3; i++) {
      if (!(await clickText(ed, '我知道了'))) break;
      await sleep(ed, 1500);
    }

    // 8. 正文（短文案 + 标签），标题核对
    const descBox = ed.locator('.tiptap.ProseMirror').first();
    if (await descBox.count()) {
      await descBox.click();
      await sleep(ed, 500);
      await ed.evaluate((txt) => {
        const el = document.querySelector('.tiptap.ProseMirror');
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', txt);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, desc);
      await sleep(ed, 2500);
    }
    const titleOk = await ed.evaluate(() => {
      const i = document.querySelector('input[placeholder="填写标题会有更多赞哦"]');
      return i ? i.value : null;
    });
    steps.push({ step: 'settings-fill', descChars: desc.length, titleOnPage: titleOk });

    // 9. 合集：内容设置 → 选择合集 → 逻辑闯关
    // 用定位器（自动滚动 + 可见性等待），不再靠坐标——页面每次滚动位置都不同，坐标必错
    let collOk = false;
    for (let attempt = 0; attempt < 2 && !collOk; attempt++) {
      const picker = ed.getByText('选择合集', { exact: true }).first();
      if (!(await picker.count())) {
        steps.push({ step: 'collection', ok: false, msg: '找不到「选择合集」' });
        break;
      }
      await picker.click();
      await sleep(ed, 2500);
      const item = ed.getByText(COLLECTION, { exact: false }).last();
      if (await item.count()) await item.click();
      await sleep(ed, 2500);
      const t = await bodyText(ed);
      collOk = new RegExp(`加入长文合集[\\s\\S]{0,150}${COLLECTION}`).test(t);
      steps.push({ step: 'collection', attempt: attempt + 1, ok: collOk });
    }
    await dump(ed, `xhs-${num}-after-collection`, 300);

    // 10. 定时发布：定时发布是「更多设置」里最后一个开关
    const switches = ed.locator('.d-switch');
    const swCount = await switches.count();
    const sw = switches.nth(Math.max(0, swCount - 1));
    await sw.scrollIntoViewIfNeeded();
    await sw.click();
    await sleep(ed, 2500);

    // 时间框不在 .post-time-wrapper 里（那层只有文字），按「值符合 YYYY-MM-DD HH:MM」找，找到就打个标记
    const markTimer = () => ed.evaluate(() => {
      const el = [...document.querySelectorAll('input')].find((e) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(e.value || ''));
      if (!el) return false;
      el.setAttribute('data-xhs-time', '1');
      return true;
    });
    let hasTimer = false;
    for (let i = 0; i < 15 && !hasTimer; i++) {
      hasTimer = await markTimer();
      if (!hasTimer) await sleep(ed, 1500);
    }
    const dtInput = ed.locator('input[data-xhs-time="1"]').first();
    steps.push({ step: 'timer', switchCount: swCount, hasTimer });

    if (NO_PUBLISH) {
      const shot = await dump(ed, `xhs-${num}-timer`, 500);
      log({ ok: true, stopped: 'no-publish', num, at: target, collOk, hasTimer, shot: shot.shot, steps });
      return;
    }
    if (!hasTimer) throw new Error('定时开关打开了但时间框没出现');

    // 11. 改定时时间（默认是 +1 小时，要改成 +2 小时）
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const want = `${dateStr} ${target}`;
    await dtInput.click();
    await sleep(ed, 800);
    await ed.keyboard.press('Control+A');
    await ed.keyboard.type(want, { delay: 40 });
    await sleep(ed, 800);
    await ed.keyboard.press('Enter');
    await sleep(ed, 2000);
    const gotTime = await dtInput.inputValue().catch(() => '');
    steps.push({ step: 'datetime', want, got: gotTime, ok: gotTime === want });
    if (gotTime !== want) throw new Error(`定时时间没设上：期望 ${want}，实际 ${gotTime}`);

    await ed.keyboard.press('Escape'); // 收起日历面板
    await sleep(ed, 1200);
    const timeAfterEsc = await dtInput.inputValue().catch(() => '');
    if (timeAfterEsc !== want) throw new Error(`收起日历时时间被改回 ${timeAfterEsc}`);

    const prePublish = await dump(ed, `xhs-${num}-before-publish`, 600);
    steps.push({ step: 'before-publish', shot: prePublish.shot, collOk, time: timeAfterEsc });

    // 12. 底部主按钮：开关打开后从「发布」变成「定时发布」
    //
    // 这里踩了整整一晚，把结论写死在这儿，别再重复试错：
    //   底部固定栏是 **一个** <xhs-publish-btn> 自定义元素，它同时渲染两个按钮：
    //     save-text="暂存离开"（左） submit-text="定时发布"（右）
    //   它的内容在**闭合的 shadow root** 里（kids=0、shadowRoot=null），所以：
    //     - querySelectorAll 找不到按钮本体
    //     - 递归 shadowRoot 也穿不进去
    //     - innerText 读出来是空字符串
    //     - 按文字匹配「定时发布」只会命中「更多设置」里那个同名开关（位置更靠上）
    //   实测 rect = [331, 810, 680, 90]（视口 1440x900），两个按钮并排在中间：
    //     暂存离开 ≈ 宽度的 0.31~0.48，定时发布 ≈ 0.52~0.69
    //   所以只能按几何点：取宿主宽度的 0.60（右侧按钮正中心），失败再试 0.55 / 0.66。
    //   属性 submit-disabled 能直接告诉我们按钮可不可点，不用猜。
    const findSubmitPoint = async (offset = 0.6) => {
      return ed.evaluate((ratio) => {
        const deep = (root, out = []) => {
          for (const el of root.querySelectorAll('*')) {
            out.push(el);
            if (el.shadowRoot) deep(el.shadowRoot, out);
          }
          return out;
        };
        const vis = (e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const norm = (s) => (s || '').replace(/\s+/g, '');

        // 主策略：宿主元素 <xhs-publish-btn>（一个元素里两个按钮，按比例点右边那个）
        const hosts = deep(document)
          .filter((e) => (e.tagName || '').toLowerCase() === 'xhs-publish-btn' && vis(e))
          .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
        if (hosts.length) {
          const el = hosts[0];
          const h = el.getBoundingClientRect();
          return {
            mode: 'host',
            x: Math.round(h.left + h.width * ratio),
            y: Math.round(h.top + h.height / 2),
            rect: [Math.round(h.left), Math.round(h.top), Math.round(h.width), Math.round(h.height)],
            ratio,
            submitText: el.getAttribute('submit-text') || '',
            disabled: el.getAttribute('submit-disabled') === 't',
          };
        }

        // 兜底：按文字找，且必须落在视口底部 18% 内（排除「更多设置」里的同名开关）
        const H = window.innerHeight;
        const hit = deep(document)
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.top > H * 0.82 &&
              (norm(e.innerText) === '定时发布' || norm(e.innerText) === '发布');
          })
          .map((e) => e.getBoundingClientRect())
          .sort((a, b) => b.top - a.top)[0];
        if (!hit) return { mode: 'none' };
        return {
          mode: 'text',
          x: Math.round(hit.left + hit.width / 2),
          y: Math.round(hit.top + hit.height / 2),
          rect: [Math.round(hit.left), Math.round(hit.top), Math.round(hit.width), Math.round(hit.height)],
        };
      }, offset);
    };

    // 诊断：把视口底部那一带的元素结构全 dump 出来（弄清「定时发布」按钮到底怎么渲染的）
    const footerRegion = await ed.evaluate(() => {
      const H = window.innerHeight;
      const deepAll = (root, out = []) => {
        for (const el of root.querySelectorAll('*')) {
          out.push(el);
          if (el.shadowRoot) deepAll(el.shadowRoot, out);
        }
        return out;
      };
      return deepAll(document)
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top > H * 0.82;
        })
        .map((e) => {
          const r = e.getBoundingClientRect();
          return {
            tag: e.tagName.toLowerCase(),
            cls: String(e.className || '').slice(0, 46),
            text: (e.innerText || '').replace(/\s+/g, '').slice(0, 14),
            html: (e.outerHTML || '').slice(0, 90),
            rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          };
        })
        .slice(0, 30);
    });
    steps.push({ step: 'footer-region', vh: 900, items: footerRegion });

    // 诊断模式：用 elementFromPoint 扫底部条带，看按钮到底是什么元素（闭合 shadow root 用 querySelector 穿不透）
    if (process.env.XHS_DIAG) {
      const probe = await ed.evaluate(() => {
        const H = window.innerHeight, W = window.innerWidth;
        const out = [];
        for (let y = Math.round(H * 0.84); y < H; y += 5) {
          for (const xr of [0.30, 0.42, 0.515, 0.60, 0.72]) {
            const x = Math.round(W * xr);
            const el = document.elementFromPoint(x, y);
            if (!el) continue;
            const key = el.tagName + '|' + String(el.className || '').slice(0, 30) + '|' + (el.innerText || '').replace(/\s+/g, '').slice(0, 10);
            if (!out.find((o) => o.key === key)) {
              out.push({
                key, x, y,
                tag: el.tagName.toLowerCase(),
                cls: String(el.className || '').slice(0, 60),
                txt: (el.innerText || '').replace(/\s+/g, '').slice(0, 16),
                html: (el.outerHTML || '').slice(0, 200),
              });
            }
          }
        }
        return { W, H, items: out.slice(0, 40) };
      });
      const host = await ed.evaluate(() => {
        const deepAll = (root, out = []) => {
          for (const el of root.querySelectorAll('*')) {
            out.push(el);
            if (el.shadowRoot) deepAll(el.shadowRoot, out);
          }
          return out;
        };
        return deepAll(document)
          .filter((e) => (e.tagName || '').toLowerCase() === 'xhs-publish-btn')
          .map((e) => {
            const r = e.getBoundingClientRect();
            return {
              rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
              attrs: [...e.attributes].map((a) => `${a.name}=${a.value}`).join(' '),
              kids: e.children.length,
              openShadow: !!e.shadowRoot,
              html: (e.outerHTML || '').slice(0, 400),
            };
          });
      });
      log({ ok: true, diag: true, probe, host, steps });
      return;
    }

    let submitted = false;
    // 三个偏移都落在右侧按钮的宽度范围内（0.52~0.69），点不中就换一个，不会误点「暂存离开」
    const offsets = [0.60, 0.55, 0.66];
    for (let i = 0; i < offsets.length && !submitted; i++) {
      const pt = await findSubmitPoint(offsets[i]);
      if (!pt || pt.mode === 'none') {
        const frames = ed.frames().map((f) => f.url().slice(0, 100));
        steps.push({ step: 'submit-diag', frames, pt });
        throw new Error('找不到底部提交按钮（既没有 xhs-publish-btn，也没有底部文字按钮）');
      }
      steps.push({ step: 'submit-click', try: i + 1, ...pt });
      await ed.mouse.click(pt.x, pt.y);
      await sleep(ed, 5000);
      const t = await bodyText(ed);
      const url = ed.url();
      submitted = /发布成功|定时发布成功|已提交|审核中|发布完成/.test(t) || !/publish\/publish/.test(url);
      steps.push({ step: 'submit-result', try: i + 1, submitted, url });
    }
    await sleep(ed, 3000);

    // 没确认成功时，才去点可能的二次确认弹窗（成功后就别乱点了）
    if (!submitted) {
      const confirmHit = await clickText(ed, '确认发布') || await clickText(ed, '确定') || await clickText(ed, '确认');
      if (confirmHit) { steps.push({ step: 'confirm', hit: confirmHit }); await sleep(ed, 5000); }
      const t2 = await bodyText(ed);
      submitted = /发布成功|定时发布成功|已提交|审核中|发布完成/.test(t2);
    }

    const done = await dump(ed, `xhs-${num}-done`, 800);
    steps.push({ step: 'done', shot: done.shot, url: done.url, tail: done.tail });

    // 13. 去「笔记管理」核实一遍（页面上的 toast 会一闪而过，不能只靠它）
    let verified = false;
    try {
      await page.goto('https://creator.xiaohongshu.com/new/note-manager', { waitUntil: 'domcontentloaded' });
      await sleep(page, 7000);
      const mgr = await bodyText(page);
      // 别写死关号：之前这里硬编码「第8关」，导致发成功也判失败
      verified = new RegExp(`第\\s*${num}\\s*关`).test(mgr);
      const mshot = shotPath(`xhs-${num}-manager`);
      await page.screenshot({ path: mshot });
      steps.push({ step: 'verify-manager', verified, shot: mshot, head: mgr.replace(/\n{2,}/g, '\n').slice(0, 800) });
    } catch (e) {
      steps.push({ step: 'verify-manager', verified: false, err: String((e && e.message) || e).split('\n')[0] });
    }

    log({ ok: submitted && verified, submitted, verified, published: submitted ? 'scheduled' : 'unconfirmed', num, title: rawTitle, at: want, collOk, shot: done.shot, steps });
  } catch (e) {
    let shot = null;
    try { shot = shotPath(`xhs-${num}-error`); await page.screenshot({ path: shot }); } catch (_) {}
    log({ ok: false, num, error: String((e && e.message) || e).split('\n')[0], shot, steps });
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
