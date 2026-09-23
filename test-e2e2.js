const fs = require("fs");
const { JSDOM } = require(require("path").join(process.env.TEMP, "jsdom-env", "node_modules", "jsdom"));
const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html, {
  url: "http://localhost/?t2", runScripts: "dangerously", pretendToBeVisual: true,
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
  const full = editor.textContent;
  const i = full.indexOf(sub);
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
async function addComment(quote, text) {
  selectText(quote);
  $("#createCommentBtn").click();
  await sleep(30);
  $(".inline-form textarea").value = text;
  $$(".inline-form button.ok")[0].click();
  await sleep(30);
}

(async () => {
  await sleep(100);
  // 需求5：同一段文字上的两条意见
  await addComment("推荐准确率不低于 90%", "指标是否过高？");
  await addComment("推荐准确率不低于 90%", "建议改为 85%。");
  check("两条意见已创建", $$(".card").length === 2);
  // 修改该段文字
  const editor = $("#editor");
  editor.textContent = editor.textContent.replace("推荐准确率不低于 90%", "推荐准确率不低于 92%");
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(700);
  const statuses = $$(".card").map(c => ({
    orphan: !!c.querySelector(".b-orphan"), shifted: !!c.querySelector(".b-shifted")
  }));
  check("两条意见定位状态一致", statuses.every(s => s.orphan === statuses[0].orphan && s.shifted === statuses[0].shifted));
  check("两条意见均已更新（非旧位置）", statuses.every(s => s.orphan || s.shifted));

  // 需求6：失配意见手动重新绑定
  if (statuses[0].orphan) {
    const card = $$(".card")[0];
    card.querySelector(".actions").querySelectorAll("button");
    [...card.querySelectorAll(".actions button")].find(b => b.textContent === "重新绑定").click();
    await sleep(30);
    check("进入重新绑定模式", $("#rebindTip").style.display === "block");
    selectText("推荐准确率不低于 92%".replace("准确率", "准确率")); // 选中新文字
    selectText("推荐准确率不低于 92%");
    await sleep(30);
    const confirmBtn = [...$$(".card")[0].querySelectorAll(".actions button")].find(b => b.textContent === "确认绑定");
    check("出现确认绑定按钮", !!confirmBtn);
    confirmBtn.click();
    await sleep(50);
    check("重新绑定后恢复 ok", !$$(".card")[0].querySelector(".b-orphan"));
    check("绑定记录已写入讨论", $$(".card")[0].textContent.includes("重新绑定"));
  } else {
    // shifted 情况：直接验证 shifted 提示存在即可
    check("shifted 提示存在", $$(".b-shifted").length === 2);
  }

  // 需求4：采纳与待定
  const card2 = $$(".card")[1];
  [...card2.querySelectorAll(".actions button")].find(b => b.textContent === "采纳").click();
  await sleep(30);
  check("采纳成功", $$(".badge.b-accepted").length === 1);
  const card1 = $$(".card")[0];
  [...card1.querySelectorAll(".actions button")].find(b => b.textContent === "待定").click();
  await sleep(30);
  check("待定成功", $$(".badge.b-deferred").length === 1);
  check("进度条更新", $("#progressFill").style.width === "50%");

  // 持久化
  const saved = JSON.parse(window.localStorage.getItem("docReviewWorkbench.v1"));
  check("已持久化到 localStorage", saved && saved.comments.length === 2);

  console.log("---", pass, "passed,", fail, "failed ---");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ERROR", e); process.exit(1); });