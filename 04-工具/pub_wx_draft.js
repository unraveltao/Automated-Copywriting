// 公众号建草稿：传封面到素材库 → 新建图文 → 标题 → 正文 → 从图片库选封面 → 保存为草稿
//
//   node pub_wx_draft.js 9            真建草稿
//   node pub_wx_draft.js 9 --dry      只填不保存
//   node pub_wx_draft.js 9 --no-cover 跳过封面（会得到「内容不完整，无法发表」的草稿）
//
// 为什么需要这个：pub_wx_publish.js 的前提是「草稿箱里已有这一关的草稿」，
// 而建草稿这一步以前是人工粘的——这是四平台串联里唯一的人工断点。
//
// 踩过的坑（2026-10-31 探明）：
//   1. 封面菜单只有「从正文选择 / 从图片库选择 / 微信扫码上传」，**没有本地文件入口**，
//      直接 setInputFiles 喂编辑页那个 input 是无效的（它属于正文插图工具栏）。
//      所以必须先把图传到素材库（/cgi-bin/filepage?type=2 有真正的上传 input），再从图片库选。
//   2. 上传封面必须放在「填内容之前」：中途跳去素材库再回来，编辑器里的标题正文会丢。
//   3. 没有封面的草稿在草稿箱里是「内容不完整，无法发表」，发不出去。
//   4. 编辑器有两个 .ProseMirror：第 1 个是标题（高约 30px），第 2 个是正文。
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { launch, shotPath, sleep, ROOT } = require('./pub_browser');

const num = Number(process.argv[2]);
const DRY = process.argv.includes('--dry');
const NO_COVER = process.argv.includes('--no-cover');

const log = (o) => console.log(JSON.stringify(o));
const steps = [];
const PY = process.env.PUB_PYTHON || 'python';

if (!Number.isFinite(num) || num <= 0) {
  log({ ok: false, error: '用法：node pub_wx_draft.js <关号> [--dry] [--no-cover]' });
  process.exit(1);
}

function packDir() {
  const base = path.join(ROOT, '06-存档', '逻辑闯关', '发布包');
  for (const c of [`第${String(num).padStart(3, '0')}关`, `第${num}关`]) {
    const p = path.join(base, c);
    if (fs.existsSync(path.join(p, 'meta.json'))) return p;
  }
  return path.join(base, `第${String(num).padStart(3, '0')}关`);
}

function ensurePack() {
  const dir = packDir();
  if (fs.existsSync(path.join(dir, 'meta.json'))) return dir;
  steps.push({ step: 'pack', action: 'generate' });
  execFileSync(PY, ['pub_pack.py', String(num), '--no-xhs'], {
    cwd: __dirname, stdio: 'pipe', encoding: 'utf-8',
  });
  if (!fs.existsSync(path.join(dir, 'meta.json'))) throw new Error('备料失败');
  return dir;
}

// 点一个元素中心（按文字精确匹配，取面积最小的那个，避免点到外层容器）
async function clickExact(page, text, scope) {
  const pt = await page.evaluate(({ t, sel }) => {
    const root = sel ? document.querySelector(sel) : document;
    if (!root) return null;
    const vis = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const els = [...root.querySelectorAll('button,a,[role="button"],span,div')]
      .filter((e) => vis(e) && (e.innerText || '').trim() === t)
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      });
    if (!els.length) return null;
    const r = els[0].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, { t: text, sel: scope || null });
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
}

(async () => {
  let ctx;
  try {
    const dir = ensurePack();
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8'));
    const wx = meta['公众号'] || {};
    const title = wx['标题'] || meta['标题'];
    const htmlPath = wx['html'] || path.join(dir, '公众号.html');
    const cover = wx['封面'];
    if (!title) throw new Error('meta.json 里没有公众号标题');
    if (!fs.existsSync(htmlPath)) throw new Error(`正文 HTML 不存在：${htmlPath}`);
    const bodyHtml = fs.readFileSync(htmlPath, 'utf-8');
    steps.push({ step: 'material', title, bytes: bodyHtml.length, cover: cover || '' });

    const l = await launch({ headless: false, profile: 'wx' });
    ctx = l.ctx;
    const page = l.page;

    await page.goto('https://mp.weixin.qq.com/', { waitUntil: 'domcontentloaded' });
    await sleep(page, 2500);
    const token = (page.url().match(/token=(\d+)/) || [])[1];
    if (!token) throw new Error('公众号登录态失效，需要先跑 node pub_wx_login.js 扫码');

    // —— 1. 先把封面传进素材库（必须在填内容之前，否则回编辑器时内容会丢）——
    let coverInLib = false;
    if (!NO_COVER && cover && fs.existsSync(cover)) {
      try {
        await page.goto(
          `https://mp.weixin.qq.com/cgi-bin/filepage?type=2&begin=0&count=12&token=${token}&lang=zh_CN`,
          { waitUntil: 'domcontentloaded' }
        );
        await sleep(page, 4000);
        const fi = page.locator('input[type="file"]').first();
        if (await fi.count()) {
          await fi.setInputFiles(cover);
          await sleep(page, 7000);
          coverInLib = true;
        }
        steps.push({ step: 'cover-upload', ok: coverInLib });
      } catch (e) {
        steps.push({ step: 'cover-upload', ok: false, note: String(e.message).split('\n')[0] });
      }
    }

    // —— 2. 新建图文 ——
    await page.goto(
      `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`,
      { waitUntil: 'domcontentloaded' }
    );
    await page.waitForSelector('.ProseMirror', { timeout: 30000 });
    await sleep(page, 3000);
    steps.push({ step: 'editor', ok: true });

    for (let i = 0; i < 3; i++) {
      const hit = await clickExact(page, '我知道了');
      if (!hit) break;
      await sleep(page, 1200);
      steps.push({ step: 'dismiss-guide' });
    }

    // —— 3. 标题 ——
    const editors = page.locator('.ProseMirror');
    if ((await editors.count()) < 2) throw new Error('编辑器数量不对，期望 2 个 ProseMirror');
    await editors.nth(0).click();
    await sleep(page, 500);
    await page.keyboard.type(title, { delay: 12 });
    await sleep(page, 800);
    const gotTitle = (await editors.nth(0).innerText()).trim();
    steps.push({ step: 'title', ok: gotTitle.includes(title.slice(0, 6)), got: gotTitle.slice(0, 40) });
    if (!gotTitle) throw new Error('标题没填进去');

    // —— 4. 正文（insertHTML 保留内联样式）——
    await editors.nth(1).click();
    await sleep(page, 600);
    await page.evaluate((html) => document.execCommand('insertHTML', false, html), bodyHtml);
    await sleep(page, 2000);
    const bodyLen = (await editors.nth(1).innerText()).replace(/\s/g, '').length;
    steps.push({ step: 'body', chars: bodyLen });
    if (bodyLen < 200) throw new Error(`正文没贴进去，只有 ${bodyLen} 字`);

    // —— 5. 封面：从图片库选 ——
    let coverOk = false;
    if (coverInLib) {
      await page.locator('.select-cover__btn').first().click();
      await sleep(page, 3500);
      // 菜单项用坐标点：用 locator 点会因为浮层重渲染而超时。
      // 类名 js_imagedialog 有时不出现，所以按文字兜底。
      const menu = await page.evaluate(() => {
        const vis = (e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const byClass = document.querySelector('a.js_imagedialog');
        if (byClass && vis(byClass)) {
          const r = byClass.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, via: 'class' };
        }
        const byText = [...document.querySelectorAll('a,li,span,div')]
          .filter((e) => vis(e) && (e.innerText || '').trim() === '从图片库选择')
          .sort((a, b) => {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            return ra.width * ra.height - rb.width * rb.height;
          })[0];
        if (!byText) return null;
        const r = byText.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, via: 'text' };
      });
      if (menu) {
        await page.mouse.click(menu.x, menu.y);
        await sleep(page, 4500);
        // 「选择图片」弹窗里的缩略图不是 <img>，是带背景图的 li/div，
        // 所以按尺寸找方块（40~300px），点第一个；之后按钮是「下一步」，不是「确定」
        const pick = await page.evaluate(() => {
          const dlg = [...document.querySelectorAll('.weui-desktop-dialog')].find((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && /选择图片/.test(e.innerText || '');
          });
          if (!dlg) return null;
          const tiles = [...dlg.querySelectorAll('*')]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              if (!(r.width > 60 && r.height > 60 && r.width < 320)) return false;
              const bg = getComputedStyle(e).backgroundImage || '';
              return bg.includes('url(');   // 缩略图是背景图，不是 <img>
            })
            .sort((a, b) => {
              const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
              return (ra.top - rb.top) || (ra.left - rb.left);   // 取左上角第一张
            });
          if (!tiles.length) return null;
          const r = tiles[0].getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, n: tiles.length, tag: tiles[0].tagName.toLowerCase() };
        });
        if (pick) {
          await page.mouse.click(pick.x, pick.y);
          await sleep(page, 2000);
        }
        // 依次尝试「下一步」→「确认」（选图后进入裁剪弹窗，按钮叫「确认」，不是「确定」）
        const confirms = [];
        for (const label of ['下一步', '确认', '确定', '完成']) {
          const pt = await page.evaluate((t) => {
            const dlgs = [...document.querySelectorAll('.weui-desktop-dialog')].filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            });
            for (const d of dlgs) {
              const b = [...d.querySelectorAll('button,a,[role="button"],span')]
                .filter((e) => (e.innerText || '').trim() === t)
                .sort((a, b2) => {
                  const ra = a.getBoundingClientRect(), rb = b2.getBoundingClientRect();
                  return ra.width * ra.height - rb.width * rb.height;
                })[0];
              if (b) {
                const r = b.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
              }
            }
            return null;
          }, label);
          if (pt) {
            await page.mouse.click(pt.x, pt.y);
            await sleep(page, 3000);
            confirms.push(label);
          }
        }
        coverOk = confirms.length > 0;
        steps.push({ step: 'cover-pick', picked: !!pick, confirms, ok: coverOk });
      } else {
        steps.push({ step: 'cover-pick', ok: false, note: '菜单里没有「从图片库选择」' });
      }
    }

    const filledShot = shotPath(`wx-draft-${num}-filled`);
    await page.screenshot({ path: filledShot });
    steps.push({ step: 'filled', shot: filledShot, coverOk });

    if (DRY) {
      log({ ok: true, dryRun: true, num, title, coverOk, steps });
      return;
    }

    // —— 6. 保存为草稿 ——
    const save = page.locator('button', { hasText: '保存为草稿' }).first();
    if (!(await save.count())) throw new Error('找不到「保存为草稿」按钮');
    await save.click();
    await sleep(page, 5000);
    steps.push({ step: 'save' });

    // —— 7. 核实草稿箱 ——
    await page.goto(
      `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=list&type=77&token=${token}&lang=zh_CN`,
      { waitUntil: 'domcontentloaded' }
    );
    await sleep(page, 5000);
    const prefix = `第${num}关｜`;
    const found = await page.evaluate((pre) => {
      const els = [...document.querySelectorAll('*')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && e.children.length === 0 &&
          (e.innerText || '').trim().startsWith(pre);
      });
      return els.length;
    }, prefix);
    const shot = shotPath(`wx-draft-${num}-drafts`);
    await page.screenshot({ path: shot });
    steps.push({ step: 'verify', drafts: found, shot });

    log({ ok: found > 0, num, title, coverOk, drafts: found, shot, steps });
    if (!found) process.exitCode = 1;
  } catch (e) {
    log({ ok: false, num, error: String((e && e.message) || e).split('\n')[0], steps });
    process.exitCode = 1;
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
})();
