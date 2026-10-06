// 基于 zustand 的统一状态管理：游戏时钟、猴子状态、围观状态、铜钱与欢呼。
// 组件通过 selectAction / start / togglePause / tick 与本 store 交互；
// tick 由 Home 中的游戏循环以 100ms 间隔驱动，所有时间戳均为“游戏时间”，
// 因此暂停/切后台只需停止推进时钟即可安全恢复，不会产生时间漂移。

import { create } from 'zustand';
import type {
  ActionId,
  AudienceState,
  Cheer,
  Coin,
  GameResult,
  GameStatus,
  MonkeyState,
  Rating,
} from './types';
import {
  ACTIONS,
  CHEER_TEXTS,
  CHEER_TTL_MS,
  COIN_BLINK_MS,
  COIN_FLIGHT_MS,
  COIN_VALUE,
  FATIGUE_WARNING,
  FORCED_REST_MS,
  FORCED_REST_RECOVERY,
  FULL_HOUSE_COMBO,
  FULL_HOUSE_VALUE,
  GAME_DURATION_MS,
  GOLD_SCORE,
  GROUND_Y,
  MAX_COINS,
  MONKEY_X,
  SIGNATURE_COST,
  SIGNATURE_REFUND,
  SILVER_SCORE,
  SPECTATORS,
} from './config';

const BEST_KEY = 'baixi-best-score';
const GAMES_KEY = 'baixi-games-played';

function loadNumber(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

function saveNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // 隐私模式等场景下写入失败时静默降级，不影响游戏进行
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

let idSeq = 1;

function ratingOf(score: number): Rating {
  if (score >= GOLD_SCORE) return '金';
  if (score >= SILVER_SCORE) return '银';
  return '铜';
}

function freshMonkey(): MonkeyState {
  return {
    currentAction: null,
    actionEndsAt: null,
    actionSeq: 0,
    fatigue: 0,
    score: 0,
    combo: 0,
    energy: 0,
    forcedRestUntil: null,
  };
}

function freshAudience(): AudienceState {
  return { count: SPECTATORS.length, mood: 30, consecutiveFails: 0 };
}

export interface GameStore {
  status: GameStatus;
  /** 已推进的游戏时间（毫秒），暂停时不增长 */
  elapsed: number;
  timeLeft: number;
  monkey: MonkeyState;
  audience: AudienceState;
  coins: Coin[];
  cheers: Cheer[];
  /** 各动作冷却结束时刻（游戏时间） */
  cooldowns: Partial<Record<ActionId, number>>;
  maxCombo: number;
  successCount: number;
  failCount: number;
  best: number;
  gamesPlayed: number;
  lastResult: GameResult | null;

  start: () => void;
  togglePause: () => void;
  pause: () => void;
  selectAction: (id: ActionId) => void;
  tick: (dt: number) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  status: 'idle',
  elapsed: 0,
  timeLeft: GAME_DURATION_MS,
  monkey: freshMonkey(),
  audience: freshAudience(),
  coins: [],
  cheers: [],
  cooldowns: {},
  maxCombo: 0,
  successCount: 0,
  failCount: 0,
  best: loadNumber(BEST_KEY),
  gamesPlayed: loadNumber(GAMES_KEY),
  lastResult: null,

  start: () => {
    // 重复点击保护：已在进行中时忽略
    if (get().status === 'running') return;
    set({
      status: 'running',
      elapsed: 0,
      timeLeft: GAME_DURATION_MS,
      monkey: freshMonkey(),
      audience: freshAudience(),
      coins: [],
      cheers: [],
      cooldowns: {},
      maxCombo: 0,
      successCount: 0,
      failCount: 0,
      lastResult: null,
    });
  },

  togglePause: () => {
    const { status } = get();
    if (status === 'running') set({ status: 'paused' });
    else if (status === 'paused') set({ status: 'running' });
  },

  pause: () => {
    if (get().status === 'running') set({ status: 'paused' });
  },

  selectAction: (id) => {
    const s = get();
    // 重复操作保护：仅在进行中、猴子空闲、未罢工、冷却结束时可触发
    if (s.status !== 'running') return;
    if (s.monkey.currentAction !== null) return;
    if (s.monkey.forcedRestUntil !== null && s.elapsed < s.monkey.forcedRestUntil) return;
    const action = ACTIONS[id];
    if (!action) return;
    if ((s.cooldowns[id] ?? 0) > s.elapsed) return;
    if (id === 'signature' && s.monkey.energy < SIGNATURE_COST) return;

    const actionEndsAt = s.elapsed + action.duration;
    const fatigue = clamp(s.monkey.fatigue + action.fatigue, 0, 100);
    // 疲劳打满：动作结束后强制罢工 3 秒
    const forcedRestUntil = fatigue >= 100 ? actionEndsAt + FORCED_REST_MS : null;

    set({
      monkey: {
        ...s.monkey,
        currentAction: id,
        actionEndsAt,
        actionSeq: s.monkey.actionSeq + 1,
        fatigue,
        energy: id === 'signature' ? s.monkey.energy - SIGNATURE_COST : s.monkey.energy,
        forcedRestUntil,
      },
      cooldowns: { ...s.cooldowns, [id]: actionEndsAt + action.cooldown },
    });
  },

  tick: (dt) => {
    const s = get();
    if (s.status !== 'running') return;

    const elapsed = s.elapsed + dt;
    const timeLeft = Math.max(0, s.timeLeft - dt);
    const monkey = { ...s.monkey };
    const audience = { ...s.audience };
    let { coins, cheers, maxCombo, successCount, failCount } = s;

    // ---- 动作结算 ----
    if (monkey.currentAction !== null && monkey.actionEndsAt !== null && elapsed >= monkey.actionEndsAt) {
      const action = ACTIONS[monkey.currentAction];
      const halved = !action.alwaysSucceeds && monkey.fatigue >= FATIGUE_WARNING;
      const rate = halved ? action.successRate / 2 : action.successRate;
      const success = Math.random() < rate;

      if (success) {
        successCount += 1;
        const combo = monkey.combo + 1;
        const fullHouse = combo >= FULL_HOUSE_COMBO;
        maxCombo = Math.max(maxCombo, combo);

        const baseCoins = Math.min(8, 2 + Math.floor(audience.mood / 20));
        let count = Math.round(baseCoins * action.coinMultiplier);
        if (fullHouse) count += 2;
        if (action.id === 'signature') count *= 2;
        count = Math.min(count, 12);

        const value = fullHouse ? FULL_HOUSE_VALUE : COIN_VALUE;
        const spawned: Coin[] = [];
        for (let i = 0; i < count; i += 1) {
          const specIndex = Math.floor(Math.random() * SPECTATORS.length);
          const spec = SPECTATORS[specIndex];
          spawned.push({
            id: idSeq++,
            startX: spec.x,
            startY: GROUND_Y - spec.height,
            landX: MONKEY_X + (Math.random() * 100 - 50),
            landY: GROUND_Y - 6 + (Math.random() * 20 - 10),
            bornAt: elapsed,
            value,
            spectator: specIndex,
            phase: 'flying',
          });
        }
        coins = [...coins, ...spawned];
        // 同屏铜钱上限：超出则移除最早出现的
        if (coins.length > MAX_COINS) coins = coins.slice(coins.length - MAX_COINS);

        const cheerCount = action.id === 'signature' ? 3 : 1 + (fullHouse ? 1 : 0);
        const newCheers: Cheer[] = [];
        for (let i = 0; i < cheerCount; i += 1) {
          newCheers.push({
            id: idSeq++,
            text: CHEER_TEXTS[Math.floor(Math.random() * CHEER_TEXTS.length)],
            spectator: Math.floor(Math.random() * SPECTATORS.length),
            bornAt: elapsed,
          });
        }
        cheers = [...cheers, ...newCheers];

        audience.mood = clamp(audience.mood + action.moodGain + (fullHouse ? 5 : 0), 0, 100);
        audience.consecutiveFails = 0;
        monkey.combo = combo;
        if (action.id !== 'signature') {
          monkey.energy = clamp(monkey.energy + 25 + (fullHouse ? 10 : 0), 0, SIGNATURE_COST);
        }
      } else {
        failCount += 1;
        audience.consecutiveFails += 1;
        if (audience.consecutiveFails >= 2) {
          audience.mood = clamp(audience.mood - 10, 0, 100);
        }
        monkey.combo = 0;
        // 招牌技失败返还一半充能，避免整局努力清零
        if (action.id === 'signature') {
          monkey.energy = clamp(monkey.energy + SIGNATURE_REFUND, 0, SIGNATURE_COST);
        }
      }

      monkey.currentAction = null;
      monkey.actionEndsAt = null;
    }

    // ---- 罢工结束 ----
    if (monkey.forcedRestUntil !== null && elapsed >= monkey.forcedRestUntil) {
      monkey.forcedRestUntil = null;
      monkey.fatigue = FORCED_REST_RECOVERY;
    }

    // ---- 铜钱生命周期：飞行 -> 落地闪烁 -> 计分消失 ----
    let gained = 0;
    const aliveCoins: Coin[] = [];
    for (const coin of coins) {
      const age = elapsed - coin.bornAt;
      if (age >= COIN_FLIGHT_MS + COIN_BLINK_MS) {
        gained += coin.value;
        continue;
      }
      aliveCoins.push({
        ...coin,
        phase: age >= COIN_FLIGHT_MS ? 'landed' : 'flying',
      });
    }
    coins = aliveCoins;
    monkey.score += gained;

    // ---- 欢呼气泡过期 ----
    cheers = cheers.filter((c) => elapsed - c.bornAt < CHEER_TTL_MS);

    // ---- 终局结算 ----
    if (timeLeft <= 0) {
      // 场上未落地的铜钱一并计入，避免结尾打赏凭空消失
      const remaining = coins.reduce((sum, c) => sum + c.value, 0);
      monkey.score += remaining;
      const result: GameResult = {
        score: monkey.score,
        rating: ratingOf(monkey.score),
        maxCombo,
        successCount,
        failCount,
      };
      const best = Math.max(s.best, monkey.score);
      const gamesPlayed = s.gamesPlayed + 1;
      saveNumber(BEST_KEY, best);
      saveNumber(GAMES_KEY, gamesPlayed);
      set({
        status: 'finished',
        elapsed,
        timeLeft: 0,
        monkey: { ...monkey, currentAction: null, actionEndsAt: null },
        audience,
        coins: [],
        cheers: [],
        maxCombo,
        successCount,
        failCount,
        best,
        gamesPlayed,
        lastResult: result,
      });
      return;
    }

    set({
      elapsed,
      timeLeft,
      monkey,
      audience,
      coins,
      cheers,
      maxCombo,
      successCount,
      failCount,
    });
  },
}));
