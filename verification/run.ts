import { runAll } from './harness.ts';
import './suites/matching.suite.ts';
import './suites/questions.suite.ts';
import './suites/submission.suite.ts';
import './suites/timer.suite.ts';
import './suites/cleanup.suite.ts';

console.log('房间对局链路离线验证（无需网络 / 真实计时器）');
const failures = await runAll();
process.exit(failures > 0 ? 1 : 0);
