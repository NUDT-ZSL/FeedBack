// 游戏逻辑工具函数（被 store 调用）
import type { Action, AudienceMember, AudienceType, Coin, PropDef } from '@/types';

export const GAME_DURATION = 60;      // 一局时长（秒）
export const STUN_DURATION = 3;       // 罢工时长（秒）
export const COIN_CAP = 20;           // 铜钱同时存在上限
export const MAX_AUDIENCE = 10;       // 围观人数上限
export const BEST_SCORE_KEY = 'tang-baixi-best-score';

/** 表演动作表 */
export const ACTIONS: Action[] = [
  { id: 'climb', name: '爬竿', icon: '🎋', duration: 2, successRate: 0.85, fatigueCost: 10, moodBoost: 8, rewardMultiplier: 1, cooldown: 2 },
  { id: 'somersault', name: '翻筋斗', icon: '🤸', duration: 1.5, successRate: 0.75, fatigueCost: 15, moodBoost: 10, rewardMultiplier: 1.2, cooldown: 3 },
  { id: 'handstand', name: '倒立', icon: '🙃', duration: 2.5, successRate: 0.7, fatigueCost: 12, moodBoost: 12, rewardMultiplier: 1.3, cooldown: 4 },
  { id: 'triple-flip', name: '三连筋斗', icon: '🌀', duration: 3, successRate: 0.6, fatigueCost: 25, moodBoost: 20, rewardMultiplier: 1.5, cooldown: 6 },
  { id: 'rest', name: '休息', icon: '💤', duration: 2, successRate: 1, fatigueCost: -20, moodBoost: 0, rewardMultiplier: 0, cooldown: 0, isRest: true },
];

/** 彩戏道具表（扩展能力） */
export const PROPS: PropDef[] = [
  { id: 'ribbon', name: '彩绫', icon: '🎀', description: '下一次表演成功率 +20%', stock: 2, cooldown: 0 },
  { id: 'gong', name: '铜锣', icon: '🥁', description: '鸣锣聚客：情绪 +15，吸引新看客', stock: 3, cooldown: 12 },
  { id: 'banana', name: '香蕉', icon: '🍌', description: '疲劳 -30，可唤醒罢工的猴子', stock: 3, cooldown: 0 },
];

/** 动作成功判定：疲劳 ≥80 成功率减半；彩绫加护 +20% */
export function calculateSuccess(action: Action, fatigue: number, ribbonBoost: boolean): boolean {
  if (action.isRest) return true;
  let rate = action.successRate;
  if (fatigue >= 80) rate *= 0.5;
  if (ribbonBoost) rate += 0.2;
  return Math.random() < Math.min(rate, 1);
}

/** 铜钱数量：基础 2 枚 + 情绪加成，上限 8 枚 */
export function calculateCoinCount(mood: number): number {
  const base = 2;
  const bonus = Math.floor(mood / 20);
  return Math.min(base + bonus, 8);
}

/** 单枚铜钱面值：5-15 文 × 动作倍率 */
export function calculateCoinValue(rewardMultiplier: number): number {
  return Math.round((5 + Math.random() * 10) * rewardMultiplier);
}

/** 评级阈值：金 ≥300，银 ≥150，铜 <150 */
export function getRank(score: number): { label: string; color: string } {
  if (score >= 300) return { label: '金', color: '#ebb04b' };
  if (score >= 150) return { label: '银', color: '#b8c4c4' };
  return { label: '铜', color: '#b0793a' };
}

const AUDIENCE_STYLE: Record<AudienceType, string> = {
  scholar: '#3a6b8d',   // 书生青
  merchant: '#c0392b',  // 胡商红
  elder: '#7a8a7a',     // 老者灰
  child: '#d4a76a',     // 孩童黄
};
const AUDIENCE_TYPES: AudienceType[] = ['scholar', 'merchant', 'elder', 'child'];

/** 生成一名围观者（位置沿舞台边缘百分比分布） */
export function createAudienceMember(seq: number): AudienceMember {
  const type = AUDIENCE_TYPES[Math.floor(Math.random() * AUDIENCE_TYPES.length)];
  const side = Math.random();
  // 左/右/下三侧边缘站位，避开顶部标题区
  const position =
    side < 0.4
      ? { x: 4 + Math.random() * 8, y: 25 + Math.random() * 60 }
      : side < 0.8
        ? { x: 88 + Math.random() * 8, y: 25 + Math.random() * 60 }
        : { x: 15 + Math.random() * 70, y: 88 + Math.random() * 8 };
  return { id: `aud-${seq}-${Math.random().toString(36).slice(2, 7)}`, type, color: AUDIENCE_STYLE[type], position };
}

/** 猴子表演台中心（舞台百分比） */
export const MONKEY_POS = { x: 50, y: 78 };

/** 生成一次打赏的铜钱列表：从随机围观者抛向猴子周围 */
export function spawnCoins(members: AudienceMember[], mood: number, rewardMultiplier: number, now: number, seqStart: number): Coin[] {
  const count = calculateCoinCount(mood);
  const coins: Coin[] = [];
  for (let i = 0; i < count; i++) {
    const thrower = members.length > 0 ? members[Math.floor(Math.random() * members.length)] : null;
    const startPos = thrower ? thrower.position : { x: 10 + Math.random() * 80, y: 20 };
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 8; // 落点分布在猴子周围（约 50px 视觉半径）
    coins.push({
      id: `coin-${seqStart}-${i}`,
      startPos,
      endPos: {
        x: Math.min(95, Math.max(5, MONKEY_POS.x + Math.cos(angle) * radius)),
        y: Math.min(95, Math.max(5, MONKEY_POS.y + Math.sin(angle) * radius * 0.6)),
      },
      value: calculateCoinValue(rewardMultiplier),
      createdAt: now,
      flightTime: 0.9 + Math.random() * 0.3,
      collected: false,
    });
  }
  return coins;
}

export function readBestScore(): number {
  try {
    return Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function writeBestScore(score: number): void {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(score));
  } catch {
    // 隐私模式等场景下静默失败
  }
}
