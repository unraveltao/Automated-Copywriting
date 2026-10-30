# -*- coding: utf-8 -*-
"""把一关的富文本直接塞进 Windows 剪贴板，然后打开平台后台。

    python pub_clip.py 41 公众号          # 剪贴板就绪 + 打开 mp.weixin.qq.com
    python pub_clip.py 41 知乎            # 剪贴板就绪 + 打开 zhuanlan.zhihu.com/write
    python pub_clip.py 41 小红书          # 只写文案纯文本（文档要手动上传）
    python pub_clip.py 41 公众号 --no-open

为什么这条比浏览器自动化更值得先做：
剪贴板写入不依赖任何页面选择器，平台改版也不会失效；
剩下的动作只有「点新建 → Ctrl+V → 选封面 → 发送」，四步。
纯标准库，不用装 playwright，也不会触发风控。

剪贴板同时写 HTML Format 和纯文本，粘进公众号/知乎编辑器会保留
标题层级、加粗、引用块、表格、代码块。
"""

import ctypes
import json
import os
import sys
import webbrowser
from ctypes import wintypes

import series

HERE = os.path.dirname(os.path.abspath(__file__))

OPEN_URL = {
    "公众号": "https://mp.weixin.qq.com/",
    "知乎": "https://zhuanlan.zhihu.com/write",
    "小红书": "https://creator.xiaohongshu.com/publish/publish",
}

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002

user32.OpenClipboard.argtypes = [wintypes.HWND]
user32.OpenClipboard.restype = wintypes.BOOL
user32.EmptyClipboard.restype = wintypes.BOOL
user32.CloseClipboard.restype = wintypes.BOOL
user32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
user32.RegisterClipboardFormatW.restype = wintypes.UINT
user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
user32.SetClipboardData.restype = wintypes.HANDLE

kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalUnlock.restype = wintypes.BOOL
kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalFree.restype = wintypes.HGLOBAL


def _alloc(data):
    h = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(data))
    if not h:
        raise MemoryError("GlobalAlloc 失败")
    p = kernel32.GlobalLock(h)
    if not p:
        raise MemoryError("GlobalLock 失败")
    ctypes.memmove(p, data, len(data))
    kernel32.GlobalUnlock(h)
    return h


def build_cf_html(fragment, title=""):
    """按 CF_HTML 规范拼字节串，偏移一律按 UTF-8 字节算。

    头部数字必须定宽（10 位），否则 StartHTML 自身的长度会变，偏移全错。
    """
    head_tpl = ("Version:0.9\r\n"
                "StartHTML:{:010d}\r\n"
                "EndHTML:{:010d}\r\n"
                "StartFragment:{:010d}\r\n"
                "EndFragment:{:010d}\r\n")
    html_head = ('<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">'
                 '<title>%s</title></head><body>\r\n' % (title or ""))
    html_tail = "\r\n</body></html>"
    marker_s = "<!--StartFragment-->"
    marker_e = "<!--EndFragment-->"

    header_len = len(head_tpl.format(0, 0, 0, 0).encode("utf-8"))
    start_html = header_len
    start_frag = start_html + len((html_head + marker_s).encode("utf-8"))
    frag_bytes = fragment.encode("utf-8")
    end_frag = start_frag + len(frag_bytes)
    end_html = end_frag + len((marker_e + html_tail).encode("utf-8"))

    header = head_tpl.format(start_html, end_html, start_frag, end_frag).encode("utf-8")
    body = (html_head + marker_s).encode("utf-8") + frag_bytes + (marker_e + html_tail).encode("utf-8")
    return header + body


def set_clipboard(html=None, text=""):
    """一次开剪贴板，同时写 HTML Format 与纯文本。"""
    if not user32.OpenClipboard(None):
        raise OSError("打不开剪贴板（别的程序占用？）")
    try:
        user32.EmptyClipboard()
        if html:
            fmt = user32.RegisterClipboardFormatW("HTML Format")
            data = build_cf_html(html)
            if not user32.SetClipboardData(fmt, _alloc(data)):
                raise OSError("写 HTML Format 失败")
        if text:
            user32.SetClipboardData(CF_UNICODETEXT, _alloc((text + "\x00").encode("utf-16-le")))
    finally:
        user32.CloseClipboard()


def load(num, series_name):
    pack = os.path.join(series.arc(series_name, "发布包"), "第%03d关" % num)
    mp = os.path.join(pack, "meta.json")
    if not os.path.exists(mp):
        raise SystemExit("第%d关还没备料。先跑：python pub_pack.py %d" % (num, num))
    with open(mp, encoding="utf-8") as f:
        return pack, json.load(f)


def main():
    name, rest = series.pick(sys.argv[1:])
    if not rest or not rest[0].isdigit():
        raise SystemExit("用法：python pub_clip.py 41 公众号|知乎|小红书 [--no-open]")
    num = int(rest[0])
    plat = rest[1] if len(rest) > 1 and not rest[1].startswith("--") else "公众号"
    no_open = "--no-open" in rest or "--clip-only" in rest

    pack, meta = load(num, name)

    if plat == "公众号":
        with open(meta["公众号"]["html"], encoding="utf-8") as f:
            html = f.read()
        text = meta["公众号"]["标题"]
    elif plat == "知乎":
        with open(meta["知乎"]["html"], encoding="utf-8") as f:
            html = f.read()
        text = meta["知乎"]["标题"]
    elif plat == "小红书":
        html = None
        text = meta["小红书"]["文案"]
    else:
        raise SystemExit("平台只能是：公众号 / 知乎 / 小红书")

    set_clipboard(html, text)
    print("剪贴板已就绪：第%d关 · %s" % (num, plat))
    if plat == "公众号":
        print("  标题：%s" % meta["公众号"]["标题"])
        print("  封面：%s" % (meta["公众号"]["封面"] or "（缺，先跑 make_covers_wx.py %d）" % num))
        print("  步骤：新建图文 → 填标题 → 正文区 Ctrl+V → 选封面 → 发送")
    elif plat == "知乎":
        print("  标题：%s%s" % (meta["知乎"]["标题"], "（需人工确认）" if meta["知乎"].get("需确认") else ""))
        print("  标签：%s" % " ".join(meta["知乎"]["标签"]))
        print("  步骤：写文章 → 填标题 → 正文区 Ctrl+V → 加标签 → 发布")
    else:
        print("  标题：%s" % meta["小红书"]["标题"])
        print("  文档：%s" % (meta["小红书"]["docx"] or "（缺，先跑 mk_xhs_note.py %d --docx）" % num))
        print("  封面：%s" % (meta["小红书"]["封面"] or "（缺）"))
        print("  步骤：上传文档 → 填标题 → 粘贴文案 → 选封面 → 发布")

    if not no_open:
        webbrowser.open(OPEN_URL[plat])


if __name__ == "__main__":
    main()
