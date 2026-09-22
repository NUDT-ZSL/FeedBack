#!/usr/bin/env python3
"""端到端验证：重排后阅读位置保持、无横向溢出、连续微调稳定收敛。"""
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8918
BASE = f"http://127.0.0.1:{PORT}"

JS_MARKER = """() => {
  const m = document.querySelector('.s.marker');
  if (!m) return null;
  const stage = document.getElementById('stage');
  const r = m.getBoundingClientRect();
  const c = stage.getBoundingClientRect();
  return {
    sid: m.dataset.sid,
    text: m.textContent.slice(0, 12),
    inView: r.bottom > c.top && r.top < c.bottom,
    overflowX: stage.scrollWidth - stage.clientWidth,
    scrollTop: stage.scrollTop,
    cols: getComputedStyle(document.getElementById('article')).columnCount,
  };
}"""


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        raise SystemExit(1)


def main():
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "server.py"), "--port", str(PORT), "--no-browser"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(30):
            try:
                urllib.request.urlopen(BASE + "/", timeout=1)
                break
            except OSError:
                time.sleep(0.3)

        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            page.goto(BASE + "/")
            page.click("#btn-sample")
            page.wait_for_selector(".s")
            n = page.evaluate("document.querySelectorAll('.s').length")
            check(n > 200, f"示例文档渲染出 {n} 个句子")

            # 滚动到文档中部，标记应落在那里
            page.evaluate(
                "document.getElementById('stage').scrollTop = "
                "document.getElementById('stage').scrollHeight / 2"
            )
            page.wait_for_timeout(200)
            m0 = page.evaluate(JS_MARKER)
            check(m0 and m0["inView"], f"中部阅读标记可见 sid={m0['sid']}")

            # 1) 连续放大字号 30 -> 64，标记句必须始终是同一句、无横向溢出
            for size in range(32, 66, 4):
                page.evaluate(f"document.getElementById('font-slider').value = {size};"
                              "document.getElementById('font-slider').dispatchEvent(new Event('input'))")
                page.wait_for_timeout(60)
                m = page.evaluate(JS_MARKER)
                check(m["sid"] == m0["sid"], f"字号 {size}px 后标记仍指向同一句")
                check(m["overflowX"] <= 1, f"字号 {size}px 无横向溢出")
                check(m["inView"], f"字号 {size}px 标记仍在视口内")

            # 2) 缩窄视窗（38%），同样保持
            page.select_option("#width-select", "38")
            page.wait_for_timeout(300)
            m = page.evaluate(JS_MARKER)
            check(m["sid"] == m0["sid"], "视窗缩到 38% 后标记句不变")
            check(m["overflowX"] <= 1, "窄视窗无横向溢出")
            check(m["inView"], "窄视窗标记在视口内")
            cols_narrow = m["cols"]

            # 3) 浏览器窗口本身变窄 -> 重新分栏
            page.set_viewport_size({"width": 700, "height": 800})
            page.wait_for_timeout(300)
            m = page.evaluate(JS_MARKER)
            check(m["sid"] == m0["sid"], "窗口变窄后标记句不变")
            check(m["overflowX"] <= 1, "窗口变窄无横向溢出")
            print(f"     栏数变化: 38%宽={cols_narrow} -> 700px窗口={m['cols']}")

            # 4) 快速连续微调（模拟拖动），结果必须收敛且可复现
            page.set_viewport_size({"width": 1280, "height": 800})
            page.select_option("#width-select", "100")
            page.wait_for_timeout(300)

            def rapid_sequence():
                for size in [40, 58, 34, 66, 30]:
                    page.evaluate(
                        f"document.getElementById('font-slider').value = {size};"
                        "document.getElementById('font-slider').dispatchEvent(new Event('input'))")
                    page.wait_for_timeout(30)
                page.wait_for_timeout(300)
                return page.evaluate(JS_MARKER)

            r1 = rapid_sequence()
            r2 = rapid_sequence()
            check(r1["sid"] == m0["sid"] and r2["sid"] == m0["sid"],
                  "两轮快速微调后标记句不变")
            check(r1["scrollTop"] == r2["scrollTop"],
                  f"两轮相同操作滚动位置一致 ({r1['scrollTop']}=={r2['scrollTop']})，无累积漂移")

            # 4b) 小字号 + 宽视窗 -> 自动分为多栏，且标记句仍不变
            page.evaluate("document.getElementById('font-slider').value = 16;"
                          "document.getElementById('font-slider').dispatchEvent(new Event('input'))")
            page.wait_for_timeout(300)
            m = page.evaluate(JS_MARKER)
            check(int(m["cols"]) >= 2, f"16px + 宽视窗自动分栏 (cols={m['cols']})")
            check(m["sid"] == m0["sid"], "分栏变化后标记句不变")
            check(m["overflowX"] <= 1, "多栏布局无横向溢出")

            # 5) 超大字号下超长段落逐行可读（不被裁切）
            page.evaluate("document.getElementById('font-slider').value = 96;"
                          "document.getElementById('font-slider').dispatchEvent(new Event('input'))")
            page.wait_for_timeout(300)
            tall = page.evaluate("""() => {
              const stage = document.getElementById('stage');
              const ps = [...document.querySelectorAll('#article p')];
              const tall = ps.find(p => p.getBoundingClientRect().height > stage.clientHeight * 1.5);
              if (!tall) return { found: false };
              const sids = [...tall.querySelectorAll('.s')].map(s => Number(s.dataset.sid));
              return { found: true, first: sids[0], last: sids[sids.length - 1],
                       overflowX: stage.scrollWidth - stage.clientWidth };
            }""")
            check(tall["found"], "96px 下存在超过一屏的长段落")
            check(tall["overflowX"] <= 1, "96px 长段落无横向溢出")
            page.evaluate(
                f"document.querySelector('[data-sid=\"{tall['first']}\"]').scrollIntoView()")
            page.wait_for_timeout(200)
            mid = page.evaluate(JS_MARKER)
            check(tall["first"] <= int(mid["sid"]) <= tall["last"],
                  f"长段落内部可逐行阅读 (标记 sid={mid['sid']})")
            browser.close()
        print("e2e: all passed")
    finally:
        proc.terminate()
        proc.wait(timeout=5)


if __name__ == "__main__":
    main()
