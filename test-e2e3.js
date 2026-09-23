const fs = require("fs");
const { JSDOM } = require(require("path").join(process.env.TEMP, "jsdom-env", "node_modules", "jsdom"));
const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html, {
  url: "http://localhost/?t3", runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(window) {
    if (!Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "innerText")) {
      Object.defineProperty(window.HTMLElement.prototype, "innerText", {
        get() { return this.textContent; }, set(v) { this.textContent = v; }
      });
    }
    window.HTMLElement.prototype.scrollIntoView = function () {};
  }
});
const { window } = dom; const { document } = window;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s); const $$ = s => [...document.querySelectorAll(s)];
let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n); };
function selectText(sub) {
  const editor = $("#editor");
  const i = editor.textContent.indexOf(sub);
  const walker = document.createTreeWalker(editor, window.NodeFilter.SHOW_TEXT);
  let node, acc = 0, sn, so, en, eo;
  while ((node = walker.nextNode())) {
    const s = acc, e = acc + node.data.length;
    if (sn === undefined && i >= s && i <= e) { sn = node; so = i - s; }
    if (i + sub.length >= s && i + sub.length <= e) { en = node; eo = i + sub.length - s; }
    acc = e;
  }
  const range = document.createRange();
  range.setStart(sn, so); range.setEnd(en, eo);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));
}
(async () => {
  await sleep(100);
  selectText("会议纪要自动生成");
  $("#createCommentBtn").click();
  await sleep(30);
  $(".inline-form textarea").value = "这个功能建议挪到下期。";
  $$(".inline-form button.ok")[0].click();
  await sleep(30);
  // 彻底删除该句及其上下文 -> 失配
  const editor = $("#editor");
  editor.textContent = editor.textContent.replace("本期包含：智能时间推荐、日程冲突检测、会议纪要自动生成。", "本期范围另行讨论。");
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(700);
  check("意见已失配", $$(".badge.b-orphan").length === 1);
  check("失配原因可读", $$(".orphan-reason").length >= 1 && $$(".orphan-reason")[0].textContent.length > 5);
  // 筛选失配清单
  $$(".filter-btn").find(b => b.textContent.startsWith("失配")).click();
  await sleep(30);
  check("失配清单显示该意见", $$(".card").length === 1);
  // 重新绑定到新位置
  [...$$(".card")[0].querySelectorAll(".actions button")].find(b => b.textContent === "重新绑定").click();
  await sleep(30);
  check("重新绑定提示出现", $("#rebindTip").style.display === "block");
  selectText("本期范围另行讨论");
  await sleep(30);
  const confirmBtn = [...$$(".card")[0].querySelectorAll(".actions button")].find(b => b.textContent === "确认绑定");
  check("确认绑定按钮出现", !!confirmBtn);
  confirmBtn.click();
  await sleep(50);
  check("绑定后恢复追踪", $$(".badge.b-orphan").length === 0);
  $$(".filter-btn").find(b => b.textContent.startsWith("全部")).click();
  await sleep(30);
  check("讨论区记录重新绑定", $$(".card")[0].textContent.includes("重新绑定"));
  check("新位置已高亮", $("#editor mark.anchor-ok") !== null);
  console.log("---", pass, "passed,", fail, "failed ---");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ERROR", e); process.exit(1); });
