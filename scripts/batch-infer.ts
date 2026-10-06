/**
 * 统一批量推演入口（离线可跑）：
 *   npm run infer
 * 对固定样例逐步执行「调整 / 裁决」，每步校验增量重推与整体重推结论一致。
 * 任一步不一致即以退出码 1 失败。
 */
import { runBatchInference } from "../src/engine/batch.js";

const report = runBatchInference();

console.log("=== 古代玉器作坊 · 批量推演 ===");
for (const [i, step] of report.steps.entries()) {
  const mark = step.consistent ? "✓" : "✗";
  console.log(
    `${mark} [${i}] ${step.label}  冲突=${step.conflicts} 执行=${step.executed} 受阻=${step.blocked} 复用=${step.reused} 重算=${step.recomputed}`,
  );
  for (const impact of step.ratioImpacts) {
    console.log(
      `    配比跨工序影响：${impact.sandName} → 工序[${impact.affectedStepIds.join(", ")}] 砂耗Δ${impact.sandDelta} 玉损Δ${impact.jadeLossDelta}`,
    );
  }
}

const p = report.finalResult.product;
console.log("--- 成品产出结论 ---");
console.log(`成品：${p.productName}（${p.completable ? "可完成" : "不可完成"}）`);
console.log(`执行 ${p.executedSteps}/${p.totalSteps} 道工序，累计 ${p.totalDuration} 刻`);
console.log(p.summary);
console.log(`玉料余量：${JSON.stringify(report.finalResult.materialFinal)}`);
console.log(`砂库存：${JSON.stringify(report.finalResult.sandFinal)}`);
console.log(`裁决记录 ${report.adjudicationLog.length} 条：`);
for (const a of report.adjudicationLog) console.log(`  ${a.id} [${a.conflictId}] ${a.label}`);

if (!report.consistent) {
  console.error("✗ 存在增量与全量结论不一致的步骤");
  process.exit(1);
}
console.log("✓ 全部步骤：增量重推与整体重推结论一致");
