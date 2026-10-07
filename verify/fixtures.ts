import type { SchedulingInput } from '../src/scheduling/types.ts';

export function normalDataset(): SchedulingInput {
  return {
    looms: [
      { id: 'L1', speedFactor: 1, availableFrom: 0 },
      { id: 'L2', speedFactor: 2, availableFrom: 0 },
      { id: 'L3', speedFactor: 1, availableFrom: 60 },
    ],
    capabilities: [
      { loomId: 'L1', operationType: 'weave', priority: 10 },
      { loomId: 'L2', operationType: 'weave', priority: 5 },
      { loomId: 'L2', operationType: 'dye', priority: 5 },
      { loomId: 'L3', operationType: 'dye', priority: 10 },
      { loomId: 'L3', operationType: 'inspect', priority: 10 },
    ],
    orders: [
      {
        id: 'O1',
        releaseAt: 0,
        operations: [
          { id: 'A1', orderId: 'O1', type: 'weave', dependsOn: [], standardMinutes: 20 },
          { id: 'A2', orderId: 'O1', type: 'dye', dependsOn: ['A1'], standardMinutes: 30 },
          { id: 'A3', orderId: 'O1', type: 'inspect', dependsOn: ['A2'], standardMinutes: 10 },
        ],
      },
      {
        id: 'O2',
        releaseAt: 0,
        operations: [
          { id: 'B1', orderId: 'O2', type: 'weave', dependsOn: [], standardMinutes: 40 },
          { id: 'B2', orderId: 'O2', type: 'dye', dependsOn: ['A2'], standardMinutes: 20 },
        ],
      },
      {
        id: 'O3',
        releaseAt: 100,
        operations: [
          { id: 'C1', orderId: 'O3', type: 'weave', dependsOn: [], standardMinutes: 10 },
          { id: 'C2', orderId: 'O3', type: 'inspect', dependsOn: ['C1'], standardMinutes: 10 },
        ],
      },
    ],
  };
}

export function boundaryDataset(): SchedulingInput {
  return {
    looms: [
      { id: 'L1', speedFactor: 3, availableFrom: 0 },
      { id: 'L2', speedFactor: 1, availableFrom: 0 },
    ],
    capabilities: [
      { loomId: 'L2', operationType: 'weave', priority: 10 },
      { loomId: 'L1', operationType: 'weave', priority: 10 },
      { loomId: 'L1', operationType: 'finish', priority: 5 },
    ],
    orders: [
      {
        id: 'OB',
        releaseAt: 4,
        operations: [
          { id: 'Z1', orderId: 'OB', type: 'weave', dependsOn: [], standardMinutes: 0 },
          { id: 'Z2', orderId: 'OB', type: 'weave', dependsOn: ['Z1'], standardMinutes: 10 },
          { id: 'Z3', orderId: 'OB', type: 'finish', dependsOn: ['Z2'], standardMinutes: 6 },
        ],
      },
    ],
  };
}

export function cycleDataset(): SchedulingInput {
  const base = normalDataset();
  return {
    ...base,
    orders: base.orders.map((o) => ({
      ...o,
      operations: o.operations.map((op) =>
        op.id === 'A1' ? { ...op, dependsOn: ['A3'] } : op,
      ),
    })),
  };
}

export function missingDependencyDataset(): SchedulingInput {
  const base = normalDataset();
  return {
    ...base,
    orders: base.orders.map((o) => ({
      ...o,
      operations: o.operations.map((op) =>
        op.id === 'B2' ? { ...op, dependsOn: ['A2', 'NOPE'] } : op,
      ),
    })),
  };
}

export function unknownLoomDataset(): SchedulingInput {
  const base = normalDataset();
  return {
    ...base,
    capabilities: [
      ...base.capabilities,
      { loomId: 'L9', operationType: 'weave', priority: 99 },
    ],
  };
}

export function noCapableLoomDataset(): SchedulingInput {
  const base = normalDataset();
  return {
    ...base,
    orders: [
      ...base.orders,
      {
        id: 'O9',
        releaseAt: 0,
        operations: [
          { id: 'D1', orderId: 'O9', type: 'coat', dependsOn: [], standardMinutes: 10 },
        ],
      },
    ],
  };
}

export function ambiguousCoverageDataset(strict: boolean): SchedulingInput {
  return {
    looms: [
      { id: 'L1', speedFactor: 1, availableFrom: 0 },
      { id: 'L2', speedFactor: 1, availableFrom: 0 },
    ],
    capabilities: [
      { loomId: 'L1', operationType: 'weave', priority: 10 },
      { loomId: 'L2', operationType: 'weave', priority: 7 },
    ],
    orders: [
      {
        id: 'OA',
        releaseAt: 0,
        operations: [
          { id: 'M1', orderId: 'OA', type: 'weave', dependsOn: [], standardMinutes: 10 },
        ],
      },
    ],
    policy: { strictAdjudication: strict },
  };
}
