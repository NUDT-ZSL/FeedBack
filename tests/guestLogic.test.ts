import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUEST_COUNT,
  assignGuestSeats,
  createRng,
  deriveSeed,
  evaluateTension,
  nextTitleGap,
  resolveGuestReaction,
  resolveRoundReactions,
} from '../src/utils/guestLogic';
import type { GuestSeat, ReactionContext } from '../src/utils/guestLogic';
import { TOTAL_PITCHES } from '../src/utils/gameLogic';

function makeGuest(overrides: Partial<GuestSeat>): GuestSeat {
  return {
    id: 0,
    seatIndex: 0,
    color: '#000000',
    style: 'steady',
    favored: 'hit',
    ...overrides,
  };
}

function makeContext(overrides: Partial<ReactionContext>): ReactionContext {
  return {
    result: 'hit',
    consecutiveSuccesses: 1,
    totalScore: 0,
    pitchesRemaining: TOTAL_PITCHES - 1,
    maxPitches: TOTAL_PITCHES,
    ...overrides,
  };
}

test('同一局种子下席次与偏好分配完全一致，可复现', () => {
  for (const seed of [1, 42, 20261007, 4294967295]) {
    const first = assignGuestSeats(seed);
    const second = assignGuestSeats(seed);
    assert.deepEqual(first, second);
    assert.equal(first.length, GUEST_COUNT);
    assert.deepEqual(
      first.map((guest) => guest.seatIndex),
      [0, 1, 2, 3, 4, 5]
    );
  }
});

test('不同局种子产生不同的席次/偏好分配', () => {
  const base = assignGuestSeats(100);
  const others = [101, 102, 103, 104].map((seed) => assignGuestSeats(seed));
  const differs = others.some(
    (assignment) => JSON.stringify(assignment) !== JSON.stringify(base)
  );
  assert.ok(differs, '相邻种子不应产生完全相同的分配');
});

test('每次分配都同时包含两种偏好与三种性格', () => {
  for (const seed of [7, 8, 9, 10, 11]) {
    const guests = assignGuestSeats(seed);
    const favored = new Set(guests.map((guest) => guest.favored));
    const styles = new Set(guests.map((guest) => guest.style));
    assert.deepEqual([...favored].sort(), ['ear', 'hit']);
    assert.deepEqual([...styles].sort(), [
      'conservative',
      'lively',
      'steady',
    ]);
  }
});

test('随机数序列由种子决定', () => {
  const rngA = createRng(deriveSeed(5));
  const rngB = createRng(deriveSeed(5));
  for (let i = 0; i < 10; i += 1) {
    assert.equal(rngA(), rngB());
  }
});

test('命中时只有偏好命中的宾客欢呼，其余观望或不满', () => {
  const guests = assignGuestSeats(42);
  const reactions = resolveRoundReactions(
    guests,
    makeContext({ result: 'hit' })
  );
  guests.forEach((guest, index) => {
    const reaction = reactions[index];
    if (guest.favored === 'hit') {
      assert.equal(reaction.type, 'cheer');
    } else {
      assert.ok(
        reaction.type === 'watch' || reaction.type === 'shake',
        `非偏好宾客不应欢呼，实际为 ${reaction.type}`
      );
    }
  });
});

test('卡耳时只有偏好卡耳的宾客欢呼', () => {
  const guests = assignGuestSeats(42);
  const reactions = resolveRoundReactions(
    guests,
    makeContext({ result: 'ear' })
  );
  guests.forEach((guest, index) => {
    const reaction = reactions[index];
    if (guest.favored === 'ear') {
      assert.equal(reaction.type, 'cheer');
    } else {
      assert.notEqual(reaction.type, 'cheer');
    }
  });
});

test('连续命中时保守宾客欢呼减弱、热闹宾客欢呼增强', () => {
  const lively = makeGuest({ style: 'lively', favored: 'hit' });
  const conservative = makeGuest({ style: 'conservative', favored: 'hit' });

  const livelyFirst = resolveGuestReaction(
    lively,
    makeContext({ result: 'hit', consecutiveSuccesses: 1 })
  );
  const livelyStreak = resolveGuestReaction(
    lively,
    makeContext({ result: 'hit', consecutiveSuccesses: 4 })
  );
  assert.ok(livelyStreak.intensity > livelyFirst.intensity);

  const conservativeFirst = resolveGuestReaction(
    conservative,
    makeContext({ result: 'hit', consecutiveSuccesses: 1 })
  );
  const conservativeStreak = resolveGuestReaction(
    conservative,
    makeContext({ result: 'hit', consecutiveSuccesses: 4 })
  );
  assert.ok(conservativeStreak.intensity < conservativeFirst.intensity);
});

test('落空时不同性格宾客反应差异化', () => {
  const guests = assignGuestSeats(42);
  const reactions = resolveRoundReactions(
    guests,
    makeContext({ result: 'miss', consecutiveSuccesses: 0 })
  );
  guests.forEach((guest, index) => {
    const reaction = reactions[index];
    if (guest.style === 'lively') {
      assert.equal(reaction.type, 'laugh');
    } else {
      assert.equal(reaction.type, 'shake');
    }
  });
});

test('临近称号门槛且剩余次数不多时产生紧张反应', () => {
  // 剩余 2 投，积分 65，距 80 门槛 15 分，两投内可追平
  const tension = evaluateTension(65, 2);
  assert.ok(tension > 0);

  const guests = assignGuestSeats(42);
  const reactions = resolveRoundReactions(
    guests,
    makeContext({
      result: 'hit',
      totalScore: 65,
      pitchesRemaining: 2,
      consecutiveSuccesses: 2,
    })
  );
  guests.forEach((guest, index) => {
    const reaction = reactions[index];
    if (guest.favored === 'hit') {
      assert.equal(reaction.type, 'cheer');
    } else {
      assert.equal(reaction.type, 'nervous');
    }
  });

  const missReactions = resolveRoundReactions(
    guests,
    makeContext({
      result: 'miss',
      totalScore: 65,
      pitchesRemaining: 2,
      consecutiveSuccesses: 0,
    })
  );
  missReactions.forEach((reaction) => {
    assert.equal(reaction.type, 'nervous');
  });
});

test('次数充足或差距过大时不产生紧张感', () => {
  assert.equal(evaluateTension(65, 5), 0);
  assert.equal(evaluateTension(10, 2), 0);
  assert.equal(evaluateTension(85, 2), 0);
  assert.equal(evaluateTension(65, 0), 0);
  assert.equal(nextTitleGap(85), null);
});

test('每位宾客同一时刻只有一种反应状态', () => {
  const guests = assignGuestSeats(20261007);
  const results = ['hit', 'ear', 'miss'] as const;
  for (const result of results) {
    const reactions = resolveRoundReactions(
      guests,
      makeContext({ result, totalScore: 65, pitchesRemaining: 2 })
    );
    assert.equal(reactions.length, guests.length);
    reactions.forEach((reaction) => {
      assert.ok(typeof reaction.type === 'string');
      assert.ok(reaction.intensity >= 0 && reaction.intensity <= 1);
    });
  }
});
