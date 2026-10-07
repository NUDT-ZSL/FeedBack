import { runAll } from './harness';
import './placement.test';
import './furnace.test';
import './collection.test';
import './herb.test';
import './terrain.test';
import './e2e.test';

runAll().then((exitCode) => {
  process.exit(exitCode);
});
