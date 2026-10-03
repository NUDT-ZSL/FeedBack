import { runAll } from './framework.ts';
import './scenarios.ts';
import './fuzz.ts';

const filter = process.argv.slice(2).find(arg => !arg.startsWith('-'));
process.exitCode = runAll(filter);
