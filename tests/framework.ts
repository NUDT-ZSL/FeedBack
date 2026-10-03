export class InvariantViolation extends Error {
  readonly invariant: string;

  constructor(invariant: string, detail: string) {
    super(`[${invariant}] ${detail}`);
    this.name = 'InvariantViolation';
    this.invariant = invariant;
  }
}

export function checkInvariant(invariant: string, condition: boolean, detail: string): void {
  if (!condition) {
    throw new InvariantViolation(invariant, detail);
  }
}

type ScenarioFn = () => void;

interface Scenario {
  name: string;
  fn: ScenarioFn;
}

const scenarios: Scenario[] = [];

export function scenario(name: string, fn: ScenarioFn): void {
  scenarios.push({ name, fn });
}

export function runAll(filter?: string): number {
  const selected = filter
    ? scenarios.filter(s => s.name.includes(filter))
    : scenarios;

  if (selected.length === 0) {
    console.log(`没有匹配${filter ? ` “${filter}” ` : ' '}的验证场景`);
    return 1;
  }

  console.log(`开始执行 ${selected.length} 个验证场景...\n`);

  const failures: { name: string; message: string }[] = [];
  for (const { name, fn } of selected) {
    try {
      fn();
      console.log(`  通过  ${name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ name, message });
      console.log(`  失败  ${name}`);
      console.log(`        ${message.split('\n').join('\n        ')}`);
    }
  }

  console.log('');
  if (failures.length === 0) {
    console.log(`全部通过：${selected.length}/${selected.length}`);
  } else {
    console.log(`结果：${selected.length - failures.length} 通过，${failures.length} 失败`);
    console.log('失败场景清单：');
    failures.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.name}`);
      console.log(`     ${f.message.split('\n').join('\n     ')}`);
    });
  }
  return failures.length === 0 ? 0 : 1;
}
