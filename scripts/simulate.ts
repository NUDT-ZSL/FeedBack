import { runMatch, stateHash, FIXED_DT, type Scenario } from '../src/sim';
import { BUILTIN_SCENARIOS } from '../scenarios/builtin';

interface CliOptions {
  seed?: number;
  templateId: string;
  json: boolean;
  repeat: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { templateId: 'zhang-jun', json: false, repeat: 1 };
  for (const arg of argv) {
    if (arg.startsWith('--seed=')) options.seed = Number(arg.slice('--seed='.length));
    else if (arg.startsWith('--template=')) options.templateId = arg.slice('--template='.length);
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('--repeat=')) options.repeat = Number(arg.slice('--repeat='.length));
  }
  return options;
}

function summarize(scenario: Scenario) {
  const started = process.hrtime.bigint();
  const final = runMatch(scenario);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    name: scenario.name,
    seed: scenario.seed,
    templateId: scenario.templateId,
    dt: FIXED_DT,
    simClockMs: Math.round(final.clock),
    phase: final.phase,
    result: final.result,
    score: final.score,
    goals: final.goals.length,
    events: final.eventLog.length,
    hash: stateHash(final),
    wallMs: Math.round(elapsedMs * 10) / 10,
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const scenarios: Scenario[] =
    options.seed !== undefined
      ? [{ name: `custom-seed-${options.seed}`, seed: options.seed, templateId: options.templateId }]
      : BUILTIN_SCENARIOS;

  const summaries = [];
  let failures = 0;

  for (const scenario of scenarios) {
    const summary = summarize(scenario);
    summaries.push(summary);
    if (summary.phase !== 'finished') failures++;

    for (let i = 1; i < options.repeat; i++) {
      const replay = summarize(scenario);
      if (replay.hash !== summary.hash) {
        failures++;
        console.error(`[FAIL] ${scenario.name} 第 ${i + 1} 次重放哈希不一致: ${replay.hash} != ${summary.hash}`);
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(summaries, null, 2));
  } else {
    for (const s of summaries) {
      console.log(
        [
          `[${s.phase === 'finished' ? 'OK' : 'FAIL'}]`,
          s.name.padEnd(20),
          `seed=${s.seed}`,
          `score=${s.score.user}:${s.score.opponent}`,
          `result=${s.result}`,
          `goals=${s.goals}`,
          `events=${s.events}`,
          `clock=${s.simClockMs}ms`,
          `hash=${s.hash}`,
          `(${s.wallMs}ms)`,
        ].join(' ')
      );
    }
  }

  if (failures > 0) {
    console.error(`${failures} 个场景未正常终场或重放不一致`);
    process.exit(1);
  }
}

main();
