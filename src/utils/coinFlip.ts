import type { CoinSide, YaoResult, YaoType, AnimationParams } from '@/types';

export function flipSingleCoin(): CoinSide {
  return Math.random() < 0.5 ? 'zheng' : 'bei';
}

export function determineYaoType(coins: [CoinSide, CoinSide, CoinSide]): YaoResult {
  const zhengCount = coins.filter(c => c === 'zheng').length;

  let type: YaoType;
  let isMoving: boolean;
  let isYang: boolean;

  if (zhengCount === 3) {
    type = 'lao-yang';
    isMoving = true;
    isYang = true;
  } else if (zhengCount === 0) {
    type = 'lao-yin';
    isMoving = true;
    isYang = false;
  } else if (zhengCount === 2) {
    type = 'shao-yang';
    isMoving = false;
    isYang = true;
  } else {
    type = 'shao-yin';
    isMoving = false;
    isYang = false;
  }

  return { type, isMoving, isYang };
}

export function getRandomAnimationParams(): AnimationParams {
  const rotation = Math.floor(Math.random() * 361) + 360;
  const bounce = Math.floor(Math.random() * 21) - 10;
  const duration = Number((Math.random() * 0.2 + 0.5).toFixed(2));

  return { rotation, bounce, duration };
}
