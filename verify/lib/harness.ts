/**
 * 零依赖验证框架：收集断言结果，输出可读中文报告，失败精确定位到用例/实体/依据。
 */
export interface CheckResult {
  suite: string;
  name: string;
  passed: boolean;
  message?: string;
}

const results: CheckResult[] = [];
let currentSuite = '';

export function suite(name: string): void {
  currentSuite = name;
}

export function check(name: string, fn: () => void): void {
  try {
    fn();
    results.push({ suite: currentSuite, name, passed: true });
  } catch (error) {
    results.push({
      suite: currentSuite,
      name,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label} 对不上：期望 ${e}，实际 ${a}`);
  }
}

export function getResults(): CheckResult[] {
  return results;
}

export function printReport(json: boolean): number {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  if (json) {
    console.log(JSON.stringify({ total: results.length, passed, failed, results }, null, 2));
  } else {
    const green = '\x1b[32m';
    const red = '\x1b[31m';
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const suites = [...new Set(results.map((r) => r.suite))];
    for (const name of suites) {
      const items = results.filter((r) => r.suite === name);
      const ok = items.every((r) => r.passed);
      console.log(`\n${bold}${ok ? green + '✔' : red + '✘'} ${name}${reset}  ${dim}(${items.filter((r) => r.passed).length}/${items.length})${reset}`);
      for (const item of items) {
        if (item.passed) {
          console.log(`  ${green}✔${reset} ${item.name}`);
        } else {
          console.log(`  ${red}✘ ${item.name}${reset}`);
          for (const line of (item.message ?? '').split('\n')) {
            console.log(`      ${red}${line}${reset}`);
          }
        }
      }
    }
    console.log(`\n${bold}汇总：共 ${results.length} 项，通过 ${green}${passed}${reset}，失败 ${failed > 0 ? red : ''}${failed}${reset}`);
    if (failed > 0) {
      console.log(`${red}${bold}验证未通过：请按上面的 ✘ 用例及其指出的工序/织机/依据段定位。${reset}`);
    }
  }
  return failed === 0 ? 0 : 1;
}
