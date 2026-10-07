export interface Scenario {
  readonly name: string;
  readonly description: string;
  run(): ScenarioResult;
}

export interface ScenarioResult {
  readonly name: string;
  /** 零条失败表示通过；每条失败需定位到时刻与星体 */
  readonly failures: readonly string[];
  /** 通过时展示的规模信息（如抽样时刻数） */
  readonly summary: string;
}
