# -*- coding: utf-8 -*-
"""母稿 md → 平台富文本 HTML（公众号 / 知乎）。

为什么要自己转，不直接把 md 丢进编辑器：
公众号编辑器（mp.weixin.qq.com）会剥掉 class 和外部 CSS，样式必须内联；
知乎编辑器会用自己的样式覆盖一部分，塞太多样式反而更乱。
所以两边用同一份结构、两套样式表。

用法：
    from pub_md2html import split_h1, convert, title_parts
    h1, body = split_h1(md_text)
    html = convert(body, "wechat")
"""

import html
import re

CJK = r"\u4e00-\u9fff"

WECHAT = {
    "p": "margin:0 0 20px;font-size:16px;line-height:1.8;color:#3E3E3E;letter-spacing:.5px;",
    "h2": "margin:36px 0 18px;padding-left:10px;font-size:19px;line-height:1.5;"
          "font-weight:bold;color:#1A1A1A;border-left:4px solid #A32D2D;",
    "h3": "margin:26px 0 14px;font-size:17px;line-height:1.5;font-weight:bold;color:#A32D2D;",
    "blockquote": "margin:0 0 20px;padding:12px 16px;font-size:15px;line-height:1.8;"
                  "color:#5A5A5A;background:#FAFAFA;border-left:3px solid #D9D9D9;",
    "ul": "margin:0 0 20px;padding-left:24px;",
    "ol": "margin:0 0 20px;padding-left:24px;",
    "li": "margin:6px 0;font-size:16px;line-height:1.8;color:#3E3E3E;",
    "hr": "margin:32px 0;border:none;border-top:1px dashed #E0E0E0;",
    "table": "width:100%;border-collapse:collapse;margin:0 0 20px;font-size:14px;",
    "th": "border:1px solid #E5E5E5;padding:8px 10px;background:#F7F7F7;"
          "font-weight:bold;color:#1A1A1A;text-align:left;",
    "td": "border:1px solid #E5E5E5;padding:8px 10px;color:#3E3E3E;",
    "pre": "margin:0 0 20px;padding:14px 16px;background:#F7F7F7;border-radius:4px;"
           "font-size:13px;line-height:1.7;overflow-x:auto;white-space:pre;"
           "font-family:Menlo,Consolas,monospace;color:#333333;",
    "code": "padding:2px 4px;background:#F2F2F2;border-radius:3px;font-size:14px;",
    "strong": "font-weight:bold;color:#1A1A1A;",
    "img": "max-width:100%;height:auto;display:block;margin:0 auto 20px;",
}

ZHIHU = {
    "p": "margin:0 0 16px;font-size:16px;line-height:1.8;color:#1A1A1A;",
    "h2": "margin:28px 0 14px;font-size:19px;line-height:1.5;font-weight:bold;color:#1A1A1A;",
    "h3": "margin:22px 0 12px;font-size:17px;line-height:1.5;font-weight:bold;color:#1A1A1A;",
    "blockquote": "margin:0 0 16px;padding:8px 16px;font-size:15px;line-height:1.8;"
                  "color:#646464;border-left:3px solid #D3D3D3;",
    "ul": "margin:0 0 16px;padding-left:24px;",
    "ol": "margin:0 0 16px;padding-left:24px;",
    "li": "margin:6px 0;font-size:16px;line-height:1.8;color:#1A1A1A;",
    "hr": "margin:28px 0;border:none;border-top:1px solid #E5E5E5;",
    "table": "width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px;",
    "th": "border:1px solid #DDD;padding:8px 10px;background:#F6F6F6;font-weight:bold;",
    "td": "border:1px solid #DDD;padding:8px 10px;",
    "pre": "margin:0 0 16px;padding:14px 16px;background:#F6F6F6;border-radius:4px;"
           "font-size:13px;line-height:1.7;overflow-x:auto;white-space:pre;"
           "font-family:Menlo,Consolas,monospace;",
    "code": "padding:2px 4px;background:#F2F2F2;border-radius:3px;font-size:14px;",
    "strong": "font-weight:bold;",
    "img": "max-width:100%;height:auto;display:block;margin:0 auto 16px;",
}

STYLES = {"wechat": WECHAT, "zhihu": ZHIHU}


def inline(text, S):
    """行内元素：加粗、行内代码、图片、链接。先转义再替换，避免注入。"""
    s = html.escape(text, quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", lambda m: '<strong style="%s">%s</strong>' % (S["strong"], m.group(1)), s)
    s = re.sub(r"`([^`]+?)`", lambda m: '<code style="%s">%s</code>' % (S["code"], m.group(1)), s)
    s = re.sub(r"!\[(.*?)\]\((.+?)\)",
               lambda m: '<img src="%s" alt="%s" style="%s">' % (m.group(2), m.group(1), S["img"]), s)
    s = re.sub(r"\[(.+?)\]\((https?://.+?)\)", r'<a href="\2">\1</a>', s)
    return s


def _join(lines):
    """把段落内的折行接起来。中文之间不留空格，英文数字之间留一个。"""
    s = " ".join(x.strip() for x in lines)
    return re.sub(r"(?<=[%s])\s+(?=[%s])" % (CJK, CJK), "", s)


def _table(rows, S):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    head, body = cells[0], cells[2:]
    out = ['<table style="%s">' % S["table"]]
    out.append("<thead><tr>" + "".join(
        '<th style="%s">%s</th>' % (S["th"], inline(c, S)) for c in head) + "</tr></thead>")
    if body:
        out.append("<tbody>")
        for r in body:
            out.append("<tr>" + "".join(
                '<td style="%s">%s</td>' % (S["td"], inline(c, S)) for c in r) + "</tr>")
        out.append("</tbody>")
    out.append("</table>")
    return "".join(out)


def _is_sep(row):
    return re.match(r"^\|[\s:\-|]+\|?$", row.strip()) is not None


def blocks(lines, S):
    """逐行状态机。返回 HTML 片段列表。"""
    out, i, n = [], 0, len(lines)
    while i < n:
        raw = lines[i]
        s = raw.strip()

        if not s:
            i += 1
            continue

        if s.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append('<pre style="%s">%s</pre>' % (S["pre"], html.escape("\n".join(buf), quote=False)))
            continue

        if re.match(r"^-{3,}$", s) or re.match(r"^\*{3,}$", s):
            out.append('<hr style="%s">' % S["hr"])
            i += 1
            continue

        if s.startswith("#"):
            level = len(s) - len(s.lstrip("#"))
            text = s[level:].strip()
            tag = "h2" if level <= 2 else "h3"
            key = "h2" if level <= 2 else "h3"
            out.append('<%s style="%s">%s</%s>' % (tag, S[key], inline(text, S), tag))
            i += 1
            continue

        if s.startswith("|") and i + 1 < n and _is_sep(lines[i + 1]):
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append(lines[i])
                i += 1
            if len(rows) >= 2:
                out.append(_table(rows, S))
            continue

        if s.startswith(">"):
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                t = lines[i].strip()
                buf.append(re.sub(r"^>\s?", "", t))
                i += 1
            # 引用块内部的段落收紧，否则一段 20px 的下边距会把灰底撑得很松
            S_in = dict(S)
            S_in["p"] = S["p"].replace("margin:0 0 20px", "margin:0 0 10px")
            out.append('<blockquote style="%s">%s</blockquote>'
                       % (S["blockquote"], "".join(blocks(buf, S_in))))
            continue

        m_ul = re.match(r"^[-*]\s+(.*)$", s)
        m_ol = re.match(r"^(\d+)\.\s+(.*)$", s)
        if m_ul or m_ol:
            ordered = m_ol is not None
            tag = "ol" if ordered else "ul"
            items = []
            while i < n:
                t = lines[i].strip()
                mm = (re.match(r"^(\d+)\.\s+(.*)$", t) if ordered
                      else re.match(r"^[-*]\s+(.*)$", t))
                if not mm:
                    break
                items.append(mm.group(2) if ordered else mm.group(1))
                i += 1
            out.append('<%s style="%s">%s</%s>' % (
                tag, S[tag],
                "".join('<li style="%s">%s</li>' % (S["li"], inline(x, S)) for x in items),
                tag))
            continue

        buf = []
        while i < n:
            t = lines[i].strip()
            if (not t or t.startswith("#") or t.startswith(">") or t.startswith("|")
                    or t.startswith("```") or re.match(r"^-{3,}$", t)
                    or re.match(r"^[-*]\s+", t) or re.match(r"^\d+\.\s+", t)):
                break
            buf.append(lines[i])
            i += 1
        if buf:
            out.append('<p style="%s">%s</p>' % (S["p"], inline(_join(buf), S)))
    return out


def split_h1(md):
    """拆出第一个 H1 和正文。母稿只有一个 H1。"""
    lines = md.splitlines()
    for idx, ln in enumerate(lines):
        if ln.strip().startswith("# "):
            h1 = ln.strip()[2:].strip()
            body = "\n".join(lines[idx + 1:])
            return h1, body
    return "", md


def convert(md_body, platform="wechat"):
    S = STYLES[platform]
    return "\n".join(blocks(md_body.splitlines(), S))


def title_parts(h1):
    """`第41关｜辛普森悖论：每一组都赢，为什么合起来却输？` →
    {关卡, 谜题, 钩子, 完整}"""
    parts = {"完整": h1, "关卡": "", "谜题": "", "钩子": ""}
    m = re.match(r"^(第\d+关)\s*[｜|]\s*(.+)$", h1)
    rest = h1
    if m:
        parts["关卡"] = m.group(1)
        rest = m.group(2)
    if "：" in rest:
        a, b = rest.split("：", 1)
        parts["谜题"], parts["钩子"] = a.strip(), b.strip()
    elif ":" in rest:
        a, b = rest.split(":", 1)
        parts["谜题"], parts["钩子"] = a.strip(), b.strip()
    else:
        parts["谜题"] = rest.strip()
    return parts


def zhihu_title(parts, limit=16):
    """知乎标题 ≤16 字：关卡号 + 谜题名 + 精简钩子。

    知乎会截断长标题，公众号那套 22 字标题直接搬过去会掉尾巴。
    降级顺序：完整 → 去掉疑问修饰 → 只留「第N关｜谜题」 → 硬截断。
    宁可不带钩子，也不留「每一组都？」这种半截话。
    返回 (标题, 是否需人工确认)。
    """
    base = ("%s｜%s：" % (parts["关卡"], parts["谜题"])) if parts["关卡"] else ""
    head = base.rstrip("：")
    hook = parts["钩子"]
    full = base + hook
    if len(full) <= limit:
        return full, False

    slim = hook
    for w in ("为什么", "到底", "究竟", "是怎么", "会怎样", "怎么办", "才", "就"):
        slim = slim.replace(w, "")
    slim = re.sub(r"[，,。？?！!、；;：:\s]+$", "", slim)
    cand = base + slim
    if len(cand) <= limit:
        return cand, False

    if len(head) <= limit:
        return head, True

    return head[:limit], True


def plain_text(md_body, limit=0):
    """去标记的纯文本，用来做小红书文案、摘要。"""
    t = re.sub(r"```.*?```", "", md_body, flags=re.S)
    t = re.sub(r"!\[.*?\]\(.*?\)", "", t)
    t = re.sub(r"\[(.+?)\]\(.*?\)", r"\1", t)
    t = re.sub(r"[#>*`|\-]{1,}", " ", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{2,}", "\n", t).strip()
    return t[:limit] if limit else t
