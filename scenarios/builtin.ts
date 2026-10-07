import type { Scenario } from '../src/sim';

export const BUILTIN_SCENARIOS: Scenario[] = [
  {
    name: 'idle-full-match',
    seed: 42,
    templateId: 'zhang-jun',
  },
  {
    name: 'scripted-attack',
    seed: 7,
    templateId: 'li-qing',
    inputs: [
      { t: 0, action: { type: 'keyDown', key: 'w' } },
      { t: 1000, action: { type: 'keyUp', key: 'w' } },
      { t: 1000, action: { type: 'startCharge' } },
      { t: 1800, action: { type: 'shoot' } },
      { t: 5000, action: { type: 'pass' } },
      { t: 9000, action: { type: 'keyDown', key: 'a' } },
      { t: 9500, action: { type: 'keyUp', key: 'a' } },
      { t: 20000, action: { type: 'tackle' } },
      { t: 30000, action: { type: 'startCharge' } },
      { t: 32000, action: { type: 'shoot' } },
    ],
  },
  {
    name: 'boundary-hugger',
    seed: 99,
    templateId: 'wang-gang',
    inputs: [
      { t: 0, action: { type: 'keyDown', key: 'w' } },
      { t: 60000, action: { type: 'keyUp', key: 'w' } },
      { t: 60000, action: { type: 'keyDown', key: 'd' } },
      { t: 61000, action: { type: 'keyUp', key: 'd' } },
      { t: 61000, action: { type: 'keyDown', key: 'w' } },
    ],
  },
];
