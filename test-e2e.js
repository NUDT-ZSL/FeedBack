const fs = require("fs");
const { JSDOM } = require(require("path").join(process.env.TEMP, "jsdom-env", "node_modules", "jsdom"));

const html = fs.readFileSync("index.html", "utf8");
const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  beforeParse(window) {
    // jsdom 缺口补钉
    if (!Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "innerText")) {
      Object.defineProperty(window.HTMLElement.prototype, "innerText", {
        get() { return this.textContent; },
        set(v) { this.textContent = v; }
      });
    }
    window.HTMLElement.prototype.scrollIntoView = function () {};
  }
});
const { window } = dom;
const { document } = window;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } }

function selectText(sub) {
  const editor = $("#editor");
  const full = editor.textContent;
  const i = full.indexOf(sub);
  const walker = document.createTreeWalker(editor, window.NodeFilter.SHOW_TEXT);
  let node, acc = 0, startNode, startOff, endNode, endOff;
  while ((node = walker.nextNode())) {
    const s = acc, e = acc + node.data.length;
    if (startNode === undefined && i >= s && i <= e) { startNode = node; startOff = i - s; }
    if (i + sub.length >= s && i + sub.length <= e) { endNode = node; endOff = i + sub.length - s; }
    acc = e;
  }
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new window.Event("selectionchange"));
}

(async () => {
  await sleep(100);
  // 1. 初始渲染
  check("初始渲染文档", $("#editor").textContent.includes("产品需求文档"));
  check("初始无意见", $$(".card").length === 0);

  // 2. 选中文字新建意见
  selectText("跨时区智能推荐能力");
  check("出现新建按钮", $("#newCommentBar").style.display === "block");
  $("#createCommentBtn").click();
  await sleep(50);
  check("意见已创建", $$(".card").length === 1);
  // 填写首条内容
  const ta = $(".inline-form textarea");
  ta.value = "这里需要补充数据支撑。";
  $$(".inline-form button.ok")[0].click();
  await sleep(50);
  check("意见正文已保存", $$(".card")[0].textContent.includes("这里需要补充数据支撑"));
  check("状态为待处理", $$(".badge.b-open").length === 1);

  // 3. 追加讨论回复
  $$(".card button").find(b => b.textContent === "回复").click();
  await sleep(30);
  const ta2 = $(".inline-form textarea");
  ta2.value = "同意，我补充一组调研数据。";
  $$(".inline-form button.ok")[0].click();
  await sleep(30);
  check("回复已追加", $$(".card .reply").length === 1);

  // 4. 编辑文档（前文插入内容），意见应自动平移
  const editor = $("#editor");
  editor.textContent = "【2026年9月24日修订】\n" + editor.textContent;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(700);
  check("编辑后仍定位 ok", $$(".badge.b-orphan").length === 0);
  check("正文高亮已渲染", $("#editor mark.anchor-ok") !== null);

  // 5. 改写原文 -> shifted 或 orphan，且有可读原因
  editor.textContent = editor.textContent.replace("跨时区智能推荐能力", "跨时区的智能时间推荐引擎");
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(700);
  const shiftedOrOrphan = $$(".badge.b-shifted").length + $$(".badge.b-orphan").length;
  check("改写后标记失配/待确认", shiftedOrOrphan === 1);
  check("给出可读原因", $$(".orphan-reason").length >= 1);

  // 6. 删除原文 -> 失配
  editor.textContent = editor.textContent.replace("、日程冲突检测", "");
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(700);

  // 7. 驳回必须填理由
  $$(".card button").find(b => b.textContent === "驳回").click();
  await sleep(30);
  $$(".inline-form button.ok")[0].click(); // 空理由
  await sleep(30);
  check("空理由不能驳回", $$(".badge.b-rejected").length === 0);
  $(".inline-form textarea").value = "超出本期范围。";
  $$(".inline-form button.ok")[0].click();
  await sleep(30);
  check("驳回成功", $$(".badge.b-rejected").length === 1);
  check("驳回理由已显示", $$(".card")[0].textContent.includes("超出本期范围"));

  // 8. 汇总进度
  check("汇总进度更新", $("#summaryText").textContent.includes("已闭环 1/1"));

  // 9. 筛选失配/待处理清单
  const orphanBtn = $$(".filter-btn").find(b => b.textContent.startsWith("失配"));
  orphanBtn.click();
  await sleep(30);
  check("失配筛选可用", $("#filters").textContent.includes("失配"));
  $$(".filter-btn").find(b => b.textContent.startsWith("全部")).click();

  console.log("---", pass, "passed,", fail, "failed ---");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ERROR", e); process.exit(1); });