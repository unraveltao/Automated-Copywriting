# -*- coding: utf-8 -*-
"""统一改写标题钩子：文件名 + H1 同步，谜题名不变（封面文件名因此不变）。

一次性迁移用（第 14/29/30/… 关的钩子改写过一轮）。已经改过的会跳过，
重复跑不会出事。

用法：python retitle.py [--合集 逻辑闯关]
"""

import os
import re
import sys

import series

# 关号: 新钩子（谜题名保持不变）
NEW_HOOK = {
    14: "九个格子，为什么其实只有三种开局？",
    29: "指不出第一步，凭什么也算赢？",
    30: "你以为是运气，其实是哪三条铁律？",
    34: "一千天的喂养，能推出明天吗？",
    36: "这个问题，已经替你承认了哪件事？",
    37: "同一个词，怎么前后就成了两件事？",
    39: "你赢的那个对手，为什么不是他？",
    40: "一段争吵，怎么拆成三层？",
    41: "每一组都赢，为什么合起来却输？",
    47: "240万人算错了，5万人凭什么算对？",
    48: "同一组数据，怎么能画出两个相反的结论？",
    50: "一份漂亮的报告，怎么藏住七个坑？",
    62: "每个人都只多拿一点点，为什么资源就没了？",
    70: "你身边那个停不下来的圈，怎么找出来？",
}


def main():
    name, _ = series.pick(sys.argv[1:])
    doc_dir = series.content(name)
    for fn in sorted(os.listdir(doc_dir)):
        if not fn.endswith(".md"):
            continue
        m = re.match(r"^第(\d+)关｜(.+?)：(.+)\.md$", fn)
        if not m:
            continue
        num, title, hook = int(m.group(1)), m.group(2), m.group(3)
        if num not in NEW_HOOK:
            continue
        new_hook = NEW_HOOK[num]
        if hook == new_hook:
            continue
        new_name = "第%d关｜%s：%s.md" % (num, title, new_hook)
        old_path = os.path.join(doc_dir, fn)
        new_path = os.path.join(doc_dir, new_name)

        text = open(old_path, encoding="utf-8").read()
        lines = text.split("\n")
        assert lines[0].startswith("# 第%d关｜" % num), lines[0]
        lines[0] = "# 第%d关｜%s：%s" % (num, title, new_hook)
        with open(old_path, "w", encoding="utf-8", newline="") as f:
            f.write("\n".join(lines))
        os.replace(old_path, new_path)
        print("第%-3d关  %s → %s" % (num, hook, new_hook))


if __name__ == "__main__":
    main()
