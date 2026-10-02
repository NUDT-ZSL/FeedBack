import type { YaoArray, HexagramInfo } from '@/types';
import { hexagramMap } from '@/data/hexagrams';

export function yaoArrayToBinary(yaoArray: YaoArray): string {
  return yaoArray.map(yao => yao.isYang ? '1' : '0').join('');
}

export function binaryToDecimal(binary: string): number {
  return parseInt(binary, 2);
}

export function calculateHexagram(yaoArray: YaoArray): HexagramInfo {
  const binary = yaoArrayToBinary(yaoArray);
  const hexagram = hexagramMap[binary];

  if (!hexagram) {
    throw new Error(`未找到卦象: ${binary}`);
  }

  return hexagram;
}

export function validateYaoOrder(yaoArray: YaoArray): string | null {
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
