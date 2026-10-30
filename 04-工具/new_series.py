# -*- coding: utf-8 -*-
"""新建一个合集的骨架。

    python new_series.py 谜题实验室
    python new_series.py 书摘 --形态 散篇 --篇数 30
    python new_series.py 新系列 --id new-series --技能包 new-series

建什么：
    01-内容/<名称>/_合集.json         元数据（名称、id、形态、命名、篇数）
    01-内容/<名称>/                   母稿目录
    02-视觉/<名称>/公众号封面/         1280×792
    02-视觉/<名称>/小红书封面/         1080×1440
    03-规范/<名称>/README.md          该合集自己的写作/发布规范（可留空）
    06-存档/<名称>/卡片/、文档版/      过程产物

不建技能包——技能包要写内容，另开一次任务做。
"""

import argparse
import json
import os
import sys

import series

STUB = """# %s · 规范

这个合集自己的规则写在这里，与项目级的 `03-规范/修订规范.md` 并存：

- 合集定位、读者、发布节奏
- 与主系列不同的地方（命名、篇幅、结构、封面）
- 体检口径的差异

没写之前，一律按项目级规范和 `00｜项目规划与写作模板.md` 走。
"""


def main():
    ap = argparse.ArgumentParser(description="新建一个合集骨架")
    ap.add_argument("name", help="合集名（就是目录名）")
    ap.add_argument("--id", default="", help="英文 id，默认用合集名")
    ap.add_argument("--形态", default="关卡制", choices=["关卡制", "散篇", "连载"])
    ap.add_argument("--篇数", type=int, default=0, help="计划篇数，0 表示未定")
    ap.add_argument("--命名", default="第N关｜谜题名：钩子问句？.md")
    ap.add_argument("--技能包", default="", help="对应 05-技能包/<id>，可留空")
    ap.add_argument("--备注", default="")
    a = ap.parse_args()

    if series.exists(a.name):
        raise SystemExit("合集「%s」已存在：%s" % (a.name, series.content(a.name)))

    cfg = {
        "名称": a.name,
        "id": a.id or a.name,
        "形态": a.形态,
        "命名": a.命名,
        "篇数": a.篇数,
        "技能包": a.技能包,
        "起点": 1,
        "备注": a.备注,
    }

    made = series.ensure_dirs(a.name)
    with open(os.path.join(series.content(a.name), "_合集.json"), "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")

    spec = os.path.join(series.ROOT, "03-规范", a.name)
    os.makedirs(spec, exist_ok=True)
    stub = os.path.join(spec, "README.md")
    if not os.path.exists(stub):
        with open(stub, "w", encoding="utf-8") as f:
            f.write(STUB % a.name)

    print("已建合集：%s（id=%s，形态=%s）" % (a.name, cfg["id"], cfg["形态"]))
    for p in made + [spec]:
        print("  ", os.path.relpath(p, series.ROOT))
    print("\n下一步：")
    print("  1. 把母稿放进 01-内容/%s/（命名见 _合集.json 的「命名」）" % a.name)
    print("  2. cd 04-工具 && python make_covers_wx.py --合集 %s" % a.name)
    print("  3. 规范写进 03-规范/%s/README.md；要上传技能包再单独建 05-技能包/<id>" % a.name)


if __name__ == "__main__":
    sys.exit(main())
