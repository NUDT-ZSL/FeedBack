// zustand 状态管理（被组件调用）
// 集中管理游戏时钟、猴子状态、围观状态、铜钱列表与彩戏道具
import { create } from 'zustand';
import type { Action, Coin, GameState } from '@/types';
import {
  ACTIONS,
  COIN_CAP,
  GAME_DURATION,
  MAX_AUDIENCE,
  PROPS,
  STUN_DURATION,
  calculateSuccess,
  createAudienceMember,
  getRank,
  readBestScore,
  spawnCoins,
  writeBestScore,
} from '@/utils/gameLogic';

export interface GameStore extends GameState {
  tick: (deltaSeconds: number) => void;
  selectAction: (actionId: string) => void;
  useProp: (propId: string) => void;
  startGame: () => void;
  resetGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  collectCoin: (coinId: string) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function initialAudience(count: number) {
  const members = Array.from({ length: count }, (_, i) => createAudienceMember(i));
  return { count, mood: 60, members };
}

function createInitialState(): GameState {
  return {
    phase: 'ready',
    gameTime: 0,
    timeLeft: GAME_DURATION,
    monkey: {
      currentAction: null,
      fatigue: 0,
      score: 0,
      isStunned: false,
      stunEndTime: 0,
      consecutiveFailures: 0,
    },
    audience: initialAudience(6),
    coins: [],
    actionCooldowns: {},
    actionStartedAt: null,
    props: PROPS.map((p) => ({ id: p.id, stock: p.stock, cooldownUntil: 0 })),
    ribbonActive: false,
    bestScore: readBestScore(),
    lastRoundScore: null,
  };
}

/** 结算本局：落袋所有在飞铜钱，写入历史最佳 */
function settleRound(state: GameState): GameState {
  const inFlight = state.coins.filter((c) => !c.collected);
  const bonus = inFlight.reduce((sum, c) => sum + c.value, 0);
  const score = state.monkey.score + bonus;
  const bestScore = Math.max(state.bestScore, score);
  if (bestScore !== state.bestScore) writeBestScore(bestScore);
  return {
    ...state,
    phase: 'over',
    coins: [],
    lastRoundScore: score,
    bestScore,
    monkey: { ...state.monkey, score, currentAction: null, isStunned: false },
    actionStartedAt: null,
  };
}

export const useGameStore = create<GameStore>((set, get) => ({
  ...createInitialState(),

  tick: (deltaSeconds) => {
    const state = get();
    if (state.phase !== 'playing') return;

    const dt = Math.min(deltaSeconds, 0.25); // 切后台/卡顿后的钳制，避免一次性跳变
    const now = state.gameTime + dt;
    const gameTime = now;
    const timeLeft = Math.max(0, GAME_DURATION - now);

    const monkey = { ...state.monkey };
    const audience = { ...state.audience };
    let coins = state.coins;
    let actionCooldowns = state.actionCooldowns;
    let props = state.props;
    let actionStartedAt = state.actionStartedAt;
    let ribbonActive = state.ribbonActive;

    // 1. 当前表演动作结算
    const action = monkey.currentAction;
    if (action && actionStartedAt !== null && now >= actionStartedAt + action.duration) {
      const success = calculateSuccess(action, monkey.fatigue, ribbonActive);

      if (action.isRest) {
        // 休息：恢复疲劳，不产生打赏
        monkey.fatigue = clamp(monkey.fatigue + action.fatigueCost, 0, 100);
        monkey.consecutiveFailures = 0;
      } else if (success) {
        // 成功：情绪上升、看客打赏、连击计数清零
        audience.mood = clamp(audience.mood + action.moodBoost, 0, 100);
        monkey.consecutiveFailures = 0;
        const newCoins = spawnCoins(audience.members, audience.mood, action.rewardMultiplier, now, Date.now());
        coins = [...coins, ...newCoins];
      } else {
        // 失败：无打赏，连续 2 次失败情绪 -10
        monkey.consecutiveFailures += 1;
        if (monkey.consecutiveFailures >= 2) {
          audience.mood = clamp(audience.mood - 10, 0, 100);
          monkey.consecutiveFailures = 0;
        }
      }

      if (!action.isRest) {
        monkey.fatigue = clamp(monkey.fatigue + action.fatigueCost, 0, 100);
      }

      // 疲劳满 100：猴子罢工 3 秒（休息动作除外）
      if (monkey.fatigue >= 100 && !monkey.isStunned && !action.isRest) {
        monkey.isStunned = true;
        monkey.stunEndTime = now + STUN_DURATION;
      }

      // 动作进入冷却
      if (action.cooldown > 0) {
        actionCooldowns = { ...actionCooldowns, [action.id]: now + action.cooldown };
      }

      // 彩绫在本次判定后消耗（无论成功与否）
      if (ribbonActive && !action.isRest) {
        ribbonActive = false;
        props = props.map((p) => (p.id === 'ribbon' ? { ...p, stock: p.stock - 1 } : p));
      }

      monkey.currentAction = null;
      actionStartedAt = null;
    }

    // 2. 罢工恢复
    if (monkey.isStunned && now >= monkey.stunEndTime) {
      monkey.isStunned = false;
      monkey.fatigue = 60; // 恢复后留有余量，便于立刻继续演出
    }

    // 3. 到点铜钱自动落袋（动画回调 collectCoin 是双保险）
    if (coins.some((c) => !c.collected && now >= c.createdAt + c.flightTime)) {
      let landed = 0;
      coins = coins.map((c) => {
        if (!c.collected && now >= c.createdAt + c.flightTime) {
          landed += c.value;
          return { ...c, collected: true };
        }
        return c;
      });
      if (landed > 0) monkey.score += landed;
    }
    // 已落袋铜钱下一帧清理（保留一帧落地视觉）
    coins = coins.filter((c) => !(c.collected && now >= c.createdAt + c.flightTime + 0.3));

    // 4. 铜钱池上限：超出直接计入得分，避免无限增长
    if (coins.length > COIN_CAP) {
      const overflow = coins.slice(0, coins.length - COIN_CAP);
      coins = coins.slice(coins.length - COIN_CAP);
      monkey.score += overflow.reduce((sum, c) => sum + c.value, 0);
    }

    // 5. 时间到：结算
    if (timeLeft <= 0) {
      set(
        settleRound({
          ...state,
          gameTime: GAME_DURATION,
          timeLeft: 0,
          monkey,
          audience,
          coins,
          actionCooldowns,
          props,
          actionStartedAt,
          ribbonActive,
        }),
      );
      return;
    }

    set({ gameTime, timeLeft, monkey, audience, coins, actionCooldowns, props, actionStartedAt, ribbonActive });
  },

  selectAction: (actionId) => {
    const state = get();
    if (state.phase !== 'playing') return;
    if (state.monkey.currentAction) return; // 表演进行中：忽略重复点击
    if (state.monkey.isStunned) return;     // 罢工期不可点
    const action = ACTIONS.find((a) => a.id === actionId);
    if (!action) return;
    if (state.gameTime < (state.actionCooldowns[actionId] ?? 0)) return; // 冷却中
    set({
      monkey: { ...state.monkey, currentAction: action },
      actionStartedAt: state.gameTime,
    });
  },

  useProp: (propId) => {
    const state = get();
    if (state.phase !== 'playing') return;

    const slot = state.props.find((p) => p.id === propId);
    if (!slot || slot.stock <= 0) return;                 // 无库存：忽略重复/非法调用
    if (state.gameTime < slot.cooldownUntil) return;      // 冷却中
    // 罢工期只有香蕉可用（唤醒）
    if (state.monkey.isStunned && propId !== 'banana') return;

    if (propId === 'ribbon') {
      if (state.ribbonActive) return;                     // 加护已生效：避免重复消耗
      if (state.monkey.currentAction) return;             // 表演中不允许临时加护
      set({ ribbonActive: true });
      return;
    }

    const props = state.props.map((p) => (p.id === propId ? { ...p, stock: p.stock - 1 } : p));

    if (propId === 'gong') {
      const audience = { ...state.audience };
      audience.mood = clamp(audience.mood + 15, 0, 100);
      if (audience.members.length < MAX_AUDIENCE) {
        audience.members = [...audience.members, createAudienceMember(audience.members.length)];
        audience.count = audience.members.length;
      }
      const cooldown = PROPS.find((p) => p.id === 'gong')!.cooldown;
      set({
        audience,
        props: props.map((p) => (p.id === 'gong' ? { ...p, cooldownUntil: state.gameTime + cooldown } : p)),
      });
      return;
    }

    if (propId === 'banana') {
      const monkey = { ...state.monkey };
      monkey.fatigue = clamp(monkey.fatigue - 30, 0, 100);
      // 立即唤醒罢工的猴子（失败恢复）
      if (monkey.isStunned) {
        monkey.isStunned = false;
        monkey.stunEndTime = 0;
      }
      set({ monkey, props });
    }
  },

  collectCoin: (coinId) => {
    const state = get();
    // 暂停/开场时不结算：游戏时钟冻结，恢复后由 tick 统一落袋
    if (state.phase !== 'playing') return;
    const coin = state.coins.find((c) => c.id === coinId);
    if (!coin || coin.collected) return; // 幂等：动画回调与时钟结算可能同时触发
    set({
      coins: state.coins.map((c) => (c.id === coinId ? { ...c, collected: true } : c)),
      monkey: { ...state.monkey, score: state.monkey.score + coin.value },
    });
  },

  startGame: () => {
    const fresh = createInitialState();
    set({ ...fresh, phase: 'playing', bestScore: get().bestScore });
  },

  resetGame: () => set(createInitialState()),

  pauseGame: () => {
    if (get().phase !== 'playing') return;
    set({ phase: 'paused' });
  },

  resumeGame: () => {
    if (get().phase !== 'paused') return;
    set({ phase: 'playing' });
  },
}));

/** 当前表演动作剩余耗时（秒），供 UI 展示进度 */
export function actionProgress(state: GameState): { action: Action | null; remaining: number; duration: number } {
  if (!state.monkey.currentAction || state.actionStartedAt === null) {
    return { action: null, remaining: 0, duration: 0 };
  }
  const duration = state.monkey.currentAction.duration;
  const elapsed = state.gameTime - state.actionStartedAt;
  return { action: state.monkey.currentAction, remaining: Math.max(0, duration - elapsed), duration };
}

/** 选择器辅助：单枚铜钱是否已被结算 */
export function isCoinPending(coin: Coin): boolean {
  return !coin.collected;
}

// 重新导出评级，供结算组件复用同一约定
export { getRank };
