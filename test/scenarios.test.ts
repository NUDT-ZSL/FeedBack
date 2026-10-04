import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runScenario, Scenario } from '../src/sim/replay';
import { StateSnapshot } from '../src/sim/types';

/**
 * 批量场景验证：scenarios/ 下每个 JSON 都是一份“带时间戳的碰撞事件 + 固定时间步”，
 * 在纯 Node 环境（无浏览器、无渲染）中复算，并与期望状态逐点比对。
 * 新增场景只需往 scenarios/ 目录丢一个 JSON 文件。
 */

interface ExpectPoint {
  time: number;
  state: Record<string, unknown>;
}

interface ScenarioFile extends Scenario {
  name: string;
  expect?: ExpectPoint[];
}

function matchState(actual: unknown, expected: unknown, path: string): void {
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
    const obj = expected as Record<string, unknown>;
    if ('$approx' in obj) {
      expect(typeof actual, `${path} 应为数值`).toBe('number');
      expect(
        Math.abs((actual as number) - (obj.$approx as number)),
        `${path} 应约等于 ${obj.$approx}`
      ).toBeLessThanOrEqual((obj.$eps as number) ?? 1e-6);
      return;
    }
    for (const key of Object.keys(obj)) {
      matchState(
        (actual as Record<string, unknown>)?.[key],
        obj[key],
        path ? `${path}.${key}` : key
      );
    }
    return;
  }
  expect(actual, path).toEqual(expected);
}

const scenarioDir = join(__dirname, '..', 'scenarios');
const files = readdirSync(scenarioDir).filter((f) => f.endsWith('.json'));

describe('离线场景批量复算（scenarios/*.json）', () => {
  for (const file of files) {
    const scenario = JSON.parse(
      readFileSync(join(scenarioDir, file), 'utf-8')
    ) as ScenarioFile;

    it(`${file}: ${scenario.name}`, () => {
      const { snapshots } = runScenario(scenario);

      for (const point of scenario.expect ?? []) {
        const snapshot = snapshots.find((s) => s.time >= point.time - 1e-9);
        expect(snapshot, `t=${point.time}s 处应有快照`).toBeDefined();
        matchState(snapshot as StateSnapshot, point.state, `t=${point.time}s`);
      }
    });
  }
});
