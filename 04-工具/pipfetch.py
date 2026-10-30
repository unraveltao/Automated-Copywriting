# -*- coding: utf-8 -*-
"""从清华镜像手动抓 wheel 并递归安装依赖。

为什么不用 pip install：
    本机 pip 走代理返回 502；绕开代理后 pip 仍解析不出候选（索引页正常、wheel 也在），
    但 curl / urllib 直接抓页面和文件都正常。所以这里绕过 pip 的解析环节：
    自己挑 wheel、自己读 METADATA 里的 Requires-Dist、递归补齐依赖。

用法：
    python pipfetch.py edge-tts
    python pipfetch.py --force 某个包
"""
import os
import re
import subprocess
import sys
import zipfile
import urllib.request

MIRROR = "https://pypi.tuna.tsinghua.edu.cn"
PY_TAG = "cp313"
PLAT = "win_amd64"
CACHE = os.path.join(os.environ.get("TEMP", "/tmp"), "whl")


def fetch(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "pip/26"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def best_wheel(pkg):
    """挑一个当前环境能装的 wheel：优先平台专用，其次纯 py3。"""
    html = fetch("%s/simple/%s/" % (MIRROR, norm(pkg))).decode("utf-8", "ignore")
    hrefs = re.findall(r'href="([^"#]+\.whl)', html)
    cand = []
    for h in hrefs:
        name = h.rsplit("/", 1)[-1]
        if "win32" in name and "win_amd64" not in name:
            continue
        if "manylinux" in name or "macosx" in name:
            continue
        # cp313t 是 free-threaded 构建，和常规 cp313 不兼容，子串匹配会误收
        if "cp313t" in name:
            continue
        if "cp3" in name and PY_TAG not in name:
            continue
        plat_ok = "win_amd64" in name and PY_TAG in name
        pure_ok = name.endswith("py3-none-any.whl") or name.endswith("py2.py3-none-any.whl")
        if not (plat_ok or pure_ok):
            continue
        m = re.search(r"-(\d+\.\d+(?:\.\d+)?)-", name)
        ver = tuple(int(x) for x in m.group(1).split(".")) if m else (0,)
        # 平台专用包优先于 py3-none-any：有些包会同时挂一个空的 py3 占位 wheel，
        # 按版本号排序时它会和真包并列，必须用分数压下去
        cand.append((ver, 2 if plat_ok else 1, name, h))
    if not cand:
        raise LookupError("没找到可用的 wheel: %s" % pkg)
    cand.sort()
    return cand[-1][2], cand[-1][3]


def download(pkg):
    name, href = best_wheel(pkg)
    dst = os.path.join(CACHE, name)
    if not os.path.exists(dst):
        url = MIRROR + "/" + href[6:] if href.startswith("../../") else MIRROR + href
        print("  下载", name)
        with open(dst, "wb") as f:
            f.write(fetch(url, timeout=180))
    return dst


def requires(wheel_path):
    """从 wheel 的 METADATA 读 Requires-Dist，跳过 extra 和带环境标记的。"""
    out = []
    with zipfile.ZipFile(wheel_path) as z:
        meta = [n for n in z.namelist() if n.endswith(".dist-info/METADATA")]
        if not meta:
            return out
        text = z.read(meta[0]).decode("utf-8", "ignore")
    for line in text.splitlines():
        if not line.startswith("Requires-Dist:"):
            continue
        spec = line.split(":", 1)[1].strip()
        if "extra ==" in spec:
            continue
        if ";" in spec:
            # 有环境标记的（比如 sys_platform == "win32" 之外）一律跳过，宁可少装
            marker = spec.split(";", 1)[1]
            if "win" not in marker and "python_version" not in marker:
                continue
            if "python_version" in marker:
                continue
        name = re.split(r"[<>=!\[; ]", spec)[0].strip()
        if name:
            out.append(name)
    return out


def resolve(pkg, seen=None, depth=0):
    """深度优先：先装依赖，再装自己。"""
    seen = seen if seen is not None else set()
    key = norm(pkg)
    if key in seen:
        return []
    seen.add(key)
    wheel = download(pkg)
    paths = []
    for dep in requires(wheel):
        paths += resolve(dep, seen, depth + 1)
    paths.append(wheel)
    return paths


def main(argv):
    if not argv:
        print(__doc__)
        return
    os.makedirs(CACHE, exist_ok=True)
    wheels = []
    for pkg in argv:
        print("解析", pkg)
        wheels += resolve(pkg)
    # 去重，保持顺序
    uniq, s = [], set()
    for w in wheels:
        if w not in s:
            s.add(w)
            uniq.append(w)
    print("安装 %d 个包" % len(uniq))
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--no-deps"] + uniq, check=True)


if __name__ == "__main__":
    main([a for a in sys.argv[1:] if not a.startswith("--")])
