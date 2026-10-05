import {
  PRESET_EVENTS,
  runSimulation,
  type SimResult,
} from '../src/simulation';
import {
  batchConsistent,
  formatDate,
  formatRatios,
  getFlourTypeName,
  roundWeight,
} from '../src/MillCore';

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    console.error(`❌ 校验失败: ${message}`);
    process.exit(1);
  }
};

const validate = (result: SimResult): void => {
  const ids = new Set<string>();
  for (const batch of result.batches) {
    assert(!ids.has(batch.id), `批次编号重复 ${batch.id}`);
    ids.add(batch.id);
    assert(batch.weight > 0, `${batch.id} 重量必须为正`);
    assert(batchConsistent(batch), `${batch.id} 袋重与各段贡献之和不一致`);

    const evidenceSum = roundWeight(
      batch.evidence.reduce((acc, ev) => acc + ev.typeWeight, 0)
    );
    assert(
      evidenceSum === batch.weight,
      `${batch.id} 证据合计 ${evidenceSum} ≠ 袋重 ${batch.weight}`
    );

    for (const ev of batch.evidence) {
      assert(ev.duration > 0, `${batch.id} 存在零时长段落`);
      const ratioSum = ev.ratios.fine + ev.ratios.medium + ev.ratios.bran;
      assert(Math.abs(ratioSum - 1) < 1e-9, `${batch.id} 产出比例之和不为 1`);
      assert(
        Number.isFinite(ev.speed) && ev.speed >= 0,
        `${batch.id} 转速非法`
      );
      assert(ev.load >= 0 && ev.load <= 100, `${batch.id} 负载越界`);
      assert(
        Math.abs(ev.typeWeight - ev.output[batch.type]) < 1e-9,
        `${batch.id} 段落贡献与品类产出不对应`
      );
    }
  }
};

const result1 = runSimulation(PRESET_EVENTS);
const result2 = runSimulation(PRESET_EVENTS);

assert(
  JSON.stringify(result1.ledger) === JSON.stringify(result2.ledger),
  '同一序列重复运行结果不一致（不确定性）'
);
console.log('✅ 确定性校验通过：同一预设序列两次运行结果完全一致\n');

validate(result1);
console.log('✅ 账目一致性校验通过：袋重、证据、比例、负载均合法\n');

console.log('━━━━━━━━ 事件时间线 ━━━━━━━━');
for (const entry of result1.log) {
  console.log(`t=${entry.t.toFixed(3).padStart(6)}s  ${entry.kind.padEnd(12)} ${entry.detail}`);
}

console.log('\n━━━━━━━━ 批次账目（含历史依据）━━━━━━━━');
for (const batch of result1.batches) {
  console.log(
    `\n【${batch.id}】${getFlourTypeName(batch.type)}  ${batch.weight}斤  打包于 ${formatDate(
      batch.packedAt
    )}  依据 ${batch.evidence.length} 个工况段`
  );
  batch.evidence.forEach((ev, i) => {
    console.log(
      `  段${i + 1} (${ev.duration.toFixed(2)}s) 间隙${ev.gap.toFixed(2)}mm 阀门${ev.valve
        .toFixed(0)}% 转速${ev.speed.toFixed(1)}rpm 负载${ev.load.toFixed(1)}% | ${formatRatios(
        ev.ratios
      )} → 本袋贡献 ${ev.typeWeight.toFixed(4)}斤`
    );
  });
}

const p = result1.ledger.pendingTotals;
console.log(
  `\n未打包累计：精白面 ${p.fine.toFixed(3)} / 中筋面 ${p.medium.toFixed(3)} / 麸皮 ${p.bran.toFixed(
    3
  )}（斤）`
);
console.log(`共生成 ${result1.batches.length} 条批次记录`);
