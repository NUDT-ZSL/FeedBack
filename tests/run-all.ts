// Unified batch entry: runs every suite offline, in one process.
// Usage: npm test

import './shopping.test';
import './favorites.test';
import './search.test';
import { runAll } from './harness';

runAll()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
