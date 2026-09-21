/* 界面冒烟测试：用迷你 DOM 桩加载 app.js，验证渲染与交互链路。
 * 运行：node test-ui.js */
"use strict";
let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log("  PASS " + name); }
  else { failed++; console.log("  FAIL " + name); }
}
/* —— 迷你 DOM —— */
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = {};
    this._innerHTML = ""; this.textContent = ""; this.className = "";
    this.listeners = {}; this.value = ""; this.checked = false; this.hidden = false;
  }
  set innerHTML(v) { this._innerHTML = v; this.children = []; }
  get innerHTML() { return this._innerHTML; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type, ev) { (this.listeners[type] || []).forEach(fn => fn(ev)); }
  closest() { return null; }
  click() {}
}
const registry = {};
function el(id) { return registry[id] || (registry[id] = Object.assign(new El("div"), { id })); }
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
global.window = { ValueEngine: require("./engine.js") };
global.document = {
  getElementById: el,
  createElement: t => new El(t),
};
global.alert = () => {}; global.confirm = () => true;
global.location = { hash: "" };
/* —— 加载应用（会执行启动流程：整体重推 + 渲染） —— */
require("./app.js");
console.log("[UI-1] 启动渲染");
ok(el("consistencyBadge").textContent.indexOf("✓") >= 0, "一致性徽标显示 增量=整体");
ok(el("assetList").children.length === 3, "资产列表渲染 3 项示例资产");
ok(el("detailPanel").innerHTML.indexOf("数控机床") >= 0, "默认选中第一项资产并渲染详情");
ok(el("detailPanel").innerHTML.indexOf("价值曲线") >= 0, "价值曲线卡片存在");
ok(el("detailPanel").innerHTML.indexOf("<svg") >= 0, "SVG 曲线已生成");
ok(el("detailPanel").innerHTML.indexOf("处置损益") >= 0, "处置损益面板存在");
console.log("[UI-2] 冲突展示与裁决");
el("assetList").children[1].onclick();          // 选中“运输货车”
let html = el("detailPanel").innerHTML;
ok(html.indexOf("冲突 1 处") >= 0, "冲突资产显示冲突徽标");
ok(html.indexOf("已全部保留") >= 0, "冲突提示：全部来源保留");
ok(html.indexOf("结论不可信") >= 0, "冲突未裁决时结论不可信");
ok((html.match(/conflict-row/g) || []).length >= 2, "冲突行高亮");
// 裁决：排除 J3（评估机构初稿）
el("detailPanel").fire("change", { target: {
  dataset: { action: "toggleExcluded", id: "J3" }, checked: true } });
html = el("detailPanel").innerHTML;
ok(html.indexOf("冲突 1 处") < 0, "裁决后冲突徽标消失");
ok(html.indexOf("结论可信") >= 0, "裁决后结论恢复可信");
ok(html.indexOf("已排除") >= 0, "被排除调整保留记录并标记");
ok(el("consistencyBadge").textContent.indexOf("✓") >= 0, "裁决后增量重推仍与整体一致");
console.log("[UI-3] 数据不足与新增调整");
el("assetList").children[2].onclick();          // 选中“实验设备（资料不全）”
html = el("detailPanel").innerHTML;
ok(html.indexOf("缺少残值预期") >= 0, "缺残值资产标出原因");
ok(html.indexOf("无法推导") >= 0, "数据不足时给出不可推导结论");
// 给该资产补充残值并添加一条调整
el("detailPanel").fire("change", { target: { dataset: { f: "salvage" }, value: "3000" } });
html = el("detailPanel").innerHTML;
ok(html.indexOf("结论可信") >= 0, "补齐残值后结论转为可信");
el("adjTime").value = "2026-08";
el("adjType").value = "impairment";
el("adjAmount").value = "5000";
el("adjPending").checked = true;
el("adjNote").value = "";
el("detailPanel").fire("click", { target: {
  closest: () => ({ dataset: { action: "addAdj" } }) } });
html = el("detailPanel").innerHTML;
ok(html.indexOf("待核实") >= 0, "新增待核实调整立即体现在界面");
ok(html.indexOf("含待核实调整") >= 0, "待核实徽标出现");
ok(el("consistencyBadge").textContent.indexOf("✓") >= 0, "新增调整后一致性保持");
console.log("");
console.log("通过 " + passed + " 项，失败 " + failed + " 项");
process.exit(failed ? 1 : 0);
