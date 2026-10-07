import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMatch, stateHash, type Scenario } from '../src/sim';

const idle: Scenario = { name: 'idle', seed: 42, templateId: 'zhang-jun' };

const scripted: Scenario = {
  name: 'scripted',
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
  ],
};

describe('确定性', () => {
  it('相同种子与输入序列重放结果完全一致', () => {
    const first = runMatch(scripted);
    const second = runMatch(scripted);
    expect(stateHash(first)).toBe(stateHash(second));
    expect(first).toEqual(second);
  });

  it('无输入空场比赛也可完全复现', () => {
    const first = runMatch(idle);
    const second = runMatch(idle);
    expect(stateHash(first)).toBe(stateHash(second));
    expect(first.phase).toBe('finished');
  });

  it('不同种子产生可区分但各自可复现的对局', () => {
    const a1 = runMatch({ ...idle, seed: 1 });
    const a2 = runMatch({ ...idle, seed: 1 });
    const b = runMatch({ ...idle, seed: 2 });
    expect(stateHash(a1)).toBe(stateHash(a2));
    expect(stateHash(a1)).not.toBe(stateHash(b));
  });

  it('批量种子下整场比赛均能收敛到终场且结论自洽', () => {
    for (let seed = 0; seed < 25; seed++) {
      const final = runMatch({ name: `seed-${seed}`, seed, templateId: 'wang-gang' });
      expect(final.phase).toBe('finished');
      expect(final.timeRemaining).toBe(0);
      expect(final.stars).toBe(0);
      const expected =
        final.score.user > final.score.opponent
          ? 'user'
          : final.score.user < final.score.opponent
            ? 'opponent'
            : 'draw';
      expect(final.result).toBe(expected);
      expect(final.goals.length).toBe(final.score.user + final.score.opponent);
    }
  });

  it('sim 内核不依赖真实时钟与全局随机源', () => {
    const simDir = fileURLToPath(new URL('../src/sim', import.meta.url));
    const forbidden = ['Math.random', 'Date.now', 'performance.now', 'setTimeout', 'setInterval'];
    for (const file of readdirSync(simDir)) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(`${simDir}/${file}`, 'utf8');
      for (const token of forbidden) {
        expect(source.includes(token), `${file} 不应包含 ${token}`).toBe(false);
      }
    }
  });
});
