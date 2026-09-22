const test = require("node:test");
const assert = require("node:assert/strict");
const Analyzer = require("./src/analyzer");
const SampleData = require("./src/sample");

test("识别连续异常区段并计算时间范围和偏离程度", () => {
  const result = Analyzer.analyzeDataset(
    Analyzer.parseCsv(SampleData.metricsCsv()),
    Analyzer.parseCsv(SampleData.eventsCsv()),
  );
  const metric = result.metrics[0];
  assert.equal(metric.name, "订单量");
  assert.ok(metric.segments.length >= 4);
  const drop = metric.segments.find((seg) => seg.start === "2026-07-30");
  assert.equal(drop.end, "2026-08-01");
  assert.equal(drop.direction, "down");
  assert.ok(drop.peakDeviationPct <= -20);
  assert.ok(Math.abs(drop.peakZ) >= 8);
  assert.ok(drop.qualityFlags.some((flag) => flag.type === "missing_inside"));
  assert.ok(drop.qualityFlags.some((flag) => flag.type === "duplicate_conflict"));
});

test("根据历史关联和时间临近度排序候选原因并标记证据问题", () => {
  const result = Analyzer.analyzeDataset(
    Analyzer.parseCsv(SampleData.metricsCsv()),
    Analyzer.parseCsv(SampleData.eventsCsv()),
  );
  const drop = result.metrics[0].segments.find((seg) => seg.start === "2026-09-07");
  const names = drop.candidates.map((candidate) => candidate.eventType);
  assert.deepEqual(names[0], "服务发布");
  assert.ok(names.includes("极端天气"));
  assert.ok(names.includes("优惠券活动"));
  assert.ok(drop.candidates.find((c) => c.eventType === "极端天气").warnings.includes("证据不足"));
  assert.ok(drop.candidates.find((c) => c.eventType === "优惠券活动").warnings.includes("历史方向不一致"));
  assert.ok(drop.candidates.some((candidate) => candidate.warnings.includes("事件时间共线，需人工拆分")));
});

test("人工调权只重算当前区段并产生前后对比历史", () => {
  const result = Analyzer.analyzeDataset(
    Analyzer.parseCsv(SampleData.metricsCsv()),
    Analyzer.parseCsv(SampleData.eventsCsv()),
  );
  const metric = result.metrics[0];
  const target = metric.segments.find((seg) => seg.start === "2026-09-07");
  const other = metric.segments.find((seg) => seg.start === "2026-09-15");
  const beforeOther = JSON.parse(JSON.stringify(other.attribution));
  Analyzer.applyAdjustment(result, "订单量", target.id, "服务发布", "confirm", 1.5, "确认发布影响");
  assert.equal(target.attribution.primaryEventType, "服务发布");
  assert.equal(target.history.length, 1);
  assert.equal(target.history[0].before.primaryEventType, "服务发布");
  assert.equal(target.history[0].after.primaryEventType, "服务发布");
  assert.ok(target.attribution.confidence > target.history[0].before.confidence);
  assert.deepEqual(other.attribution, beforeOther);

  Analyzer.applyAdjustment(result, "订单量", target.id, "服务发布", "exclude", 1, "排除发布");
  assert.equal(target.attribution.primaryEventType, "优惠券活动");
  assert.equal(target.history.length, 2);
  Analyzer.applyAdjustment(result, "订单量", target.id, "服务发布", "reset", 1, "恢复自动");
  const restored = target.candidates.find((candidate) => candidate.eventType === "服务发布");
  assert.equal(restored.status, "auto");
  assert.equal(restored.weight, 1);
  assert.equal(target.attribution.primaryEventType, "服务发布");
});

test("明确提示缺失和完全重复事件的处理方式", () => {
  const result = Analyzer.analyzeDataset(
    Analyzer.parseCsv(SampleData.metricsCsv()),
    Analyzer.parseCsv(SampleData.eventsCsv()),
  );
  const messages = result.issues.map((issue) => issue.message).join("\n");
  assert.match(messages, /缺失/);
  assert.match(messages, /重复上报/);
  assert.match(messages, /事件为完全重复/);
});

test("CSV 解析支持引号、逗号和空白缺失值", () => {
  const rows = Analyzer.parseCsv('date,value\n2026-01-01,"1,234"\n2026-01-02,\n');
  assert.equal(Analyzer.parseNumber(rows[0].value), 1234);
  assert.equal(Analyzer.parseNumber(rows[1].value), null);
  assert.equal(Analyzer.parseDateValue(rows[0].date), "2026-01-01");
});
