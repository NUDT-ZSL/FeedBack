import { RAW_HEXAGRAMS, type RawHexagram } from './hexagramData';

export interface TrigramInfo {
  name: string;
  nature: string;
  element: '金' | '木' | '水' | '火' | '土';
}

/** 三爻二进制（自下而上，阳 1 阴 0）→ 八卦 */
const TRIGRAM_BY_BITS: Record<string, TrigramInfo> = {
  '111': { name: '乾', nature: '天', element: '金' },
  '000': { name: '坤', nature: '地', element: '土' },
  '100': { name: '震', nature: '雷', element: '木' },
  '010': { name: '坎', nature: '水', element: '水' },
  '001': { name: '艮', nature: '山', element: '土' },
  '011': { name: '巽', nature: '风', element: '木' },
  '101': { name: '离', nature: '火', element: '火' },
  '110': { name: '兑', nature: '泽', element: '金' },
};

export interface HexagramData {
  /** 六爻二进制：索引 0 为初爻（最下），索引 5 为上爻（最上） */
  binary: string;
  /** 通行本卦序（1-64） */
  kingWen: number;
  /** 卦名，如：乾、泰、小畜 */
  name: string;
  /** 全名，如：乾为天、地天泰 */
  fullName: string;
  guaCi: string;
  tuanCi: string;
  xiangCi: string;
  yaoCi: string[];
  xiaoXiang: string[];
  symbol: string;
  upperTrigram: TrigramInfo;
  lowerTrigram: TrigramInfo;
}

function trigramOf(bits: string): TrigramInfo {
  const t = TRIGRAM_BY_BITS[bits];
  if (!t) throw new Error(`未知三爻组合: ${bits}`);
  return t;
}

function buildHexagram(raw: RawHexagram, index: number): HexagramData {
  const lower = trigramOf(raw.id.slice(0, 3));
  const upper = trigramOf(raw.id.slice(3, 6));
  const fullName =
    upper.name === lower.name
      ? `${upper.name}为${upper.nature}`
      : `${upper.nature}${lower.nature}${raw.name}`;
  return {
    binary: raw.id,
    kingWen: index + 1,
    name: raw.name,
    fullName,
    guaCi: raw.guaCi,
    tuanCi: raw.tuanCi,
    xiangCi: raw.daXiang,
    yaoCi: raw.yaoCi,
    xiaoXiang: raw.xiaoXiang,
    symbol: raw.symbol,
    upperTrigram: upper,
    lowerTrigram: lower,
  };
}

export const HEXAGRAMS: HexagramData[] = RAW_HEXAGRAMS.map(buildHexagram);

const hexagramMap = new Map<string, HexagramData>(HEXAGRAMS.map((h) => [h.binary, h]));

/**
 * 按六爻二进制查卦。
 * @param binary 6 位 0/1 字符串，索引 0 为初爻（最下），阳为 1、阴为 0
 */
export function getHexagramByBinary(binary: string): HexagramData {
  const hexagram = hexagramMap.get(binary);
  if (!hexagram) {
    throw new Error(`未找到卦象: ${binary}`);
  }
  return hexagram;
}

export function getTrigramByBits(bits: string): TrigramInfo {
  return trigramOf(bits);
}
