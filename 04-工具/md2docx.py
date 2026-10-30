"""把精简版 markdown 转成 .docx（零依赖，只用标准库）。

支持子集：# / ## / ### 标题、- 列表、> 引用、| 表格 |、---、**加粗**

用法：
    python md2docx.py 输入.md 输出.docx
"""

import re
import sys
import zipfile

NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
FONT_CN = "微软雅黑"
FONT_EN = "Segoe UI"
INK = "1A1A1A"
GRAY = "7A7A7A"
ACCENT = "A32D2D"

# 手机竖屏页面（108×192mm），在手机上按宽度铺满时字号才不会缩成蚂蚁
PAGE_W, PAGE_H, MARGIN = 6123, 10885, 460
BASE = 22      # 正文 11pt
LINE = 380     # 行距 1.9 倍


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;")
             .replace(">", "&gt;").replace('"', "&quot;"))


def run(text, size=24, bold=False, color=INK, font=FONT_CN):
    """size 单位是半磅，24 = 12pt。"""
    parts = []
    chunks = re.split(r"\*\*(.+?)\*\*", text)
    for i, ch in enumerate(chunks):
        if not ch:
            continue
        b = bold or (i % 2 == 1)
        parts.append(
            f'<w:r><w:rPr>'
            f'<w:rFonts w:ascii="{FONT_EN}" w:hAnsi="{FONT_EN}" w:eastAsia="{font}"/>'
            f'{"<w:b/>" if b else ""}'
            f'<w:color w:val="{color}"/>'
            f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
            f'</w:rPr><w:t xml:space="preserve">{esc(ch)}</w:t></w:r>'
        )
    return "".join(parts)


def para(content, align=None, before=0, after=160, line=LINE,
         indent=0, border=None, shade=None):
    ppr = ['<w:pPr>']
    if align:
        ppr.append(f'<w:jc w:val="{align}"/>')
    ppr.append(f'<w:spacing w:before="{before}" w:after="{after}" '
               f'w:line="{line}" w:lineRule="auto"/>')
    if indent:
        ppr.append(f'<w:ind w:left="{indent}"/>')
    if shade:
        ppr.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>')
    if border:
        side, color, sz = border
        ppr.append(
            f'<w:pBdr><w:{side} w:val="single" w:sz="{sz}" '
            f'w:space="6" w:color="{color}"/></w:pBdr>'
        )
    ppr.append("</w:pPr>")
    return f"<w:p>{''.join(ppr)}{content}</w:p>"


def table(rows):
    n = len(rows[0])
    w = 9000 // n
    out = ['<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>'
           '<w:tblBorders>'
           + "".join(f'<w:{s} w:val="single" w:sz="4" w:color="D9D9D9"/>'
                     for s in ("top", "left", "bottom", "right", "insideH", "insideV"))
           + '</w:tblBorders></w:tblPr>']
    for ri, row in enumerate(rows):
        out.append("<w:tr>")
        for ci in range(n):
            cell = row[ci] if ci < len(row) else ""
            fill = '<w:shd w:val="clear" w:color="auto" w:fill="F5F3EE"/>' if ri == 0 else ""
            out.append(
                f'<w:tc><w:tcPr><w:tcW w:w="{w}" w:type="dxa"/>{fill}</w:tcPr>'
                + para(run(cell, size=21, bold=(ri == 0)), after=60, line=280)
                + "</w:tc>"
            )
        out.append("</w:tr>")
    out.append("</w:tbl>")
    return "".join(out)


def build(md):
    lines = md.splitlines()
    body, i, first_h1 = [], 0, True

    while i < len(lines):
        ln = lines[i].rstrip()
        s = ln.strip()

        if not s or s == "---":
            i += 1
            continue

        if s.startswith("|") and "|" in s[1:]:
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                raw = lines[i].strip().strip("|")
                if not re.fullmatch(r"[\s:\-|]+", raw):
                    rows.append([c.strip() for c in raw.split("|")])
                i += 1
            if rows:
                body.append(table(rows))
                body.append(para("", after=120))
            continue

        if s.startswith("# "):
            t = s[2:].strip()
            if first_h1:
                m = re.match(r"^(第\s*\d+\s*关)\s*[｜|]\s*(.+)$", t)
                kicker, title = (m.group(1), m.group(2)) if m else ("", t)
                if kicker:
                    body.append(para(run(kicker, size=19, color=GRAY), after=70))
                body.append(para(run(title, size=46, bold=True), after=90, line=280))
                body.append(para("", after=220, border=("bottom", "1A1A1A", 12)))
                first_h1 = False
            else:
                body.append(para(run(t, size=30, bold=True), before=240, after=100))
            i += 1
            continue

        if s.startswith("## "):
            body.append(para(run(s[3:].strip(), size=27, bold=True, color=ACCENT),
                             before=420, after=140, line=300))
            i += 1
            continue

        if s.startswith("### "):
            body.append(para(run(s[4:].strip(), size=BASE + 2, bold=True),
                             before=260, after=100, line=320))
            i += 1
            continue

        if s.startswith("> "):
            body.append(para(run(s[2:].strip(), size=BASE, color="2B2B2B"),
                             before=140, after=200, indent=300, line=360,
                             border=("left", ACCENT, 20)))
            i += 1
            continue

        if s.startswith("- "):
            body.append(para(run("· " + s[2:].strip(), size=BASE),
                             after=120, indent=220, line=360))
            i += 1
            continue

        body.append(para(run(s, size=BASE), after=170, line=LINE))
        i += 1

    sect = (f'<w:sectPr><w:pgSz w:w="{PAGE_W}" w:h="{PAGE_H}"/>'
            f'<w:pgMar w:top="{MARGIN}" w:right="{MARGIN}" w:bottom="{MARGIN}" '
            f'w:left="{MARGIN}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>')
    return (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f"<w:document {NS}><w:body>{''.join(body)}{sect}</w:body></w:document>")


def convert(src, dst):
    with open(src, encoding="utf-8") as f:
        doc = build(f.read())

    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-'
          'officedocument.wordprocessingml.document.main+xml"/></Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            'relationships/officeDocument" Target="word/document.xml"/></Relationships>')

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", doc)
    print(f"{dst}  ok")


def main():
    convert(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
