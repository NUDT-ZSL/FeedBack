import test from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/seed.js";
import { CANDIDATE_THRESHOLD, deriveGraph, inferCandidates } from "../src/graph.js";
import {
  addLink,
  deprecateEntry,
  mergeEntry,
  reconfirmLink,
  rewriteEntry,
  setCandidateDecision
} from "../src/revisions.js";

const at = index => `2026-09-${20 + index}T08:00:00.000Z`;

test("推断关联给出可读理由，而不是只返回分数", () => {
  const state = seedState();
  const candidates = inferCandidates(state);
  assert.ok(candidates.length > 0);
  for (const candidate of candidates) {
    assert.ok(candidate.score >= CANDIDATE_THRESHOLD);
    assert.ok(candidate.reasons.some(reason => reason.includes("标签") || reason.includes("正文")));
  }
});

test("显式双向矛盾会同时保留并生成冲突", () => {
  const graph = deriveGraph(seedState());
  const conflict = graph.conflicts.find(item => item.pair.join("|") === "E004|E005");
  assert.ok(conflict);
  assert.equal(conflict.edgeIds.length, 2);
  assert.match(conflict.reason, /细化|矛盾/);
  assert.ok(graph.edges.every(edge => !edge.id.includes("link003") || edge.status !== "discarded"));
});

test("改写后关联进入待复核，人工复核可恢复有效", () => {
  let state = seedState();
  state = rewriteEntry(state, "E001", {
    title: "支付接口幂等防重",
    body: `${state.entries[0].body}\n补充：灰度发布时也要复用同一个幂等键。`,
    tags: state.entries[0].tags,
    note: "补充灰度要求"
  }, at(1)).state;

  let edge = deriveGraph(state).edges.find(edge => edge.id === "link001");
  assert.equal(edge.status, "needs_review");
  assert.match(edge.warnings[0], /修订/);

  state = reconfirmLink(state, "link001", at(2)).state;
  edge = deriveGraph(state).edges.find(edge => edge.id === "link001");
  assert.equal(edge.status, "active");
});

test("废弃会同步标记受影响关系和替代承接关系", () => {
  const state = deprecateEntry(seedState(), "E001", {
    reason: "旧策略停用",
    supersededBy: "E007"
  }, at(1)).state;
  const graph = deriveGraph(state);
  const support = graph.edges.find(edge => edge.id === "link001");
  const replacement = graph.edges.find(edge =>
    edge.source === "E001" && edge.target === "E007" && edge.relation === "supersedes"
  );
  assert.equal(support.status, "invalid");
  assert.equal(replacement.status, "needs_review");
});

test("合并保留源条目历史并把原关联标记为需复核", () => {
  const result = mergeEntry(seedState(), "E002", "E001", {
    note: "回调经验并入口径"
  }, at(1));
  const graph = deriveGraph(result.state);
  const source = result.state.entries.find(entry => entry.id === "E002");
  assert.equal(source.status, "merged");
  assert.equal(source.mergedInto, "E001");
  assert.equal(graph.edges.find(edge => edge.id === "link002").status, "needs_review");
  assert.ok(graph.edges.some(edge => edge.relation === "merges_into"));
});

test("确认或否决的结果在未实质变化时保持稳定", () => {
  let state = seedState();
  const [candidate] = inferCandidates(state);
  assert.ok(candidate);
  state = setCandidateDecision(state, candidate.pair, "confirmed", at(1)).state;
  assert.equal(inferCandidates(state).some(item => item.pair.join("|") === candidate.pair.join("|")), false);
  assert.ok(deriveGraph(state).edges.some(edge => edge.origin === "decision"));

  state = setCandidateDecision(state, candidate.pair, "rejected", at(2)).state;
  assert.equal(inferCandidates(state).length, inferCandidates(seedState())
    .filter(item => item.pair.join("|") !== candidate.pair.join("|")).length);
});

test("人工确认关联能容忍轻微改写，但证据实质消失时要求重新确认", () => {
  const pair = ["E001", "E007"];
  let state = setCandidateDecision(seedState(), pair, "confirmed", at(1)).state;

  state = rewriteEntry(state, "E001", {
    title: "支付接口幂等防重",
    body: `${state.entries[0].body}\n补充：值班人员应在发布记录中备注幂等键核对结果。`,
    tags: state.entries[0].tags,
    note: "补充发布流程备注"
  }, at(2)).state;
  let graph = deriveGraph(state);
  assert.equal(graph.candidates.some(candidate => candidate.pair.join("|") === pair.join("|")), false);
  assert.equal(graph.edges.some(edge => edge.origin === "decision" && edge.status === "active"), true);

  state = rewriteEntry(state, "E001", {
    title: "前端静态资源缓存策略",
    body: "前端发布静态资源时使用内容哈希命名，并通过 CDN 缓存预热降低回源流量。旧资源保留七天，灰度期间允许快速回滚。",
    tags: ["前端", "CDN", "缓存"],
    note: "改写为完全不同的主题"
  }, at(3)).state;
  graph = deriveGraph(state);
  assert.equal(graph.edges.some(edge => edge.origin === "decision" && edge.status === "needs_review"), true);
  assert.ok(graph.candidates.some(candidate =>
    candidate.pair.join("|") === pair.join("|") &&
    candidate.reasons[0].includes("曾被确认")
  ));
});

test("建立显式关系不会覆盖同一对条目的反向关系", () => {
  const base = seedState();
  const state = addLink(base, {
    source: "E003",
    target: "E002",
    relation: "contradicts",
    note: "测试新增反向矛盾"
  }, at(1)).state;
  const graph = deriveGraph(state);
  assert.ok(graph.edges.some(edge => edge.source === "E002" && edge.target === "E003" && edge.relation === "supports"));
  assert.ok(graph.edges.some(edge => edge.source === "E003" && edge.target === "E002" && edge.relation === "contradicts"));
  assert.ok(graph.conflicts.some(conflict => conflict.pair.join("|") === "E002|E003"));
});

test("方向相反但语义一致的替代与并入关系不会被误报为冲突", () => {
  const base = mergeEntry(seedState(), "E003", "E001", {}, at(1)).state;
  const withSupersede = addLink(base, {
    source: "E001",
    target: "E003",
    relation: "supersedes",
    note: "目标条目承接源条目"
  }, at(2)).state;
  const graph = deriveGraph(withSupersede);
  assert.ok(graph.edges.some(edge => edge.source === "E003" && edge.target === "E001" && edge.relation === "merges_into"));
  assert.ok(graph.edges.some(edge => edge.source === "E001" && edge.target === "E003" && edge.relation === "supersedes"));
  assert.equal(graph.conflicts.some(conflict => conflict.pair.join("|") === "E001|E003"), false);
});
