# -*- coding: utf-8 -*-
"""把 logic-levels/ 打包成：单文件 md + 可上传的 zip。

用法：python build_package.py
产物：
    logic-levels-单文件版.md   （SKILL.md + 六个参考文件，标题降一级）
    logic-levels.zip           （整目录，zip 内根是 logic-levels/）
"""

import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.join(HERE, "logic-levels")
SINGLE = os.path.join(HERE, "logic-levels-单文件版.md")
ZIP = os.path.join(HERE, "logic-levels")


def demote(text):
    """标题整体降一级：# → ##，## → ###，代码块内不动。"""
    out, fenced = [], False
    for line in text.split("\n"):
        if line.startswith("```"):
            fenced = not fenced
        if not fenced and re.match(r"^#{1,5} ", line):
            line = "#" + line
        out.append(line)
    return "\n".join(out)


def main():
    skill = open(os.path.join(PKG, "SKILL.md"), encoding="utf-8").read().rstrip()
    parts = [skill]
    ref_dir = os.path.join(PKG, "references")
    for name in sorted(os.listdir(ref_dir)):
        if not name.endswith(".md"):
            continue
        body = open(os.path.join(ref_dir, name), encoding="utf-8").read().rstrip()
        title = body.split("\n", 1)[0].lstrip("# ").strip()
        parts.append("---\n\n# 附录：%s\n\n%s" % (title, demote(body)))

    with open(SINGLE, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n\n".join(parts) + "\n")

    if os.path.exists(ZIP + ".zip"):
        os.remove(ZIP + ".zip")
    shutil.make_archive(ZIP, "zip", HERE, "logic-levels")

    print("单文件：%s（%d 字符）" % (SINGLE, len(open(SINGLE, encoding="utf-8").read())))
    print("压缩包：%s.zip（%.1f KB）" % (ZIP, os.path.getsize(ZIP + ".zip") / 1024))


if __name__ == "__main__":
    main()
