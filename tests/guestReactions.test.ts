import assert from 'node:assert/strict';
import {
  GUEST_COUNT,
  assignGuestSeats,
  analyzeStreaks,
  isTitleTense,
  decideGuestReaction,
  decideAllGuestReactions,
  idleReaction,
} from '../src/utils/guestReactions.ts';
import type { GuestSeat, ReactionRequest } from '../src/utils/guestReactions.ts';
import { TOTAL_PITCHES } from '../src/utils/gameLogic.ts';
import type { PitchResult } from '../src/utils/gameLogic.ts';

const VALID_CATEGORIES = new Set(['idle', 'cheer', 'shake', 'laugh', 'watch', 'tense']);

function makeRequest(overrides: Partial<ReactionRequest> = {}): ReactionRequest {
  return {
    result: 'hit',
    totalScore: 0,
    pitchesRemaining: TOTAL_PITCHES,
    pitchHistory: [],
    ...overrides,
  };
}

function guestsByFavor(guests: GuestSeat[], favor: PitchResult): GuestSeat[] {
  return guests.filter((g) => g.favors === favor);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`FAIL - ${name}`);
    throw error;
  }
}

test('同一局种子分配结果完全可复现', () => {
  const seed = 20261007;
  assert.deepEqual(assignGuestSeats(seed), assignGuestSeats(seed));
  for (const s of [1, 42, 999, 123456789]) {
    assert.deepEqual(assignGuestSeats(s), assignGuestSeats(s));
  }
});

test('席次分配覆盖全部席位且偏好分布固定', () => {
  const guests = assignGuestSeats(7);
  assert.equal(guests.length, GUEST_COUNT);
  assert.deepEqual(
    guests.map((g) => g.seatIndex).sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(new Set(guests.map((g) => g.id)).size, GUEST_COUNT);
  assert.equal(new Set(guests.map((g) => g.color)).size, GUEST_COUNT);
  const count = (f: PitchResult) => guestsByFavor(guests, f).length;
  assert.equal(count('hit'), 3);
  assert.equal(count('ear'), 1);
  assert.equal(count('miss'), 2);
  assert.equal(guests.filter((g) => g.temperament === 'lively').length, 3);
  assert.equal(guests.filter((g) => g.temperament === 'steady').length, 3);
});

test('不同种子产生不同席次分配', () => {
  assert.notDeepEqual(assignGuestSeats(1), assignGuestSeats(2));
  assert.notDeepEqual(assignGuestSeats(1), assignGuestSeats(3));
});

test('命中时仅偏好命中的宾客欢呼，其余不欢呼', () => {
  const guests = assignGuestSeats(11);
  const reactions = decideAllGuestReactions(guests, makeRequest({ result: 'hit' }));
  for (const guest of guests) {
    const reaction = reactions[guest.id];
    if (guest.favors === 'hit') {
      assert.equal(reaction.category, 'cheer');
    } else {
      assert.notEqual(reaction.category, 'cheer');
      assert.ok(reaction.category === 'shake' || reaction.category === 'watch');
    }
  }
});

test('卡耳时仅偏好卡耳的宾客欢呼', () => {
  const guests = assignGuestSeats(11);
  const reactions = decideAllGuestReactions(guests, makeRequest({ result: 'ear' }));
  for (const guest of guests) {
    const reaction = reactions[guest.id];
    if (guest.favors === 'ear') {
      assert.equal(reaction.category, 'cheer');
    } else {
      assert.notEqual(reaction.category, 'cheer');
    }
  }
});

test('落空时偏好落空的宾客大笑，其余宾客差异化反应', () => {
  const guests = assignGuestSeats(11);
  const reactions = decideAllGuestReactions(guests, makeRequest({ result: 'miss' }));
  const categories = new Set<string>();
  for (const guest of guests) {
    const reaction = reactions[guest.id];
    categories.add(reaction.category);
    if (guest.favors === 'miss') {
      assert.equal(reaction.category, 'laugh');
    } else {
      assert.notEqual(reaction.category, 'laugh');
      assert.ok(reaction.category === 'shake' || reaction.category === 'watch');
    }
  }
  assert.ok(categories.size >= 2, '非偏好宾客应有差异化反应');
});

test('连续命中时偏好热闹的宾客反应增强、保守的减弱', () => {
  const guests = assignGuestSeats(11);
  const lively = guestsByFavor(guests, 'hit').find((g) => g.temperament === 'lively');
  const steady = guestsByFavor(guests, 'hit').find((g) => g.temperament === 'steady');
  assert.ok(lively && steady);

  const intensityAt = (guest: GuestSeat, streak: number) =>
    decideGuestReaction(
      guest,
      makeRequest({
        result: 'hit',
        pitchHistory: Array.from({ length: streak }, () => ({ result: 'hit' as const })),
      }),
    ).intensity;

  assert.ok(intensityAt(lively, 3) > intensityAt(lively, 1), '热闹型应随连中增强');
  assert.ok(intensityAt(steady, 3) < intensityAt(steady, 1), '保守型应随连中减弱');
});

test('连击统计：贯耳会中断连中与连失', () => {
  const history = [
    { result: 'hit' as const },
    { result: 'ear' as const },
    { result: 'hit' as const },
    { result: 'hit' as const },
  ];
  assert.deepEqual(analyzeStreaks(history), { hitStreak: 2, missStreak: 0 });
  const missHistory = [
    { result: 'miss' as const },
    { result: 'ear' as const },
    { result: 'miss' as const },
    { result: 'miss' as const },
  ];
  assert.deepEqual(analyzeStreaks(missHistory), { hitStreak: 0, missStreak: 2 });
});

test('临界称号时非偏好宾客转为紧张，偏好宾客仍庆祝', () => {
  const guests = assignGuestSeats(11);
  const reactions = decideAllGuestReactions(
    guests,
    makeRequest({ result: 'hit', totalScore: 45, pitchesRemaining: 2 }),
  );
  for (const guest of guests) {
    const reaction = reactions[guest.id];
    if (guest.favors === 'hit') {
      assert.equal(reaction.category, 'cheer');
    } else {
      assert.equal(reaction.category, 'tense');
    }
  }
});

test('称号紧张判定边界', () => {
  assert.equal(isTitleTense(45, 2), true);
  assert.equal(isTitleTense(50, 2), false, '已达到门槛不紧张');
  assert.equal(isTitleTense(39, 2), false, '差距过大不紧张');
  assert.equal(isTitleTense(45, 3), false, '剩余次数尚多不紧张');
  assert.equal(isTitleTense(75, 1), true);
  assert.equal(isTitleTense(45, 0), false, '对局结束不再紧张');
});

test('同一时刻每位宾客只有一种反应状态', () => {
  const guests = assignGuestSeats(11);
  const scenarios: ReactionRequest[] = [
    makeRequest({ result: 'hit' }),
    makeRequest({ result: 'ear' }),
    makeRequest({ result: 'miss' }),
    makeRequest({ result: 'hit', totalScore: 45, pitchesRemaining: 1 }),
    makeRequest({ result: 'miss', totalScore: 45, pitchesRemaining: 1 }),
  ];
  for (const request of scenarios) {
    const reactions = decideAllGuestReactions(guests, request);
    assert.equal(Object.keys(reactions).length, GUEST_COUNT);
    for (const guest of guests) {
      const reaction = reactions[guest.id];
      assert.ok(VALID_CATEGORIES.has(reaction.category));
      assert.ok(reaction.intensity >= 0 && reaction.intensity <= 3);
    }
  }
});

test('整局回放可复现：同种子同投掷序列反应序列一致', () => {
  const seed = 31415;
  const script: { result: PitchResult; score: number }[] = [
    { result: 'hit', score: 10 },
    { result: 'hit', score: 10 },
    { result: 'miss', score: 0 },
    { result: 'ear', score: 5 },
    { result: 'hit', score: 10 },
    { result: 'miss', score: 0 },
    { result: 'hit', score: 10 },
    { result: 'hit', score: 10 },
  ];

  const playRound = () => {
    const guests = assignGuestSeats(seed);
    const snapshots: unknown[] = [];
    let totalScore = 0;
    const history: { result: PitchResult }[] = [];
    script.forEach((pitch, index) => {
      totalScore += pitch.score;
      history.push({ result: pitch.result });
      snapshots.push(
        decideAllGuestReactions(guests, {
          result: pitch.result,
          totalScore,
          pitchesRemaining: TOTAL_PITCHES - index - 1,
          pitchHistory: [...history],
        }),
      );
    });
    return snapshots;
  };

  assert.deepEqual(playRound(), playRound());
});

test('重置后按新种子重新分配，同种子可复现，反应回到初始状态', () => {
  const first = assignGuestSeats(100);
  const second = assignGuestSeats(200);
  assert.notDeepEqual(second, first, '新一局应重新分配席次与偏好');
  assert.deepEqual(assignGuestSeats(100), first, '回看旧局种子仍复现');
  const idle = idleReaction();
  assert.deepEqual(idle, { category: 'idle', intensity: 0 });
});

console.log('全部宾客反应验证通过');
