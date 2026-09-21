/* smoke.js — 用最小 DOM 桩在 Node 中冒烟测试 app.js 的完整交互链路。 */
"use strict";
const assert = require("assert");

class El {
  constructor(tag) {
    this.tagName = tag || "div";
    this.children = [];
    this.listeners = {};
    this.classSet = new Set();
    this.textContent = "";
    this.value = "";
    this.id = "";
  }
  set className(v) { this.classSet = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classSet].join(" "); }
  get classList() {
    const s = this.classSet;
    return {
      add: (c) => s.add(c),
      remove: (c) => s.delete(c),
      contains: (c) => s.has(c),
    };
  }
  set innerHTML(v) { if (v === "") this.children = []; this.textContent = ""; }
  get innerHTML() { return ""; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  dispatch(ev, arg) { (this.listeners[ev] || []).forEach((f) => f(arg || { preventDefault() {} })); }
  click() { this.dispatch("click"); }
  reset() { for (const k of Object.keys(ids)) if (this.id === k) break; }
  // 深度收集文本，便于断言
  deepText() {
    return this.textContent + this.children.map((c) => c.deepText()).join("|");
  }
}

const ids = {};
for (const id of [
  "note-form", "f-title", "f-tags", "f-text", "note-count", "note-list",
  "breadcrumb", "btn-back", "crumb-path", "detail-empty", "detail",
  "d-title", "d-tags", "d-text", "edit-box", "edit-form",
  "e-title", "e-tags", "e-text", "btn-delete", "related",
]) {
  const el = new El("div");
  el.id = id;
  ids[id] = el;
}
ids["note-form"].reset = function () {
  ids["f-title"].value = ""; ids["f-tags"].value = ""; ids["f-text"].value = "";
};

global.document = {
  getElementById: (id) => ids[id] || null,
  createElement: (tag) => new El(tag),
};
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
global.confirm = () => true;
global.Relations = require("./relations.js");

require("./app.js");

function addNote(title, tags, text) {
  ids["f-title"].value = title;
  ids["f-tags"].value = tags;
  ids["f-text"].value = text;
  ids["note-form"].dispatch("submit");
}

// 1. 录入后立即出现在列表
addNote("卡片笔记法", "读书, 方法论", "卢曼的卡片盒笔记方法，强调知识网络");
assert.strictEqual(ids["note-list"].children.length, 1, "录入后列表应立刻出现该笔记");
assert.ok(!ids["detail"].classList.contains("hidden"), "录入后应直接展示详情");

// 2/3. 关联展示与理由
addNote("双链笔记", "方法论", "双链笔记让知识网络逐渐生长");
addNote("麻婆豆腐", "烹饪", "勾芡与火候的技巧");
ids["note-list"].children[0].click(); // 选中“卡片笔记法”
assert.strictEqual(ids["related"].children.length, 1, "应只有 1 条相关笔记");
const reasonText = ids["related"].children[0].deepText();
assert.ok(reasonText.includes("共同标签"), "理由应指出共同标签");
assert.ok(reasonText.includes("文本线索"), "理由应指出文本线索");

// 5. 沿关联跳转并可回退
ids["related"].children[0].click();
assert.strictEqual(ids["d-title"].textContent, "双链笔记", "应跳到关联笔记");
assert.ok(!ids["breadcrumb"].classList.contains("hidden"), "应显示浏览线索");
assert.ok(ids["crumb-path"].textContent.includes("卡片笔记法"), "线索应包含来路");
ids["btn-back"].click();
assert.strictEqual(ids["d-title"].textContent, "卡片笔记法", "回退应返回来路");

// 4. 修改标签/文本后旧关联立即失效
ids["e-title"].value = "卡片笔记法";
ids["e-tags"].value = "读书";
ids["e-text"].value = "完全无关的新内容，关于园艺和浇水";
ids["edit-form"].dispatch("submit");
assert.strictEqual(ids["related"].children.length, 1);

// 6. 孤立提示
assert.ok(
  ids["related"].children[0].deepText().includes("孤立"),
  "无关联时必须明确提示孤立"
);
ids["note-list"].children[2].click(); // 麻婆豆腐
assert.ok(ids["related"].children[0].deepText().includes("孤立"), "麻婆豆腐应孤立");

// 删除后列表收缩
ids["btn-delete"].click();
assert.strictEqual(ids["note-list"].children.length, 2, "删除后列表应减少一条");

console.log("冒烟测试通过");
