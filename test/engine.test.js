const assert = require("assert");
const E = require("../engine.js");

function scheme() {
  return E.defaultScheme();
}

// 1. 权重一致性
{
  const s = scheme();
  const r = E.computeResult(s, {});
  assert.strictEqual(r.weightSum, 100);
  assert.strictEqual(r.weightConsistent, true);
}

// 2. 总分 = 各维度贡献之和；满分得 100
{
  const s = scheme();
  const scores = {};
  for (const d of s.dimensions) scores[d.id] = 100;
  const r = E.computeResult(s, scores);
  assert.strictEqual(r.total, 100);
  assert.strictEqual(r.grade, "A 优秀");
}

// 3. 缺分策略：default 用缺省分计入
{
  const s = scheme();
  const r = E.computeResult(s, { tech: 100 }); // 其余缺分，默认策略 default=70
  const tech = r.dimensions.find((d) => d.id === "tech");
  const comm = r.dimensions.find((d) => d.id === "comm");
  assert.strictEqual(tech.contribution, 30);
  assert.strictEqual(comm.missing, true);
  assert.strictEqual(comm.effectiveScore, 70);
  assert.strictEqual(comm.contribution, 14); // 70 * 20%
  assert.strictEqual(r.total, 30 + 14 * 3 + 7); // tech + 3 个 20% 维 + 10% 维
}

// 4. 缺分策略：zero 按 0 计
{
  const s = scheme();
  s.dimensions.find((d) => d.id === "comm").missingStrategy = "zero";
  const r = E.computeResult(s, { tech: 100 });
  const comm = r.dimensions.find((d) => d.id === "comm");
  assert.strictEqual(comm.contribution, 0);
  assert.strictEqual(comm.strategyLabel, "缺分按 0 计");
}

// 5. 缺分策略：exclude 剔除并归一化权重
{
  const s = scheme();
  s.dimensions.find((d) => d.id === "comm").missingStrategy = "exclude";
  const scores = { tech: 100, team: 100, deliver: 100, attitude: 100 };
  const r = E.computeResult(s, scores);
  const comm = r.dimensions.find((d) => d.id === "comm");
  assert.strictEqual(comm.excluded, true);
  assert.strictEqual(comm.contribution, 0);
  assert.strictEqual(r.total, 100); // 剩余维度全满分，归一化后仍 100
  const tech = r.dimensions.find((d) => d.id === "tech");
  assert.strictEqual(tech.effectiveWeight, 37.5); // 30/80
}

// 6. 权重不一致时提示且按归一化计算
{
  const s = scheme();
  s.dimensions.find((d) => d.id === "tech").weight = 60; // 总和 130
  const scores = {};
  for (const d of s.dimensions) scores[d.id] = 100;
  const r = E.computeResult(s, scores);
  assert.strictEqual(r.weightConsistent, false);
  assert.strictEqual(r.total, 100);
}

// 7. 等级边界：权重调整跨越边界时检测到变化
{
  const s = scheme();
  const scores = { tech: 100, comm: 60, team: 60, deliver: 60, attitude: 60 };
  const before = E.computeResult(s, scores);
  // before: 30 + 12*3 + 6 = 72 -> C 合格
  assert.strictEqual(before.total, 72);
  assert.strictEqual(before.grade, "C 合格");
  s.dimensions.find((d) => d.id === "tech").weight = 70;
  s.dimensions.find((d) => d.id === "comm").weight = 10;
  s.dimensions.find((d) => d.id === "team").weight = 10;
  s.dimensions.find((d) => d.id === "deliver").weight = 5;
  s.dimensions.find((d) => d.id === "attitude").weight = 5;
  const after = E.computeResult(s, scores);
  // after: 70 + 6+6+3+3 = 88 -> B 良好
  assert.strictEqual(after.total, 88);
  const change = E.detectGradeChange(before, after);
  assert.ok(change);
  assert.strictEqual(change.from, "C 合格");
  assert.strictEqual(change.to, "B 良好");
}

// 8. 评价依据包含拉高/拉低/降级触发/缺分说明
{
  const s = scheme();
  s.dimensions.find((d) => d.id === "attitude").missingStrategy = "exclude";
  const scores = { tech: 95, comm: 40, team: 80, deliver: 70 };
  const r = E.computeResult(s, scores);
  const ex = E.buildExplanation(s, r);
  const text = ex.lines.join("\n");
  assert.ok(text.includes("拉高结果的维度"));
  assert.ok(text.includes("拉低结果的维度"));
  assert.ok(text.includes("触发降级的关键维度")); // comm=40 落在最低档
  assert.ok(text.includes("缺分")); // attitude 被剔除
  assert.ok(ex.downgradeTriggers.includes("沟通表达"));
}

console.log("All engine tests passed.");
