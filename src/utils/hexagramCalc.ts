import type {
  ChangedLine,
  DeductionResult,
  HexagramSnapshot,
  YaoResult,
  YaoSnapshot,
} from '@/types';
import { getHexagramByBinary, type HexagramData } from '@/data/hexagrams';

/**
 * 六爻结果数组 → 二进制串。
 * 约定：数组索引 0 为初爻（最下），输出串索引同为 0，阳为 1、阴为 0。
 */
export function yaoArrayToBinary(yaoArray: YaoResult[]): string {
  return yaoArray.map((yao) => (yao.isYang ? '1' : '0')).join('');
}

/** 动爻位置列表（1-6，自下而上） */
export function getMovingPositions(yaoArray: YaoResult[]): number[] {
  const positions: number[] = [];
  yaoArray.forEach((yao, index) => {
    if (yao.isMoving) positions.push(index + 1);
  });
  return positions;
}

/**
 * 推导变卦二进制：动爻阴阳翻转，静爻不变。
 * 无动爻时与本卦一致；六爻全动时即为本卦的错卦（逐位取反）。
 * 爻位严格一一对应，不涉及上下卦换位。
 */
export function deriveChangedBinary(binary: string, movingPositions: number[]): string {
  const moving = new Set(movingPositions);
  return binary
    .split('')
    .map((bit, index) => (moving.has(index + 1) ? (bit === '1' ? '0' : '1') : bit))
    .join('');
}

const YANG_LABELS = ['初九', '九二', '九三', '九四', '九五', '上九'];
const YIN_LABELS = ['初六', '六二', '六三', '六四', '六五', '上六'];

/** 爻题：position 1-6，自下而上 */
export function yaoLabel(position: number, isYang: boolean): string {
  return (isYang ? YANG_LABELS : YIN_LABELS)[position - 1];
}

export function toSnapshot(hexagram: HexagramData): HexagramSnapshot {
  return {
    binary: hexagram.binary,
    name: hexagram.name,
    fullName: hexagram.fullName,
    kingWen: hexagram.kingWen,
    guaCi: hexagram.guaCi,
    xiangCi: hexagram.xiangCi,
    upperTrigram: hexagram.upperTrigram.name,
    lowerTrigram: hexagram.lowerTrigram.name,
  };
}

function buildChangedLine(
  position: number,
  benGua: HexagramData,
  bianGua: HexagramData,
): ChangedLine {
  const index = position - 1;
  const isYang = benGua.binary[index] === '1';
  return {
    position,
    label: yaoLabel(position, isYang),
    originalYaoCi: benGua.yaoCi[index],
    originalXiaoXiang: benGua.xiaoXiang[index],
    changedLabel: yaoLabel(position, !isYang),
    changedYaoCi: bianGua.yaoCi[index],
    changedXiaoXiang: bianGua.xiaoXiang[index],
  };
}

/**
 * 断卦推演：根据本卦与动爻推导变卦，并给出断卦结论。
 * 覆盖四种情形：无动爻、单动爻、多动爻（2-5）、六爻全动。
 */
export function buildDeduction(binary: string, movingPositions: number[]): DeductionResult {
  const benGua = getHexagramByBinary(binary);
  const changedBinary = deriveChangedBinary(binary, movingPositions);
  const bianGua = getHexagramByBinary(changedBinary);
  const count = movingPositions.length;

  if (count === 0) {
    return {
      kind: 'none',
      movingPositions,
      changedBinary,
      changedLines: [],
      ruleText: '六爻安静，无有动爻。变卦与本卦相同，不产生变爻结论。',
      summary: `此卦六爻皆静，事体安定少变，宜以本卦《${benGua.name}》卦辞为断：“${benGua.guaCi}”大象曰：“${benGua.xiangCi}”`,
    };
  }

  if (count === 6) {
    const isQianKun = benGua.name === '乾' || benGua.name === '坤';
    const yongIndex = 6;
    const summary = isQianKun
      ? `六爻尽动，${benGua.name === '乾' ? '乾' : '坤'}变为${bianGua.name}，不逐爻取辞，当以${benGua.name}卦「${benGua.name === '乾' ? '用九' : '用六'}」为断：“${benGua.yaoCi[yongIndex]}”`
      : `六爻尽动，本卦《${benGua.name}》六爻全变而为《${bianGua.name}》（错卦），不逐爻取辞，当以变卦卦辞为断：“${bianGua.guaCi}”`;
    return {
      kind: 'all',
      movingPositions,
      changedBinary,
      changedLines: [],
      ruleText:
        '六爻皆动，整体取变：变卦为本卦之错卦（六爻尽变），不作逐爻拼合。乾、坤二卦以「用九」「用六」之辞为断，其余各卦以变卦卦辞为断。',
      summary,
    };
  }

  const changedLines = movingPositions.map((pos) => buildChangedLine(pos, benGua, bianGua));

  if (count === 1) {
    const line = changedLines[0];
    return {
      kind: 'single',
      movingPositions,
      changedBinary,
      changedLines,
      ruleText: '一爻独发，以本卦动爻之爻辞为主断，兼参变卦同位之爻辞。',
      summary: `此卦${line.label}独动，主断曰：“${line.originalYaoCi}”变而为《${bianGua.name}》，事势将由此爻之机而转。`,
    };
  }

  if (count === 2) {
    const upper = changedLines[changedLines.length - 1];
    const lower = changedLines[0];
    return {
      kind: 'double',
      movingPositions,
      changedBinary,
      changedLines,
      ruleText: '两爻齐动，以本卦两动爻之辞参断，居上之动爻为主、居下为辅。',
      summary: `此卦${lower.label}、${upper.label}两爻齐动，以${upper.label}为主：“${upper.originalYaoCi}”参以${lower.label}：“${lower.originalYaoCi}”变而为《${bianGua.name}》。`,
    };
  }

  return {
    kind: 'multiple',
    movingPositions,
    changedBinary,
    changedLines,
    ruleText: '多爻发动（三至五爻），以本卦与变卦之卦辞合参，本卦为体、变卦为用，各动爻之辞可供参考。',
    summary: `此卦${count}爻发动，事绪纷更，宜合参两卦卦辞。本卦《${benGua.name}》：“${benGua.guaCi}”变卦《${bianGua.name}》：“${bianGua.guaCi}”`,
  };
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

/** 由存档的六爻快照重建完整推演（用于详情页兜底校验） */
export function rebuildDeduction(yaos: YaoSnapshot[]): DeductionResult {
  const binary = yaoArrayToBinary(yaos);
  return buildDeduction(binary, getMovingPositions(yaos));
}
