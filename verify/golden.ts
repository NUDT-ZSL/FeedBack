// Golden snapshots: fixed seeds + fixed shot sequences => pinned final
// state. Each entry is tagged with the chain it guards, so a physics or
// rules change fails exactly the scenarios of the affected chain and
// prints expected vs actual field values.
//
// Regenerate intentionally (after a deliberate physics change) by
// replaying the same scenarios and pasting the new values.
export type Aim = 'hole' | 'away' | 'up';

export interface GoldenCase {
  chain: string;
  name: string;
  seed: number;
  shots: Array<[Aim, number]>; // [aim, chargeMs]
  expected: {
    state: string;
    strokeCount: number;
    x: number;
    y: number;
    isInHole: boolean;
  };
}

export const GOLDENS: GoldenCase[] = [
  {
    chain: 'golden/terrain',
    name: 'scripted putts across mixed terrain land on the pinned spot',
    seed: 7,
    shots: [
      ['hole', 800],
      ['hole', 1100],
      ['hole', 1400]
    ],
    expected: {
      state: 'win',
      strokeCount: 2,
      x: 1044.4898410986748,
      y: 383.9646664702049,
      isInHole: true
    }
  },
  {
    chain: 'golden/fence',
    name: 'full-power bounce off the top fence lands on the pinned spot',
    seed: 11,
    shots: [
      ['up', 5000],
      ['hole', 1500]
    ],
    expected: {
      state: 'aiming',
      strokeCount: 2,
      x: 657.8922161999249,
      y: 482.6258948469575,
      isInHole: false
    }
  },
  {
    chain: 'golden/hole',
    name: 'straight putting sequence holes out in three strokes',
    seed: 6,
    shots: [
      ['hole', 2000],
      ['hole', 2000],
      ['hole', 2000]
    ],
    expected: {
      state: 'win',
      strokeCount: 3,
      x: 1079.8869081661555,
      y: 315.16220607544034,
      isInHole: true
    }
  },
  {
    chain: 'golden/strokes',
    name: 'ten weak putts away from the hole end in fail',
    seed: 2024,
    shots: [
      ['away', 100],
      ['away', 100],
      ['away', 100],
      ['away', 100],
      ['away', 100],
      ['away', 100],
      ['away', 100],
      ['away', 100],
      ['away', 100],
      ['away', 100]
    ],
    expected: {
      state: 'fail',
      strokeCount: 10,
      x: 159.13548871427312,
      y: 403.01062795857456,
      isInHole: false
    }
  }
];
