// Registers the offline tinycolor2 resolution hook before any test file
// (or the source modules they import) is loaded. Used via:
//   node --import ./tests/register-loader.mjs --test tests/
import { register } from 'node:module';

register('./tinycolor-loader.mjs', import.meta.url);
