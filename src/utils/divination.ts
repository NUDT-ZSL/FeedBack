import type { HexagramText } from '@/data/hexagrams';
import { getHexagramByBinary } from '@/data/hexagrams';
import { deriveBianBinary, yaoLabel } from '@/utils/hexagramCalc';

/** 一条变爻结论 */
export interface YaoReading {
  /** 爻位 1-6，1 为初爻 */
  position: number;
  /** 爻位名称，如 初九、六五 */
  label: string;
  /** 爻辞取自 本卦/变卦 */
  source: 'ben' | 'bian';
  /** 所属卦名 */
  hexagramName: string;
  /** 爻辞正文 */
  yaoCi: string;
  /** 是否为主断之爻（多爻取断时区分主辅） */
  primary: boolean;
}

/** 一条卦辞参考 */
export interface GuaCiRef {
  source: 'ben' | 'bian';
  hexagramName: string;
  guaCi: string;
  note: string;
}

/** 断卦推演结果 */
export interface Deduction {
  movingCount: number;
  ben: HexagramText;
  bian: HexagramText;
  benBinary: string;
  bianBinary: string;
  /** 是否六爻全动 */
  allMoving: boolean;
  /** 断卦规则说明 */
  rule: string;
  /** 变爻结论（无动爻、三爻动、六爻全动时为空） */
  readings: YaoReading[];
  /** 需要参考的卦辞 */
  guaCiRefs: GuaCiRef[];
  /** 用九/用六辞（仅乾坤二卦六爻全动时给出） */
  yongCi?: string;
}

function mustGet(binary: string): HexagramText {
  const hexagram = getHexagramByBinary(binary);
  if (!hexagram) {
    throw new Error(`未找到卦象: ${binary}`);
  }
  return hexagram;
}

/**
 * 断卦推演：根据本卦爻序与动爻位置推导变卦，并按动爻数量给出变爻结论。
 *
 * 规则（依朱熹《易学启蒙》考变之法）：
 * - 无动爻：变卦与本卦一致，以本卦卦辞断，不产生变爻结论；
 * - 一爻动：以本卦变爻爻辞断；
 * - 二爻动：以本卦两变爻爻辞断，以上爻为主；
 * - 三爻动：参断本卦与变卦卦辞，本卦为贞（体），变卦为悔（用）；
 * - 四爻动：以变卦中不变的两爻爻辞断，以下爻为主；
 * - 五爻动：以变卦中不变的一爻爻辞断；
 * - 六爻全动：整体以变卦卦辞断（乾坤二卦另以用九/用六断），不逐爻拼合。
 */
export function deduce(benBinary: string, movingPositions: number[]): Deduction {
  const ben = mustGet(benBinary);
  const bianBinary = deriveBianBinary(benBinary, movingPositions);
  const bian = mustGet(bianBinary);
  const movingCount = movingPositions.length;
  const allMoving = movingCount === 6;

  const base: Deduction = {
    movingCount,
    ben,
    bian,
    benBinary,
    bianBinary,
    allMoving,
    rule: '',
    readings: [],
    guaCiRefs: [],
  };

  const benReading = (position: number, primary: boolean): YaoReading => ({
    position,
    label: yaoLabel(position, benBinary[position - 1] === '1'),
    source: 'ben',
    hexagramName: ben.name,
    yaoCi: ben.yaoCi[position - 1],
    primary,
  });

  const bianReading = (position: number, primary: boolean): YaoReading => ({
    position,
    label: yaoLabel(position, bianBinary[position - 1] === '1'),
    source: 'bian',
    hexagramName: bian.name,
    yaoCi: bian.yaoCi[position - 1],
    primary,
  });

  switch (movingCount) {
    case 0:
      base.rule = '六爻安静，无有动爻，变卦与本卦一致，以本卦卦辞断。';
      base.guaCiRefs = [
        { source: 'ben', hexagramName: ben.name, guaCi: ben.guaCi, note: '本卦卦辞' },
      ];
      break;
    case 1:
      base.rule = '一爻动，以本卦变爻爻辞断。';
      base.readings = [benReading(movingPositions[0], true)];
      break;
    case 2: {
      base.rule = '二爻动，以本卦两变爻爻辞断，以上爻为主、下爻为辅。';
      const sorted = [...movingPositions].sort((a, b) => b - a);
      base.readings = [
        benReading(sorted[0], true),
        benReading(sorted[1], false),
      ];
      break;
    }
    case 3:
      base.rule = '三爻动，参断本卦与变卦卦辞：本卦为贞（体），变卦为悔（用）。';
      base.guaCiRefs = [
        { source: 'ben', hexagramName: ben.name, guaCi: ben.guaCi, note: '本卦卦辞（贞/体）' },
        { source: 'bian', hexagramName: bian.name, guaCi: bian.guaCi, note: '变卦卦辞（悔/用）' },
      ];
      break;
    case 4: {
      base.rule = '四爻动，以变卦中不变的两爻爻辞断，以下爻为主、上爻为辅。';
      const staticPositions = [1, 2, 3, 4, 5, 6].filter((p) => !movingPositions.includes(p));
      base.readings = [
        bianReading(staticPositions[0], true),
        bianReading(staticPositions[1], false),
      ];
      break;
    }
    case 5: {
      base.rule = '五爻动，以变卦中不变的一爻爻辞断。';
      const staticPositions = [1, 2, 3, 4, 5, 6].filter((p) => !movingPositions.includes(p));
      base.readings = [bianReading(staticPositions[0], true)];
      break;
    }
    case 6: {
      base.rule = '六爻全动，不逐爻取断，整体以变卦卦辞断。';
      base.guaCiRefs = [
        { source: 'bian', hexagramName: bian.name, guaCi: bian.guaCi, note: '变卦卦辞' },
      ];
      if (ben.yongCi) {
        base.yongCi = ben.yongCi;
        base.rule = `六爻全动，不逐爻取断。${ben.guaMing}卦六爻皆动，以「${ben.yongCi.slice(0, 2)}」断，并参变卦卦辞。`;
      }
      break;
    }
  }

  return base;
}
