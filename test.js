/* test.js — 用 Node 内置 assert 验证关联引擎，覆盖需求 1/2/3/4/6 的核心逻辑。 */
"use strict";
const assert = require("assert");
const Relations = require("./relations.js");

function note(id, title, tags, text) {
  return { id, title, tags, text };
}

// --- 需求 1：录入后立即可参与关联计算 ---
{
  const notes = [note("a", "卡片笔记法", ["读书"], "卢曼的卡片盒笔记方法")];
  const rel = Relations.computeRelations(notes);
  assert.ok(rel.has("a"), "新笔记必须出现在结果里");
  assert.deepStrictEqual(rel.get("a"), [], "单条笔记没有关联");
}

// --- 需求 2：关联按相关程度从高到低排列 ---
{
  const notes = [
    note("a", "目标", ["方法", "复盘"], "如何复盘项目并沉淀方法论与经验"),
    note("b", "强相关", ["方法", "复盘"], "复盘项目并沉淀方法论与经验的清单"),
    note("c", "弱相关", ["方法"], "完全不同的内容，关于烹饪和旅行"),
    note("d", "不相关", ["烹饪"], "红烧肉的做法与火候掌握"),
  ];
  const rel = Relations.computeRelations(notes).get("a");
  assert.strictEqual(rel.length, 2, "a 只应与 b、c 相连，不应误连 d");
  assert.strictEqual(rel[0].id, "b", "共享标签更多、文本更接近的 b 应排第一");
  assert.ok(rel[0].score > rel[1].score, "分数必须严格降序");
}

// --- 需求 3：每条关联必须给出理由 ---
{
  const notes = [
    note("a", "甲", ["写作", "知识管理"], "双链笔记让知识网络逐渐生长"),
    note("b", "乙", ["写作"], "双链笔记与知识网络的关系"),
  ];
  const rel = Relations.computeRelations(notes).get("a");
  assert.strictEqual(rel.length, 1);
  const reasons = rel[0].reasons;
  assert.deepStrictEqual(reasons.tags, ["写作"], "理由要指出共同标签");
  assert.ok(reasons.keywords.length > 0, "理由要指出文本线索词");
  assert.ok(
    reasons.keywords.includes("双链") || reasons.keywords.includes("笔记"),
    "文本线索应包含两条笔记共有的实义词"
  );
}

// --- 需求 4：修改标签或文本后，旧关联不得保留 ---
{
  let notes = [
    note("a", "甲", ["健身"], "深蹲与硬拉的训练计划"),
    note("b", "乙", ["健身"], "训练计划与恢复安排"),
  ];
  assert.strictEqual(Relations.computeRelations(notes).get("a").length, 1);

  // 用户改掉 a 的标签和文本后，重新计算，旧的“健身”关联必须消失
  notes = [
    note("a", "甲", ["烘焙"], "sourdough 面包的发酵时间"),
    notes[1],
  ];
  const rel = Relations.computeRelations(notes).get("a");
  assert.strictEqual(rel.length, 0, "修改后旧关联必须失效");
}

// --- 需求 6：无关联的笔记应被判定为孤立（空结果，由界面明确提示）---
{
  const notes = [
    note("a", "甲", ["天文"], "猎户座星云观测记录"),
    note("b", "乙", ["烹饪"], "麻婆豆腐的勾芡技巧"),
    note("c", "丙", ["天文"], "猎户座大星云摄影参数"),
  ];
  const all = Relations.computeRelations(notes);
  assert.strictEqual(all.get("b").length, 0, "b 没有任何关联，是孤立笔记");
  assert.strictEqual(all.get("a").length, 1, "a 与 c 通过标签和文本相连");
  assert.strictEqual(all.get("a")[0].id, "c");
}

// --- 文本线索不应把停用词当成关联理由 ---
{
  const notes = [
    note("a", "甲", [], "我们今天去了公园"),
    note("b", "乙", [], "他们明天去了超市"),
  ];
  const rel = Relations.computeRelations(notes).get("a");
  assert.strictEqual(rel.length, 0, "仅共享“了/去”等停用字不得建立关联");
}

console.log("全部测试通过");
