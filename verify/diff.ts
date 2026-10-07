import type { Adjudication, ScheduleFailure, ScheduleResult } from '../src/scheduling/types.ts';

function failureText(f: ScheduleFailure): string {
  switch (f.kind) {
    case 'dependency-cycle':
      return `依赖闭环[${f.cycle.join(' -> ')}]`;
    case 'missing-dependency':
      return `工序${f.opId}依赖缺失工序${f.missingOpId}`;
    case 'unknown-loom-reference':
      return `能力记录指向不存在的织机${f.loomId}(工序类型${f.operationType})`;
    case 'no-capable-loom':
      return `工序${f.opId}(类型${f.operationType})无任何可用织机`;
    case 'ambiguous-coverage':
      return `工序${f.opId}被多台织机以不同优先级覆盖[${f.candidates
        .map((c) => `${c.loomId}@${c.priority}`)
        .join(', ')}]`;
  }
}

function adjudicationText(a: Adjudication): string {
  const candidates = a.candidates.map((c) => `${c.loomId}@${c.priority}`).join(', ');
  return `规则=${a.rule} 胜出=${a.winner ?? '无'} 候选=[${candidates}]`;
}

export function diffResults(
  actual: ScheduleResult,
  expected: ScheduleResult,
  labelA: string,
  labelB: string,
): string[] {
  const lines: string[] = [];
  if (actual.ok !== expected.ok) {
    lines.push(`整体结论不一致: ${labelA}.ok=${actual.ok} ${labelB}.ok=${expected.ok}`);
  }

  const aByOp = new Map(actual.scheduled.map((s) => [s.opId, s]));
  const bByOp = new Map(expected.scheduled.map((s) => [s.opId, s]));
  for (const [opId, b] of bByOp) {
    const a = aByOp.get(opId);
    if (!a) {
      lines.push(`工序${opId}: ${labelA}缺少排布，${labelB}=${b.loomId}[${b.start},${b.end})`);
      continue;
    }
    if (a.loomId !== b.loomId) {
      lines.push(`工序${opId} 织机不一致: ${labelA}=${a.loomId} ${labelB}=${b.loomId}`);
    }
    if (a.start !== b.start || a.end !== b.end) {
      lines.push(
        `工序${opId} 档期不一致: ${labelA}=[${a.start},${a.end}) ${labelB}=[${b.start},${b.end})`,
      );
    }
    if (a.workMinutes !== b.workMinutes) {
      lines.push(`工序${opId} 工时不一致: ${labelA}=${a.workMinutes} ${labelB}=${b.workMinutes}`);
    }
    const aReasons = a.basis.reasons.join(' | ');
    const bReasons = b.basis.reasons.join(' | ');
    if (aReasons !== bReasons) {
      lines.push(`工序${opId} 顺延依据不一致:\n    ${labelA}: ${aReasons}\n    ${labelB}: ${bReasons}`);
    }
  }
  for (const opId of aByOp.keys()) {
    if (!bByOp.has(opId)) {
      lines.push(`工序${opId}: ${labelB}缺少排布，仅存在于${labelA}`);
    }
  }

  const aAdj = new Map(actual.adjudications.map((x) => [x.opId, x]));
  const bAdj = new Map(expected.adjudications.map((x) => [x.opId, x]));
  for (const [opId, b] of bAdj) {
    const a = aAdj.get(opId);
    if (!a || adjudicationText(a) !== adjudicationText(b)) {
      lines.push(
        `工序${opId} 裁决依据不一致:\n    ${labelA}: ${a ? adjudicationText(a) : '缺失'}\n    ${labelB}: ${adjudicationText(b)}`,
      );
    }
  }

  const aFail = actual.failures.map(failureText).sort();
  const bFail = expected.failures.map(failureText).sort();
  if (aFail.join('\n') !== bFail.join('\n')) {
    lines.push(
      `失败列表不一致:\n    ${labelA}: [${aFail.join('; ')}]\n    ${labelB}: [${bFail.join('; ')}]`,
    );
  }
  return lines;
}

export { failureText, adjudicationText };
