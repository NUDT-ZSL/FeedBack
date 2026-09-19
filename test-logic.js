// 无头逻辑测试：打桩 DOM 后加载 app.js，验证血缘/对比/失效/撤销逻辑
const fs = require("fs");
const stubs = {};
function mkEl(id) {
  return { id, innerHTML: "", textContent: "", value: "", style: {},
    dataset: {}, addEventListener() {}, querySelectorAll() { return []; }, click() {} };
}
global.document = {
  getElementById(id) { return stubs[id] || (stubs[id] = mkEl(id)); },
  createElement() { return mkEl("a"); },
};
global.localStorage = { getItem() { return null; }, setItem() {} };
global.alert = () => {};
global.URL = { createObjectURL: () => "", revokeObjectURL: () => {} };
global.Blob = class {};
(0, eval)(fs.readFileSync("app.js", "utf8") + "\n;globalThis.__api = { state, computeCompare, getCompare, saveRecord, retractRecord, acceptSuggestedParent, pairKey };")
const { state, computeCompare, getCompare, saveRecord, retractRecord, acceptSuggestedParent, pairKey } = globalThis.__api;

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + "  期望 " + e + "  实际 " + a); }
}

// 1. 问题检测：v10 父缺失；v11<->v12 闭环
eq(state.problems.missing.map(m => m.id), ["v10"], "缺失父版本检测");
eq(state.problems.cycles.map(c => [...c].sort()), [["v11", "v12"]], "闭环检测");

// 2. 分叉点与差异依据
const r1 = computeCompare("v7", "v8");
eq(r1.fork, "v2", "v7 vs v8 分叉点");
eq(r1.pathA.map(r => r.id), ["v3", "v5", "v7"], "v7 侧路径");
eq(r1.pathB.map(r => r.id), ["v4", "v6", "v8"], "v8 侧路径");
eq([...r1.basis].sort(), ["v2", "v3", "v4", "v5", "v6", "v7", "v8"], "差异依据版本");

// 3. 缓存与精准失效：修正 v3 摘要只影响依据含 v3 的结论
getCompare("v7", "v8");           // 依据含 v3
getCompare("v8", "v6");           // 依据 v2,v4,v6,v8 不含 v3
getCompare("v9", "v8");           // 依据含 v3
eq(state.cache.size, 3, "缓存条数");
document.getElementById("fId").value = "v3"; document.getElementById("fParent").value = "v2";
document.getElementById("fAuthor").value = "林然"; document.getElementById("fTime").value = "2026-08-05 10:02";
document.getElementById("fSummary").value = "修订第一章措辞（修正版）";
saveRecord();
eq(state.lastInvalidation.updated, 2, "修正摘要后失效条数");
eq(state.lastInvalidation.kept, 1, "修正摘要后保留条数");
eq(state.cache.has(pairKey("v8", "v6")), true, "无关结论保持");

// 4. 撤销有后代的版本：v5 撤销 -> v7 待处理，建议父版本 v3
retractRecord("v5");
eq(state.records.get("v5").retracted, true, "v5 已撤销");
eq(state.records.get("v7").pending, true, "v7 待处理");
eq(state.records.get("v7").suggestedParent, "v3", "v7 建议新父版本");
const r2 = computeCompare("v7", "v8");
eq(r2.pathA.map(r => r.id), ["v3", "v7"], "撤销后路径跳过已撤销版本");

// 5. 接受建议父版本，待处理清除
acceptSuggestedParent("v7");
eq(state.records.get("v7").parent, "v3", "v7 重接父版本");
eq(state.records.get("v7").pending, false, "v7 待处理已清除");

// 6. 环参与对比不崩溃
const rc = computeCompare("v11", "v1");
eq(rc === null || typeof rc.fork === "string", true, "环参与对比不崩溃");

console.log(pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);