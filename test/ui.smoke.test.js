/* 界面级冒烟测试：用 jsdom 启动工作台，验证实时重算与等级变化对照。 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
const { window } = dom;

for (const src of ["engine.js", "app.js"]) {
  window.eval(fs.readFileSync(path.join(__dirname, "..", src), "utf8"));
}

const $ = (id) => window.document.getElementById(id);

// 1. 启动后直接显示工作台：学员、总分、等级、依据
assert.strictEqual($("studentSelect").options.length >= 2, true, "应有预置学员");
assert.notStrictEqual($("totalScore").textContent, "--", "应显示总分");
assert.notStrictEqual($("totalGrade").textContent, "--", "应显示等级");
assert.ok($("explanationList").children.length > 0, "应有评价依据");
assert.strictEqual($("weightSum").textContent, "100", "默认权重合计应为 100");

// 2. 张三：88/72/90/65/95 -> 30*.88+20*.72+20*.9+20*.65+10*.95 = 26.4+14.4+18+13+9.5=81.3
assert.strictEqual($("totalScore").textContent, "81.3");
assert.strictEqual($("totalGrade").textContent, "B 良好");

// 3. 缺分维度标记：李四 comm 缺分，切到李四
$("studentSelect").value = "s2";
$("studentSelect").dispatchEvent(new window.Event("change"));
assert.ok($("scoreRows").textContent.includes("缺分"), "应标出缺分维度");
assert.ok($("explanationList").textContent.includes("缺分"), "依据中应说明缺分影响");

// 4. 调整分数实时重算：给李四技术能力打 100
const techInput = window.document.querySelector('[data-focus-key="score-tech"]');
techInput.value = "100";
techInput.dispatchEvent(new window.Event("input"));
// 李四: tech=100, comm缺省70, team=55, deliver=70, attitude=80
// 30 + 14 + 11 + 14 + 8 = 77
assert.strictEqual($("totalScore").textContent, "77");

// 5. 调整权重导致等级跨越边界 -> 出现提示并记录对照
// 当前 77 (C 合格)。把 tech 权重调到 60，其余按比例降低使总分上升。
const setWeight = (dimId, v) => {
  const input = window.document.querySelector(`[data-focus-key="weight-${dimId}"]`);
  input.value = String(v);
  input.dispatchEvent(new window.Event("input"));
};
setWeight("tech", 90);
setWeight("comm", 4);
setWeight("team", 2);
setWeight("deliver", 2);
setWeight("attitude", 2);
// 90 + 2.8 + 1.1 + 1.4 + 1.6 = 96.9 -> A 优秀，跨越边界
assert.strictEqual($("totalScore").textContent, "96.9");
assert.strictEqual($("totalGrade").textContent, "A 优秀");
assert.ok(!$("gradeChangeBanner").classList.contains("hidden"), "应显示等级变化提示");
assert.ok($("gradeChangeBanner").textContent.includes("等级变化"));
assert.ok($("changeLog").textContent.includes("改动前"), "对照记录应包含改动前依据");
assert.ok($("changeLog").textContent.includes("改动后"), "对照记录应包含改动后依据");

// 6. 权重不一致提示与归一化
setWeight("tech", 95); // 合计 105
assert.ok($("weightStatus").textContent.includes("不一致"));
assert.ok(!$("normalizeBtn").classList.contains("hidden"));
$("normalizeBtn").dispatchEvent(new window.Event("click"));
assert.strictEqual($("weightSum").textContent, "100");

// 7. 添加学员
$("newStudentName").value = "王五";
$("addStudentBtn").dispatchEvent(new window.Event("click"));
assert.strictEqual($("studentSelect").options.length, 3);

console.log("All UI smoke tests passed.");
