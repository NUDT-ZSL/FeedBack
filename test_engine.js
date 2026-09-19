// 冒烟测试：用最小 DOM 桩加载 app.js，验证引擎行为
const fs = require("fs");

function makeEl() {
  return {
    innerHTML: "", value: "", textContent: "",
    classList: { add() {}, remove() {} },
    addEventListener() {}, focus() {},
  };
}
const els = {};
global.document = {
  getElementById(id) { return els[id] || (els[id] = makeEl()); },
  body: { addEventListener() {} },
};
global.HTMLElement = function () {};

const api = eval(fs.readFileSync("app.js", "utf-8") +
  "\n;({ App, resolvePick, retractEdit, restoreEdit, submitEdit, rewriteEdit, resolveManual, verifyFromScratch })");
const { App, resolvePick, retractEdit, restoreEdit, submitEdit, rewriteEdit, resolveManual, verifyFromScratch } = api;

let failures = 0;
function check(name, cond) {
  console.log((cond ? "PASS" : "FAIL") + "  " + name);
  if (!cond) failures++;
}

// 1. 演示数据：S1 冲突保留，S2 单方合成，S3 基础内容
check("S1 冲突未决", App.derived.S1.conflictOpen === true && App.derived.S1.final === null);
check("S1 候选两方", App.derived.S1.candidates.length === 2);
check("S2 已合成", App.derived.S2.final === "预算：12 万元（追加测试费用）");
check("S2 来源", App.derived.S2.sources.join() === "编辑者丙");
check("S3 基础内容", App.derived.S3.final === "上线日期：待定");

// 2. 裁决：采纳一方
resolvePick("S1", 2);
check("S1 裁决后内容", App.derived.S1.final === "项目目标：直接发布 2.0 版本");
check("S1 裁决后无冲突", App.derived.S1.conflictOpen === false);

// 3. 撤回被采纳的修改 → 冲突消失，只剩另一方
retractEdit(2);
check("撤回后 S1 回落到另一方", App.derived.S1.final === "项目目标：发布 1.0 版本（含移动端）");
check("撤回后 S1 无冲突", App.derived.S1.conflictOpen === false);
check("S1 被标记重新推导", App.dirty.S1 === true);
check("S2/S3 未被误标", !App.dirty.S2 && !App.dirty.S3);

// 4. 非法修改：缺来源、指向不存在片段，均不影响其余内容
const before = JSON.stringify(App.derived);
submitEdit({ source: "", seq: 4, segmentId: "S2", content: "x" });
submitEdit({ source: "编辑者丁", seq: 5, segmentId: "S99", content: "y" });
check("非法修改未改变任何片段", JSON.stringify(App.derived) === before);
check("非法修改被标记", App.edits.filter(e => e.status === "invalid").length === 2);
check("日志含可读提示", App.log.some(l => l.msg.includes("缺少来源")) &&
                       App.log.some(l => l.msg.includes("不存在的片段")));

// 5. 改写：把非法修改改成合法，跨片段移动
const badEdit = App.edits.find(e => e.status === "invalid" && e.source === "编辑者丁");
rewriteEdit(badEdit.id, { source: "编辑者丁", seq: 5, segmentId: "S3", content: "上线日期：2026-10-01" });
check("改写后生效", App.derived.S3.final === "上线日期：2026-10-01");
check("S3 被标记重新推导", App.dirty.S3 === true);

// 6. 制造新冲突并手动改写裁决
submitEdit({ source: "编辑者戊", seq: 6, segmentId: "S3", content: "上线日期：2026-11-11" });
check("S3 出现冲突", App.derived.S3.conflictOpen === true);
resolveManual("S3", "上线日期：2026-10-15（折中）");
check("手动改写生效", App.derived.S3.final === "上线日期：2026-10-15（折中）");

// 7. 撤回全部 S3 修改 → 裁决自动清理，回到基础内容
App.edits.filter(e => e.segmentId === "S3" && e.status === "active")
         .forEach(e => retractEdit(e.id));
check("S3 回到基础内容", App.derived.S3.final === "上线日期：待定");
check("S3 裁决已清理", !App.resolutions.S3);

// 8. 从头校验：增量结果与全量重算一致
verifyFromScratch();
check("从头校验通过", App.log[0].msg.includes("从头校验通过"));

console.log(failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED");
process.exit(failures === 0 ? 0 : 1);