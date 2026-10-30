# AutoCopy — Automated Copywriting & Multi-Platform Publishing

An end-to-end pipeline that turns a folder of Markdown drafts into published posts on **four Chinese platforms** — Toutiao, WeChat Official Accounts, Zhihu and Xiaohongshu — with cover generation, HTML conversion, duplicate detection, a resumable publish queue, and an HTML report for every run.

This is not a generic framework. It is the working codebase of a real daily publishing operation (a 100-part puzzle series), kept honest: every selector, every workaround and every platform quirk in here was paid for with a failed run.

> **The four platforms have no usable publishing API for individual creators.** Everything below is browser automation. That is the core constraint that shapes the whole design.

---

## Why it looks like this

| Platform | Official API | What we actually do | Hard limit |
|---|---|---|---|
| Toutiao | none | Playwright automation | **Adding to a collection and scheduling are mutually exclusive.** Pick one. |
| WeChat Official Accounts | `draft/add` returns 48001 for unverified personal accounts | Playwright, clicks **Publish** (not *Mass Send*) | A draft must exist before publishing |
| Zhihu | none | Playwright automation | — |
| Xiaohongshu | none | Playwright + the platform's own **AI layout** | No API at all; strictest anti-bot |

Because none of them can be trusted to stay still, the codebase optimises for **failing loudly and early**, not for cleverness:

- One article per day. No batching, no catch-up runs.
- **Fail → stop.** Never retry a publish. A retry can mean a duplicate post or a rate-limit flag.
- Every platform has a hard time budget. Stuck runs are killed, browser included.

## Repository layout

```
01-content/     Source drafts (Markdown) — Chinese, 100 parts
02-visual/      Covers and card images (WeChat 1280x792, Xiaohongshu 1080x1440)
03-specs/       Publishing rules and typography specs
04-tools/       All automation (Python + Node/Playwright)
05-skills/      Prompt packs for writing and rewriting
06-archive/     Ledger, publish packages, run screenshots, reports, browser profiles (gitignored)
07-manual/      CLI cheatsheet
AGENTS.md       Execution contract — read this before changing any code
```

> Directory names in the working copy are still Chinese (`01-内容`, `02-视觉`, …). They are kept as-is so existing scripts and the ledger keep working; `AGENTS.md` maps them.

## Quick start

```bash
# 1. Dependencies
cd 04-tools && npm i playwright-core     # or point PLAYWRIGHT_CORE at an existing install

# 2. Log in once per platform (a window opens, scan the QR code)
node pub_tt_login.js     # Toutiao
node pub_wx_login.js     # WeChat
node pub_zh_login.js     # Zhihu
node pub_xhs_login.js    # Xiaohongshu

# 3. Check → dry run → publish
python pub_daily.py --check
python pub_daily.py --dry
python pub_daily.py
```

Login state lives in `06-archive/_browser-profiles/<platform>/`. **That directory contains cookies and is gitignored.** Never commit it.

## The publish queue

A single queue that only moves forward. "Today we publish part N" means *all four platforms publish part N* — whichever ones are missing get filled in.

| Situation | Behaviour |
|---|---|
| Part N missing everywhere | Publish to all four, in order |
| Part N partially published | Only publish the missing platforms |
| One platform fails | Stop for the day. Successful platforms are already recorded; tomorrow resumes at the same part |
| Part number below the start marker | Never touched by automation — it is a human backfill item |

Order is fixed: **Toutiao → WeChat → Zhihu → Xiaohongshu.** Most stable first, strictest anti-bot last.

Because the queue advances by part number, re-running is naturally idempotent — it fills gaps, never duplicates.

## Tuning speed and time limits

All waits funnel through `04-tools/pub_browser.js`, so behaviour is controlled by two environment variables:

```bash
PUB_SPEED=1      # default. 0.6 = faster, 2 = more tolerant of a slow network
PUB_TIMEOUT=480  # per-platform hard limit in seconds (default 8 minutes)
```

`PUB_TIMEOUT` is enforced twice, on purpose:

1. **Inside** each Node script — `sleep()` and `waitFor()` check a deadline and throw `PUB_TIMEOUT` with the step name where it got stuck.
2. **Outside** in `pub_daily.py` — if the script still doesn't exit, the whole process tree is killed (`taskkill /T`), Chrome included. Orphaned Chrome is what locks the browser profile and blocks the next platform.

## Run reports

Every run writes a self-contained HTML report:

```
06-archive/_reports/2026-10-31_013619_第9关.html   # this run
06-archive/_reports/index.html                     # history, newest first
06-archive/_reports/last.json                      # raw data of the last run
```

Open the file directly in a browser — no server needed. Each report shows per-platform status, elapsed time, the exact error, the last automation step, and thumbnails of the screenshots.

Regenerate or open the latest one:

```bash
python pub_report.py --open
```

## Known limitations

- **Toutiao**: collection membership and scheduling are mutually exclusive. Collections win — a series without a collection entry has no navigation.
- **WeChat**: the cover picker has no local-file option — images must go through the media library first. `pub_wx_draft.js` handles the whole chain (upload cover → new article → title → body → pick cover → save draft) and is called automatically by `pub_daily.py`. A draft without a cover is marked *incomplete* by WeChat and cannot be published.
- **Xiaohongshu**: login state does not survive process exit — scanning the QR code and publishing must happen in the same process. Its footer buttons live in a **closed shadow root** (text is unreadable, no DOM node for the button), so the submit button is located geometrically inside the `<xhs-publish-btn>` host element.
- All four platforms break whenever they ship a redesign. Selectors *will* rot. That is the standing cost of this approach.

## Risk notice

Browser automation for publishing can trigger platform anti-bot systems. This project's posture is deliberately conservative: one post per day, serial execution, no retries. Evaluate the risk to your own account before running it. It is not built for bulk posting.

## License

Code: MIT. The articles in `01-content/` are original work — contact the author before reusing them.
