import * as concurrentUpdates from './scenarios/concurrent-updates';
import * as duplicateAndDeleteUpdate from './scenarios/duplicate-and-delete-update';
import * as reconnectSync from './scenarios/reconnect-sync';
import * as malformedMessages from './scenarios/malformed-messages';
import * as presence from './scenarios/presence';

interface Scenario {
  name: string;
  run: () => Promise<void>;
}

const scenarios: Scenario[] = [
  concurrentUpdates,
  duplicateAndDeleteUpdate,
  reconnectSync,
  malformedMessages,
  presence,
];

async function main(): Promise<void> {
  console.log(`Running ${scenarios.length} verification scenarios (offline, in-process server)\n`);

  const failures: Array<{ name: string; error: unknown }> = [];

  for (const scenario of scenarios) {
    const startedAt = Date.now();
    process.stdout.write(`[RUN ] ${scenario.name}\n`);
    try {
      await scenario.run();
      console.log(`[PASS] ${scenario.name} (${Date.now() - startedAt}ms)`);
    } catch (error) {
      failures.push({ name: scenario.name, error });
      console.log(`[FAIL] ${scenario.name} (${Date.now() - startedAt}ms)`);
      const message = error instanceof Error ? error.message : String(error);
      for (const line of message.split('\n')) {
        console.log(`       ${line}`);
      }
    }
  }

  console.log('');
  if (failures.length === 0) {
    console.log(`RESULT: all ${scenarios.length} scenarios passed`);
    process.exit(0);
  } else {
    console.log(`RESULT: ${scenarios.length - failures.length}/${scenarios.length} passed, ${failures.length} failed:`);
    for (const failure of failures) {
      console.log(`  - ${failure.name}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Verification runner crashed:', error);
  process.exit(1);
});
