import assert from "node:assert/strict";
import { test } from "node:test";
import { findRelated, parseTags } from "./core.js";

let sequence = 0;
function note(title, tags, body) {
  sequence += 1;
  return {
    id: `n${sequence}`,
    title,
    tags,
    body,
    createdAt: sequence,
    updatedAt: sequence
  };
}

test("标签分隔符会被规范化，且标签去重但保留大小写", () => {
  assert.deepEqual(parseTags("项目管理, 复盘；知识管理、本地 软件  项目管理"), [
    "项目管理", "复盘", "知识管理", "本地", "软件"
  ]);
});

test("关联结果说明共同标签和文本线索，并按分数排序", () => {
  const source = note("知识工具需求", ["产品设计", "知识管理"], "需要展示双向链接的关联理由");
  const tagAndText = note("关联可解释", ["知识管理"], "每条双向链接都要给出关联理由");
  const onlyText = note("另一个想法", ["阅读"], "我在思考双向链接和关联理由的价值");
  const unrelated = note("跑步", ["健康"], "今晚五公里，心率稳定");

  const result = findRelated([source, tagAndText, onlyText, unrelated], source.id);
  assert.deepEqual(result.map((item) => item.id), [tagAndText.id, onlyText.id]);
  assert.equal(result[0].tagClues[0].value, "知识管理");
  assert.ok(result[0].textClues.some((clue) => clue.value === "关联理由"));
  assert.equal(result.find((item) => item.id === unrelated.id), undefined);
});

test("删除共同标签后旧关联立即消失，没有缓存旧判断", () => {
  const source = note("初稿", ["复盘"], "项目会议记录");
  const target = note("补充", ["复盘"], "另一份项目材料");
  assert.equal(findRelated([source, target], source.id).length, 1);

  target.tags = [];
  target.body = "一份完全不同的采购清单";
  target.updatedAt = 2;
  assert.deepEqual(findRelated([source, target], source.id), []);
});

test("最长中文共享短语只作为一条明确线索，避免重叠片段重复计分", () => {
  const source = note("复盘", [], "个人知识工具的关联解释需要清楚");
  const target = note("设计", [], "个人知识工具的关联解释应该可见");
  const result = findRelated([source, target], source.id);

  assert.equal(result.length, 1);
  assert.ok(result[0].textClues.some((clue) => clue.value === "个人知识工具"));
  assert.ok(!result[0].textClues.some((clue) => clue.value === "人知"));
});

test("没有共同标签且只有泛化日常词语时明确保持孤立", () => {
  const source = note("计划", [], "我现在需要记录一下这个事情");
  const target = note("杂记", [], "你现在知道这个事情以后再说");
  assert.deepEqual(findRelated([source, target], source.id), []);
});

test("只有一条笔记时不会产生自连", () => {
  const only = note("唯一笔记", ["测试"], "内容");
  assert.deepEqual(findRelated([only], only.id), []);
});
