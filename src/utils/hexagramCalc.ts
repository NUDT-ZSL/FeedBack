import type { Yao, YaoResult } from '@/types';
import { getHexagramByBinary, type HexagramText } from '@/data/hexagrams';

/** 六爻阴阳转二进制串：初爻在前，阳 1 阴 0 */
export function yaoArrayToBinary(yaoArray: YaoResult[]): string {
  return yaoArray.map((yao) => (yao.isYang ? '1' : '0')).join('');
}

/** 由六爻查询本卦 */
export function calculateHexagram(yaoArray: YaoResult[]): HexagramText {
  const binary = yaoArrayToBinary(yaoArray);
  const hexagram = getHexagramByBinary(binary);
  if (!hexagram) {
    throw new Error(`未找到卦象: ${binary}`);
  }
  return hexagram;
}

/** 动爻位置（1-6，自下而上） */
export function getMovingPositions(yaos: Yao[]): number[] {
  return yaos.filter((y) => y.isMoving).map((y) => y.position);
}

/**
 * 由本卦爻序与动爻位置推导变卦爻序。
 * 逐位对应翻转动爻阴阳，爻位严格保持初爻在前，不会上下颠倒。
 */
export function deriveBianBinary(benBinary: string, movingPositions: number[]): string {
  const moving = new Set(movingPositions);
  return benBinary
    .split('')
    .map((bit, index) => (moving.has(index + 1) ? (bit === '1' ? '0' : '1') : bit))
    .join('');
}

const POSITION_NAMES = ['初', '二', '三', '四', '五', '上'] as const;

/** 爻位名称，如 初九、六二、上六 */
export function yaoLabel(position: number, isYang: boolean): string {
  const num = isYang ? '九' : '六';
  if (position === 1) return `初${num}`;
  if (position === 6) return `上${num}`;
  return `${num}${POSITION_NAMES[position - 1]}`;
}

export function validateYaoOrder(yaoArray: YaoResult[]): string | null {
  if (!Array.isArray(yaoArray)) {
    return '爻序必须是数组';
  }
  if (yaoArray.length !== 6) {
    return `爻序长度必须为6，当前为${yaoArray.length}`;
  }
  for (let i = 0; i < yaoArray.length; i++) {
    const yao = yaoArray[i];
    if (!yao || typeof yao !== 'object') {
      return `第${i + 1}爻格式不正确`;
    }
    if (typeof yao.isYang !== 'boolean') {
      return `第${i + 1}爻缺少isYang属性`;
    }
    if (typeof yao.isMoving !== 'boolean') {
      return `第${i + 1}爻缺少isMoving属性`;
    }
    if (!['lao-yang', 'lao-yin', 'shao-yang', 'shao-yin'].includes(yao.type)) {
      return `第${i + 1}爻类型不正确`;
    }
  }
  return null;
}
