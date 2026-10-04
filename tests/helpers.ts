import assert from 'node:assert/strict';
import { Board } from '../src/whiteboard/history.ts';
import { checkInvariants } from '../src/whiteboard/invariants.ts';
import { OpRejection } from '../src/whiteboard/errors.ts';
import { stateHash } from '../src/whiteboard/serialize.ts';
import { isDescendant, orderOf } from '../src/whiteboard/apply.ts';
import { createElement } from '../src/whiteboard/types.ts';
import type { BoardState } from '../src/whiteboard/types.ts';
import type { ElementKind } from '../src/whiteboard/types.ts';
import type { Op } from '../src/whiteboard/ops.ts';
import type { RejectCode } from '../src/whiteboard/errors.ts';

export interface Step {
  op: Op;
  expectReject?: RejectCode;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runSteps(
  board: Board,
  steps: Step[],
  label = 'script',
): void {
  steps.forEach((step, index) => {
    const before = stateHash(board.state);
    const describe = (extra: string): string =>
      `${label} step ${index} op=${JSON.stringify(step.op)}: ${extra}`;

    if (step.expectReject) {
      assert.throws(
        () => board.dispatch(step.op),
        (err: unknown) =>
          err instanceof OpRejection && err.code === step.expectReject,
        describe(`expected rejection ${step.expectReject}`),
      );
      assert.equal(
        stateHash(board.state),
        before,
        describe('state changed after rejected op'),
      );
    } else {
      board.dispatch(step.op);
    }

    const problems = checkInvariants(board.state);
    assert.deepEqual(
      problems,
      [],
      describe(`invariants violated: ${problems.join('; ')}`),
    );
  });
}

const KINDS: ElementKind[] = ['rect', 'ellipse', 'line', 'note'];

export function generateScript(seed: number, count: number): {
  initial: BoardState;
  steps: Step[];
} {
  const rng = mulberry32(seed);
  const board = new Board();
  const steps: Step[] = [];
  let counter = 0;

  const pick = <T>(items: T[]): T =>
    items[Math.floor(rng() * items.length)];
  const randomInt = (maxExclusive: number): number =>
    Math.floor(rng() * maxExclusive);

  for (let i = 0; i < count; i += 1) {
    const state = board.state;
    const ids = Object.keys(state.elements);
    const groups = ids.filter((id) => state.elements[id].kind === 'group');
    const roll = rng();
    let step: Step;

    if (ids.length === 0 || roll < 0.24) {
      const id = `e${counter}`;
      counter += 1;
      const parentId = groups.length > 0 && rng() < 0.35 ? pick(groups) : null;
      const list = orderOf(state, parentId);
      const index = rng() < 0.5 ? undefined : randomInt(list.length + 1);
      step = {
        op: {
          type: 'add',
          element: createElement({
            id,
            kind: pick(KINDS),
            parentId,
            x: randomInt(500),
            y: randomInt(500),
            width: 20 + randomInt(180),
            height: 20 + randomInt(180),
            fill: pick(['#4a9e8f', '#c96f4a', '#c9b14a', '#4a7ac9', '#f5f0e6']),
          }),
          ...(index === undefined ? {} : { index }),
        },
      };
    } else if (roll < 0.42) {
      const id = pick(ids);
      step = {
        op: {
          type: 'update',
          id,
          patch:
            rng() < 0.5
              ? { x: randomInt(500), y: randomInt(500) }
              : { fill: pick(['#111111', '#222222', '#333333']), text: `t${counter++}` },
        },
      };
    } else if (roll < 0.52) {
      step = { op: { type: 'remove', id: pick(ids) } };
    } else if (roll < 0.61) {
      const id = pick(ids);
      const list = orderOf(state, state.elements[id].parentId);
      step = {
        op: { type: 'reorder', id, toIndex: randomInt(list.length) },
      };
    } else if (roll < 0.74) {
      const id = pick(ids);
      const validTargets = groups.filter(
        (gid) => gid !== id && !isDescendant(state, id, gid),
      );
      const newParentId = rng() < 0.5 || validTargets.length === 0
        ? null
        : pick(validTargets);
      const targetList = orderOf(state, newParentId);
      const toIndex =
        newParentId === state.elements[id].parentId
          ? randomInt(Math.max(targetList.length - 1, 1))
          : randomInt(targetList.length + 1);
      step = { op: { type: 'move', id, newParentId, toIndex } };
    } else if (roll < 0.84) {
      const parentIds: (string | null)[] = [null, ...groups];
      const candidates = parentIds.filter(
        (parentId) => orderOf(state, parentId).length >= 2,
      );
      if (candidates.length === 0) {
        step = { op: { type: 'update', id: pick(ids), patch: { x: i } } };
      } else {
        const parentId = pick(candidates);
        const siblings = [...orderOf(state, parentId)];
        const groupSize = Math.min(
          siblings.length,
          2 + randomInt(Math.min(3, siblings.length - 1)),
        );
        const memberIds: string[] = [];
        while (memberIds.length < groupSize) {
          const candidate = siblings[randomInt(siblings.length)];
          if (!memberIds.includes(candidate)) memberIds.push(candidate);
        }
        step = {
          op: { type: 'group', ids: memberIds, groupId: `g${counter}` },
        };
        counter += 1;
      }
    } else if (roll < 0.91) {
      if (groups.length === 0) {
        step = { op: { type: 'update', id: pick(ids), patch: { y: i } } };
      } else {
        step = { op: { type: 'ungroup', groupId: pick(groups) } };
      }
    } else {
      step = makeInvalidOp(state, pick(ids), i, pick(groups));
    }

    if (step.expectReject) {
      assert.throws(
        () => board.dispatch(step.op),
        (err: unknown) =>
          err instanceof OpRejection && err.code === step.expectReject,
        `generator annotation wrong at step ${i}: ${JSON.stringify(step)}`,
      );
    } else {
      board.dispatch(step.op);
    }
    steps.push(step);
  }

  return { initial: { elements: {}, rootOrder: [], childOrder: {} }, steps };
}

function makeInvalidOp(
  state: BoardState,
  someId: string | undefined,
  index: number,
  groups: string[],
): Step {
  const variant = index % 5;
  switch (variant) {
    case 0:
      return {
        op: { type: 'update', id: `missing-${index}`, patch: { x: 1 } },
        expectReject: 'UPDATE_MISSING',
      };
    case 1:
      return {
        op: { type: 'remove', id: `missing-${index}` },
        expectReject: 'REMOVE_MISSING',
      };
    case 2:
      if (someId) {
        return {
          op: { type: 'reorder', id: someId, toIndex: 99999 },
          expectReject: 'REORDER_BAD_INDEX',
        };
      }
      return {
        op: { type: 'group', ids: [], groupId: `bad-${index}` },
        expectReject: 'GROUP_EMPTY',
      };
    case 3:
      if (someId) {
        return {
          op: { type: 'move', id: someId, newParentId: `missing-g-${index}` },
          expectReject: 'MOVE_MISSING_PARENT',
        };
      }
      return {
        op: { type: 'group', ids: [], groupId: `bad-${index}` },
        expectReject: 'GROUP_EMPTY',
      };
    case 4: {
      if (someId) {
        return {
          op: {
            type: 'add',
            element: createElement({ id: someId }),
          },
          expectReject: 'ADD_DUPLICATE_ID',
        };
      }
      return {
        op: { type: 'group', ids: [], groupId: `bad-${index}` },
        expectReject: 'GROUP_EMPTY',
      };
    }
    default:
      return {
        op: { type: 'group', ids: [], groupId: `bad-${index}` },
        expectReject: 'GROUP_EMPTY',
      };
  }
}
