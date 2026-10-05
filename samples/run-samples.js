// 离线验收入口：node samples/run-samples.js
// 逐步执行每个场景，每步后校验「局部重推 == 整体重推」，并打印最终链路报告。
import { scenarios } from './scenarios.js';

function snapshot(eng) {
  const r = eng.report();
  return {
    positions: r.positions,
    conflicts: r.conflicts,
    unconverged: r.unconverged,
    dangling: r.dangling,
    cycles: r.cycles,
  };
}

let failures = 0;

for (const make of scenarios) {
  const { name, eng, steps } = make();
  console.log(`\n=== ${name} ===`);
  for (const [label, fn] of steps) {
    const r = fn();
    const meta = r && r.rederived != null ? `（重推 ${r.rederived} 位置 / ${r.iterations} 轮）` : '';
    const before = snapshot(eng);
    eng.recomputeAll();
    const after = snapshot(eng);
    const consistent = JSON.stringify(before) === JSON.stringify(after);
    if (!consistent) failures++;
    console.log(`  ${consistent ? '✓' : '✗ 局部/整体不一致'} ${label} ${meta}`);
  }
  const rep = eng.report();
  console.log('  最终标记：');
  for (const p of rep.positions) {
    const hits = p.hits.map((h) => `${h.ruleId}(p${h.priority})->${h.tag}`).join(', ') || '-';
    const path = p.propagationPath.map((u) => `${u.position}:${u.tag}`).join(' <- ') || '-';
    console.log(
      `    [${p.index}] ${JSON.stringify(p.char)}  ${p.finalTag ?? '∅'}  (${p.status})  依据: ${hits}  传播路径: ${path}`
    );
  }
  if (rep.conflicts.length) console.log(`  冲突位置: ${rep.conflicts.join(', ')}`);
  if (rep.unconverged.length) console.log(`  未收敛位置: ${rep.unconverged.join(', ')}`);
  if (rep.dangling.length) console.log(`  悬空依赖: ${rep.dangling.map((d) => `${d.reader} -> ${d.missing}`).join(', ')}`);
  if (rep.cycles.length) console.log(`  依赖环: ${rep.cycles.map((c) => c.join(' -> ')).join(' | ')}`);
}

console.log(failures === 0 ? '\n全部场景：局部重推与整体重推一致。' : `\n${failures} 处不一致！`);
process.exit(failures === 0 ? 0 : 1);
