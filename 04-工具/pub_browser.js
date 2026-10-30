// 多平台发布：浏览器底座
// 用系统 Chrome + 持久档案，登录一次长期有效。
// 每个平台一个独立档案目录，登录态互不干扰：
//   launch()                     → 06-存档/_浏览器档案/wx       （公众号，默认，兼容旧脚本）
//   launch({ profile: 'zhihu' }) → 06-存档/_浏览器档案/zhihu
//
// 速度：所有固定等待都走本文件的 sleep()，由环境变量 PUB_SPEED 统一缩放。
//   PUB_SPEED=1   保守（默认，和以前完全一样）
//   PUB_SPEED=0.6 快一点，本机网络好时用
//   PUB_SPEED=2   更慢，网络抖动 / 平台卡顿时用
const path = require('path');
const fs = require('fs');
const os = require('os');

// —— playwright-core 定位：不写死用户名，按「环境变量 → 项目内 → WorkBuddy 内置」找 ——
function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    path.join(__dirname, 'node_modules', 'playwright-core'),
    path.join(os.homedir(), '.workbuddy-ai', 'binaries', 'node', 'versions',
      '22.22.2-6', 'node_modules', '@playwright', 'cli', 'node_modules', 'playwright-core'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'playwright-core'),
  ].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* 试下一个 */ }
  }
  throw new Error(
    '找不到 playwright-core。二选一：\n' +
    '  1) 在 04-工具/ 下执行 npm i playwright-core\n' +
    '  2) 设环境变量 PLAYWRIGHT_CORE 指向 playwright-core 目录'
  );
}

const { chromium } = resolvePlaywright();

const ROOT = path.resolve(__dirname, '..');
const ARCHIVE = path.join(ROOT, '06-存档', '_浏览器档案');
const PROFILE = path.join(ARCHIVE, 'wx');

// 全局速度系数：1 = 原样；小于 1 更快，大于 1 更稳
const SPEED = (() => {
  const v = Number(process.env.PUB_SPEED);
  return Number.isFinite(v) && v > 0 ? v : 1;
})();

// 统一的等待入口：所有脚本都改用它，速度只在这一处调
async function sleep(page, ms) {
  await page.waitForTimeout(Math.round(ms * SPEED));
}

// 条件等待：轮询直到 fn 返回真值或超时，返回命中的值 / null
// 用它替掉「先盲等 8 秒再检查」——快的时候 1 秒就过，慢的时候也不会误判
async function waitFor(page, fn, opts = {}) {
  const { timeout = 15000, interval = 300, arg } = opts;
  const deadline = Date.now() + timeout * SPEED;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await page.evaluate(fn, arg);
      if (last) return last;
    } catch (e) { /* 页面正在跳转，下一轮再试 */ }
    await page.waitForTimeout(interval);
  }
  return null;
}

// 等某个文字出现（返回命中元素的位置，找不到返回 null）
async function waitForText(page, text, opts = {}) {
  const { timeout = 20000 } = opts;
  return waitFor(page, (t) => {
    const els = [...document.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (e.innerText || '').trim() === t;
    });
    return els.length ? true : null;
  }, { timeout, arg: text });
}

function profilePath(name) {
  const dir = path.join(ARCHIVE, name || 'wx');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureProfile() {
  return profilePath('wx');
}

// headless=false 时窗口可见，方便你扫码 / 观察
async function launch(opts = {}) {
  const dir = profilePath(opts.profile || 'wx');
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chrome',
    headless: opts.headless === true,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { ctx, page, profile: dir };
}

const SHOT_DIR = path.join(ROOT, '06-存档', '_运行截图');
function shotPath(tag) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(SHOT_DIR, `${tag}-${ts}.png`);
}

module.exports = {
  launch, shotPath, profilePath, ensureProfile, ROOT, PROFILE, ARCHIVE,
  sleep, waitFor, waitForText, SPEED,
};
