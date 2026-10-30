// 公众号全流程发布：草稿 → 加合集 → 定时发表 → 关群发通知 → 发表 → 微信验证
//
//   node pub_wx_publish.js 8                          干跑：走到定时设置，不点最后发表
//   node pub_wx_publish.js 8 --go                     立即发表
//   node pub_wx_publish.js 8 --go --at=12:00          定时到今天 12:00
//   node pub_wx_publish.js 8 --go --at=12:00 --tomorrow  定时到明天 12:00
//
//   合集默认「逻辑闯关」，可用 --collection=xxx 覆盖，--no-collection 跳过
//
// 环境变量：
//   WX_WAIT_SEC   微信验证等待秒数，默认 300
//   WX_HEADLESS   =1 时无头运行（默认有窗口，方便扫码）
const { launch, shotPath } = require('./pub_browser');

const num = Number(process.argv[2]);
const GO = process.argv.includes('--go');
const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : null;
};
const AT = argOf('at');                      // "HH:MM"
const TOMORROW = process.argv.includes('--tomorrow');
const NO_COLLECTION = process.argv.includes('--no-collection');
const COLLECTION = NO_COLLECTION ? null : (argOf('collection') || '逻辑闯关');
const PREFIX = `第${num}关｜`;
const WAIT_SEC = Number(process.env.WX_WAIT_SEC || 300);

const log = (o) => console.log(JSON.stringify(o));
const { sleep } = require('./pub_browser');   // 统一走速度开关 PUB_SPEED
const steps = [];

// —— 通用：按文字找元素中心点，用真实鼠标点（公众号很多控件不吃 element.click）——
async function pointOfText(page, text, opts = {}) {
  return page.evaluate(({ t, minTop, maxTop, minLeft }) => {
    const els = [...document.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      const txt = (e.innerText || '').trim();
      return r.width > 0 && r.height > 0 && txt === t &&
        r.top >= minTop && r.top <= maxTop && r.left >= minLeft;
    });
    if (!els.length) return null;
    els.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { t: text, minTop: opts.minTop ?? 0, maxTop: opts.maxTop ?? 100000, minLeft: opts.minLeft ?? 0 });
}
async function clickText(page, text, opts = {}) {
  const pt = await pointOfText(page, text, opts);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
}

// 在可见 dialog（用特征文字识别）内部按文字点
// 注意：页面里同时存在隐藏的 dialog 模板，必须过滤可见性，否则会点到 0×0 的幽灵元素
async function clickInDialog(page, marker, text) {
  const dlg = page.locator('.weui-desktop-dialog:visible').filter({ hasText: marker }).first();
  if (!(await dlg.count())) return false;
  const pt = await dlg.evaluate((d, t) => {
    const els = [...d.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (e.innerText || '').trim() === t;
    });
    if (!els.length) return null;
    els.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, text);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
}

// 取当前可见的发表弹窗（含「群发通知」的那个）
async function visiblePublishDialog(ed) {
  return ed.locator('.weui-desktop-dialog:visible').filter({ hasText: '群发通知' }).first();
}

// —— 1. 进草稿编辑页 ——
async function openDraft(page, ctx) {
  await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
  await sleep(page, 3000);
  const token = (page.url().match(/token=(\d+)/) || [])[1];
  if (!token) throw new Error('登录态失效，需要重新扫码登录公众号');

  await page.goto(
    `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=list&type=77&token=${token}&lang=zh_CN`,
    { waitUntil: 'domcontentloaded' }
  );
  await sleep(page, 5000);
  steps.push({ step: 'draftbox', ok: true });

  const card = await page.evaluate((pre) => {
    const els = [...document.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && e.children.length === 0 &&
        (e.innerText || '').trim().startsWith(pre);
    });
    if (!els.length) return null;
    // 取视觉上最靠上的那个（列表按更新时间排序，第一张就是最新编辑的）
    els.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const el = els[0];
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      titleTop: r.top,
      title: el.innerText.trim().slice(0, 40),
      n: els.length,
    };
  }, PREFIX);
  if (!card) throw new Error(`草稿箱里找不到以「${PREFIX}」开头的草稿`);
  steps.push({ step: 'find-draft', title: card.title, sameTitleDrafts: card.n, titleTop: Math.round(card.titleTop) });
  if (card.n > 1) {
    steps.push({
      step: 'warn-duplicate-drafts',
      count: card.n,
      note: `草稿箱里有 ${card.n} 份同一关的草稿，本次只操作最上面那份，其余需人工清理`,
    });
  }

  const tabsBefore = ctx.pages().length;
  // 悬停标题本身触发卡片 hover（按钮出现在标题上方）
  await page.mouse.move(card.x, card.y);
  await sleep(page, 1500);

  // 「发表」按钮在标题上方，限定纵向范围，避免点到页面别处的发表
  const btn = await page.evaluate((top) => {
    const els = [...document.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 &&
        (e.innerText || '').trim() === '发表' &&
        r.top > top - 180 && r.top < top - 20;
    });
    if (!els.length) return null;
    els.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, n: els.length };
  }, card.titleTop);
  steps.push({ step: 'card-publish-btn', ...(btn || {}) });
  if (!btn) throw new Error('卡片上没有「发表」');
  await page.mouse.click(btn.x, btn.y);
  await sleep(page, 6000);

  // 可能新开标签页，也可能当前页跳转
  const pages = ctx.pages();
  const ed = pages.length > tabsBefore ? pages[pages.length - 1] : page;
  await ed.waitForLoadState('domcontentloaded').catch(() => {});
  await sleep(ed, 3000);
  steps.push({ step: 'editor', url: ed.url().slice(0, 110), newTab: pages.length > tabsBefore });
  if (!/appmsg_edit/.test(ed.url())) throw new Error('没进入编辑页，当前地址：' + ed.url().slice(0, 120));
  return { ed, token, sameTitleDrafts: card.n };
}

// —— 2. 关闭可能自动弹出的发表弹窗 ——
// 公众号编辑页会随机弹新功能引导（如「支持添加话题卡片」），不关掉会遮住底部按钮
async function dismissGuide(ed) {
  const TEXTS = ['我知道了', '知道了', '开始使用'];
  for (let i = 0; i < 3; i++) {
    const pt = await ed.evaluate((texts) => {
      for (const t of texts) {
        const els = [...document.querySelectorAll('*')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (e.innerText || '').trim() === t;
        });
        if (els.length) {
          els.sort((a, b) => {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return ra.width * ra.height - rb.width * rb.height;
          });
          const r = els[0].getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, t };
        }
      }
      return null;
    }, TEXTS);
    if (!pt) return i;
    await ed.mouse.click(pt.x, pt.y);
    await sleep(ed, 1500);
    steps.push({ step: 'dismiss-guide', text: pt.t, round: i + 1 });
  }
  return 3;
}

async function dismissPublishDialog(ed) {
  const has = await ed.evaluate(() => {
    const d = [...document.querySelectorAll('.weui-desktop-dialog')].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && /群发通知/.test(e.innerText || '');
    });
    return !!d;
  });
  if (!has) return false;
  const ok = await clickInDialog(ed, '群发通知', '取消');
  await sleep(ed, 2000);
  return ok;
}

// —— 3. 加合集 ——
async function addCollection(ed, name) {
  // 滚到合集行
  await ed.evaluate(() => {
    const row = [...document.querySelectorAll('.setting-group__checkbox-item')]
      .find((r) => (r.innerText || '').trim().startsWith('合集'));
    if (row) row.scrollIntoView({ block: 'center' });
  });
  await sleep(ed, 1200);

  // 已经是目标合集就直接返回，避免重复操作
  const cur = await ed.evaluate(() => {
    const row = [...document.querySelectorAll('.setting-group__checkbox-item')]
      .find((r) => (r.innerText || '').trim().startsWith('合集'));
    return row ? row.innerText.replace(/\s+/g, ' ').trim() : null;
  });
  if (cur && cur.includes(name) && !/未添加/.test(cur)) {
    steps.push({ step: 'collection-skip', rowText: cur, note: '已经是该合集' });
    return cur;
  }

  // 点合集行的「未添加」
  const na = await ed.evaluate(() => {
    const row = [...document.querySelectorAll('.setting-group__checkbox-item')]
      .find((r) => (r.innerText || '').trim().startsWith('合集'));
    if (!row) return null;
    const op = row.querySelector('.js_article_tags_label, .allow_click_opr');
    if (!op) return null;
    const r = op.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, txt: (op.innerText || '').trim() };
  });
  if (!na) throw new Error('找不到合集行的入口');
  await ed.mouse.click(na.x, na.y);
  await sleep(ed, 3500);

  const dlg = ed.locator('.weui-desktop-dialog:visible').filter({ hasText: '每篇文章最多添加1个合集' }).first();
  if (!(await dlg.count())) throw new Error('合集弹窗没打开');
  steps.push({ step: 'collection-dialog', ok: true });

  // 展开下拉
  const input = dlg.locator('input.weui-desktop-form__input').first();
  await input.click();
  await sleep(ed, 2500);

  const opts = await dlg.evaluate((d) => {
    const c = d.querySelector('.select-opts-con');
    if (!c) return [];
    return [...c.querySelectorAll('.select-opt-li')].map((e) => (e.innerText || '').trim());
  });
  steps.push({ step: 'collection-options', opts });

  const target = opts.find((o) => o === name) || opts.find((o) => o.includes(name));
  if (!target) throw new Error(`合集下拉里没有「${name}」，现有：${opts.join(' / ') || '空'}`);

  const pickPt = await dlg.evaluate((d, t) => {
    const li = [...d.querySelectorAll('.select-opt-li')].find((e) => (e.innerText || '').trim() === t);
    if (!li) return null;
    const r = li.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, target);
  await ed.mouse.click(pickPt.x, pickPt.y);
  await sleep(ed, 1500);

  // 确认
  const confirmed = await clickInDialog(ed, '每篇文章最多添加1个合集', '确认');
  await sleep(ed, 2500);
  if (!confirmed) throw new Error('合集弹窗里找不到「确认」');

  // 硬校验
  const rowText = await ed.evaluate(() => {
    const row = [...document.querySelectorAll('.setting-group__checkbox-item')]
      .find((r) => (r.innerText || '').trim().startsWith('合集'));
    return row ? row.innerText.replace(/\s+/g, ' ').trim() : null;
  });
  steps.push({ step: 'collection-verify', rowText });
  if (!rowText || /未添加/.test(rowText)) throw new Error('合集未生效，仍是「未添加」');
  return rowText;
}

// —— 4. 打开发表弹窗、关群发通知 ——
async function openPublishDialog(ed) {
  let clicked = await clickText(ed, '发表', { minTop: 300 });
  if (!clicked) {
    // 可能又被引导弹窗挡住了，先清一遍再试
    await dismissGuide(ed);
    await sleep(ed, 1200);
    clicked = await clickText(ed, '发表', { minTop: 300 });
  }
  if (!clicked) throw new Error('编辑器底部找不到「发表」');
  await sleep(ed, 2000);

  let ready = false;
  for (let i = 0; i < 15; i++) {
    ready = await ed.evaluate(() => {
      const d = [...document.querySelectorAll('.weui-desktop-dialog')].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && /群发通知/.test(e.innerText || '');
      });
      return !!d;
    });
    if (ready) break;
    await sleep(ed, 1000);
  }
  if (!ready) throw new Error('发表弹窗没出现');
  steps.push({ step: 'publish-dialog', ok: true });
}

// 群发通知状态：靠「今天还有 N 次通知次数」这行是否可见判断，比 class / 背景色都可靠
// 群发通知状态：看「分组通知」这一行在不在
// 实测：关闭群发通知后，「今天还有N次通知次数」仍然显示，但「分组通知」整行会消失
async function groupNotifyState(ed) {
  const sw = await switchOfRow(ed, '群发通知');
  if (!sw) return null;
  const groupRows = await ed.evaluate(() => {
    return [...document.querySelectorAll('*')].filter((e) => {
      const t = (e.innerText || '').trim();
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && t.startsWith('分组通知') && t.length < 20;
    }).length;
  });
  return { on: groupRows > 0, groupRows, x: sw.x, y: sw.y };
}

// —— 5. 定时发表 ——
// 直接在页面里找第一个「可见」的匹配元素中心点
// 教训：页面里有多个 .weui-desktop-dialog（含隐藏模板和小的确认框），套 dialog 会取错
async function visiblePoint(ed, selector) {
  return ed.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!els.length) return null;
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, n: els.length };
  }, selector);
}

// 按行标题文字找它内部的开关（「群发通知」「定时发表」这类设置行）
// 比 class 选择器稳：页面里有隐藏模板，class 会命中 0×0 的幽灵元素
async function switchOfRow(ed, label) {
  return ed.evaluate((lab) => {
    const rows = [...document.querySelectorAll('*')].filter((e) => {
      const t = (e.innerText || '').trim();
      const r = e.getBoundingClientRect();
      return r.width > 150 && r.height > 20 && r.height < 150 && t.startsWith(lab);
    });
    if (!rows.length) return null;
    rows.sort((a, b) => a.innerText.length - b.innerText.length);
    const row = rows[0];
    const sw = row.querySelector('*[class*=switch], *[class*=Switch]');
    if (!sw) return null;
    const r = sw.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rowTxt: (row.innerText || '').trim().slice(0, 20) };
  }, label);
}

async function setTimer(ed, at, tomorrow) {
  const sw = await switchOfRow(ed, '定时发表');
  if (!sw) throw new Error('找不到「定时发表」开关');
  steps.push({ step: 'timer-switch', ...sw });
  await ed.mouse.click(sw.x, sw.y);
  await sleep(ed, 2000);

  // 等时间控件出现（开关打开后才渲染）
  let appeared = false;
  for (let i = 0; i < 10; i++) {
    appeared = await ed.evaluate(() => {
      const els = [...document.querySelectorAll('.mass-send__timer-container')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return els.length > 0;
    });
    if (appeared) break;
    await sleep(ed, 1000);
  }
  steps.push({ step: 'timer-on', appeared });
  if (!appeared) throw new Error('定时发表开关点了，但时间控件没出现');

  // 日期
  if (tomorrow) {
    const dd = await visiblePoint(ed, '.mass-send__timer .weui-desktop-form__dropdown__dt');
    if (!dd) throw new Error('找不到定时日期下拉');
    await ed.mouse.click(dd.x, dd.y);
    await sleep(ed, 1500);
    const okTomorrow = await ed.evaluate(() => {
      const li = [...document.querySelectorAll('.weui-desktop-dropdown__list-ele__text')]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .find((e) => (e.innerText || '').trim() === '明天');
      if (!li) return null;
      const r = li.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (!okTomorrow) throw new Error('日期下拉里没有「明天」');
    await ed.mouse.click(okTomorrow.x, okTomorrow.y);
    steps.push({ step: 'timer-day', ok: true });
    await sleep(ed, 1500);
  }

  // 时间
  const input = ed.locator('.mass-send__timer-container input[placeholder="请选择时间"]:visible').first();
  const cnt = await input.count();
  steps.push({ step: 'timer-input', count: cnt });
  if (!cnt) throw new Error('找不到时间输入框');

  const box = await input.boundingBox();
  if (box) await ed.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(ed, 800);
  await input.fill('');
  await sleep(ed, 300);
  await input.type(at, { delay: 120 });
  await sleep(ed, 600);
  await ed.keyboard.press('Tab');
  await sleep(ed, 1500);

  const got = (await input.inputValue().catch(() => '')) || '';
  steps.push({ step: 'timer-set', at, tomorrow, got });
  if (got.replace(/\s/g, '') !== at) throw new Error(`定时时间没填进去，期望 ${at}，实际「${got}」`);

  await sleep(ed, 1000);
  return got;
}

// —— 主流程 ——
(async () => {
  const { ctx, page } = await launch({ headless: process.env.WX_HEADLESS === '1' });
  let ed = page;
  let dupDrafts = 0;
  try {
    const opened = await openDraft(page, ctx);
    ed = opened.ed;
    dupDrafts = opened.sameTitleDrafts || 0;

    await dismissGuide(ed);
    const dismissed = await dismissPublishDialog(ed);
    steps.push({ step: 'dismiss-auto-dialog', dismissed });

    if (COLLECTION) {
      const rowText = await addCollection(ed, COLLECTION);
      steps.push({ step: 'collection', ok: true, rowText });
    }

    await openPublishDialog(ed);

    // 关群发通知
    const st = await groupNotifyState(ed);
    steps.push({ step: 'group-state', ...(st || {}) });
    if (!st) throw new Error('找不到「群发通知」开关');
    if (st.on) {
      await ed.mouse.click(st.x, st.y);
      await sleep(ed, 1800);
      const st2 = await groupNotifyState(ed);
      steps.push({ step: 'group-off', on: st2 && st2.on });
      if (st2 && st2.on) throw new Error('群发通知仍是开启状态，已中止，不发表');
    }

    if (AT) {
      await setTimer(ed, AT, TOMORROW);
    }

    const shotBefore = shotPath(`pub-${num}-ready`);
    await ed.screenshot({ path: shotBefore });
    steps.push({ step: 'ready', shot: shotBefore, collection: COLLECTION, at: AT || null });

    if (!GO) {
      log({ ok: true, dryRun: true, num, duplicateDrafts: dupDrafts, steps });
      return;
    }

    // 点弹窗里的「发表」
    const done = await clickInDialog(ed, '群发通知', '发表');
    steps.push({ step: 'modal-publish', ok: done });
    if (!done) throw new Error('弹窗里找不到「发表」');
    await sleep(ed, 4000);

    // 二次确认「继续发表」
    let confirmed = false;
    for (let i = 0; i < 10; i++) {
      const has = await ed.evaluate(() => /继续发表/.test(document.body.innerText));
      if (has) {
        confirmed = await clickText(ed, '继续发表');
        if (confirmed) { await sleep(ed, 5000); break; }
      }
      await sleep(ed, 1500);
    }
    steps.push({ step: 'confirm2', confirmed });

    // 微信验证
    let needScan = false;
    for (let i = 0; i < 4; i++) {
      needScan = await ed.evaluate(() => /微信验证|扫码后/.test(document.body.innerText));
      if (needScan) break;
      await sleep(ed, 1500);
    }
    if (needScan) {
      const qrShot = shotPath(`pub-${num}-qrcode`);
      await ed.screenshot({ path: qrShot });
      log({ ok: false, num, reason: 'need-scan', shot: qrShot, steps, msg: '请在浏览器窗口扫码，脚本等待中' });

      const deadline = Date.now() + WAIT_SEC * 1000;
      let cleared = false;
      while (Date.now() < deadline) {
        await sleep(ed, 3000);
        const still = await ed.evaluate(() => /微信验证|扫码后/.test(document.body.innerText));
        if (!still) { cleared = true; break; }
      }
      steps.push({ step: 'scan', cleared, waitedSec: WAIT_SEC });
      if (!cleared) {
        log({ ok: false, num, reason: 'scan-timeout', steps });
        return;
      }
      await sleep(ed, 5000);
      for (let i = 0; i < 6; i++) {
        const has = await ed.evaluate(() => /继续发表/.test(document.body.innerText));
        if (!has) break;
        await clickText(ed, '继续发表');
        await sleep(ed, 6000);
      }
    }

    const shotDone = shotPath(`pub-${num}-result`);
    await ed.screenshot({ path: shotDone });
    const finalText = await ed.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, ' | '));
    steps.push({ step: 'result', shot: shotDone, text: finalText });
    log({ ok: true, num, go: true, at: AT || 'now', collection: COLLECTION, duplicateDrafts: dupDrafts, shot: shotDone, steps });
  } catch (e) {
    let shot = null;
    try { shot = shotPath(`pub-${num}-error`); await ed.screenshot({ path: shot }); } catch (_) {}
    log({ ok: false, num, error: String((e && e.message) || e), duplicateDrafts: dupDrafts, shot, steps });
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
})();
