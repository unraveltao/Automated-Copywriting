// 共用：Markdown → 可粘贴 HTML，以及各平台标题压缩
// 被 pub_zh_publish.js / pub_tt_publish.js 之类调用。

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

// 本系列用到的语法：标题、引用、分隔线、有序/无序列表、加粗、行内代码
function mdToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  let inQuote = false;
  let listType = null;

  function closeList() { if (listType) { out.push('</' + listType + '>'); listType = null; } }
  function closeQuote() { if (inQuote) { out.push('</blockquote>'); inQuote = false; } }

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t) { closeList(); closeQuote(); i++; continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { closeList(); closeQuote(); out.push('<hr>'); i++; continue; }

    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList(); closeQuote();
      const lv = Math.min(h[1].length + 1, 6); // # → h2（h1 留给标题框）
      out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
      i++; continue;
    }

    if (/^>\s?/.test(t)) {
      closeList();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push('<p>' + inline(t.replace(/^>\s?/, '')) + '</p>');
      i++; continue;
    }
    closeQuote();

    const ul = t.match(/^[-*+]\s+(.*)$/);
    const ol = t.match(/^\d+\.\s+(.*)$/);
    if (ul || ol) {
      const want = ul ? 'ul' : 'ol';
      if (listType && listType !== want) closeList();
      if (!listType) { out.push('<' + want + '>'); listType = want; }
      out.push('<li>' + inline((ul || ol)[1]) + '</li>');
      i++; continue;
    }
    closeList();

    const buf = [t];
    i++;
    while (i < lines.length) {
      const nx = lines[i].trim();
      if (!nx || /^(#{1,6}\s|>|[-*+]\s|\d+\.\s|-{3,}$)/.test(nx)) break;
      buf.push(nx);
      i++;
    }
    out.push('<p>' + inline(buf.join('')) + '</p>');
  }
  closeList(); closeQuote();
  return out.join('\n');
}

// 在标点处断开，别把词切两半。
// 旧的 hook.slice(0, room) 会把「怎样找到宝箱？」切成「怎样找到宝」——
// 03-规范/知乎/发布规范｜标题与标签.md 记录的就是这个毛病，别再复现。
// 返回 null 表示在标点处放不下，由调用方降级。
function cutHook(head, hook, limit) {
  const tail = '？';
  const room = limit - head.length - tail.length;
  if (hook.length <= room) return head + hook + tail;
  const marks = '，、；：,;';
  for (let i = room; i > Math.max(2, room - 8); i--) {
    if (marks.indexOf(hook[i - 1]) >= 0) return head + hook.slice(0, i - 1) + tail;
  }
  return null;
}

// 头条标题：实测上限 30 字（编辑器写「请输入文章标题（2～30个字）」）
function ttTitle(n, raw) {
  const m = raw.match(/^第(\d+)关｜(.+?)：(.+)$/);
  if (!m) return raw.slice(0, 30);
  const head = '第' + m[1] + '关｜';
  const name = m[2];
  const hook = m[3].replace(/[？?]$/, '');

  const full = head + name + '：' + hook + '？';
  if (full.length <= 30) return full;

  // 超了：保留「关号 + 谜题名」，钩子在标点处收
  const cut = cutHook(head + name + '：', hook, 30);
  if (cut) return cut;

  // 还是不行：只留关号 + 谜题名
  return (head + name).slice(0, 30);
}

// 知乎标题：实测上限 100 字（编辑器写「请输入标题（最多 100 个字）」）。
// 早期按 16 字截断是误判——16 字是信息流里的显示截断，不是输入限制。
const ZH_TITLE_MAP = {
  1: '第1关｜守卫难题：怎样找到宝箱？',
  2: '第2关｜骑士与骗子岛：哪句话没人说得出？',
  3: '第3关｜卡片翻面：该翻哪两张？',
  4: '第4关｜蓝眼睛岛民：一句废话改变一切',
  5: '第5关｜帽子问题：他没说，你该听出什么？',
  6: '第6关｜三门问题：那扇门说了什么？',
  7: '第7关｜体检假阳性：阳性就是有病吗？',
  8: '第8关｜生日悖论：23 人为啥就够了？',
  9: '第9关｜双信封悖论：看到 100 元换不换？',
  10: '第10关｜季终：三份材料你先信哪个？',
};

function zhTitle(n, raw) {
  if (ZH_TITLE_MAP[n]) return ZH_TITLE_MAP[n];
  const m = raw.match(/^第(\d+)关｜(.+?)：(.+)$/);
  if (!m) return raw.slice(0, 100);
  const head = '第' + m[1] + '关｜' + m[2] + '：';
  const hook = m[3].replace(/[？?]$/, '');
  const full = head + hook + '？';
  if (full.length <= 100) return full;
  return cutHook(head, hook, 100) || full.slice(0, 100);
}

module.exports = { mdToHtml, ttTitle, zhTitle, ZH_TITLE_MAP, cutHook };
