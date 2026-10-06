export type CoinSide = 'zheng' | 'bei';

export type YaoType = 'lao-yang' | 'lao-yin' | 'shao-yang' | 'shao-yin';

export interface YaoResult {
  type: YaoType;
  isMoving: boolean;
  isYang: boolean;
}

export type YaoArray = [YaoResult, YaoResult, YaoResult, YaoResult, YaoResult, YaoResult];

export interface HexagramInfo {
  name: string;
  binary: string;
  decimal: number;
  description: string;
}

export interface HexagramMap {
  [key: string]: HexagramInfo;
}

export interface AnimationParams {
  rotation: number;
  bounce: number;
  duration: number;
}

/** 一爻的存档快照 */
export interface YaoSnapshot {
  /** 爻位：1（初爻，最下）至 6（上爻，最上） */
  position: number;
  type: YaoType;
  isYang: boolean;
  isMoving: boolean;
  coins: [CoinSide, CoinSide, CoinSide];
}

/** 卦象的存档快照（本卦或变卦） */
export interface HexagramSnapshot {
  /** 六爻二进制：索引 0 为初爻（最下），阳 1 阴 0 */
  binary: string;
  name: string;
  fullName: string;
  kingWen: number;
  guaCi: string;
  xiangCi: string;
  upperTrigram: string;
  lowerTrigram: string;
}

/** 动爻对应的变爻结论 */
export interface ChangedLine {
  /** 爻位 1-6 */
  position: number;
  /** 本卦爻题，如：初九、六五 */
  label: string;
  originalYaoCi: string;
  originalXiaoXiang: string;
  /** 变卦同位爻题（阴阳已变） */
  changedLabel: string;
  changedYaoCi: string;
  changedXiaoXiang: string;
}

export type DeductionKind = 'none' | 'single' | 'double' | 'multiple' | 'all';

/** 断卦推演结果 */
export interface DeductionResult {
  kind: DeductionKind;
  /** 动爻位置（1-6，自下而上） */
  movingPositions: number[];
  /** 变卦二进制；无动爻时与本卦一致，全动时为错卦 */
  changedBinary: string;
  /** 逐动爻的变爻结论；无动爻与六爻全动时为空 */
  changedLines: ChangedLine[];
  /** 断卦规则说明 */
  ruleText: string;
  /** 综合断语 */
  summary: string;
}

/** 一条起卦归档记录 */
export interface DivinationRecord {
  /** 全局唯一 ID（时间戳相同也不会冲突） */
  id: string;
  /** 单调递增序号，用于同毫秒排序 */
  seq: number;
  /** 起卦时刻（毫秒时间戳） */
  createdAt: number;
  /** 用户补充的所问之事 */
  question: string;
  yaos: YaoSnapshot[];
  benGua: HexagramSnapshot;
  bianGua: HexagramSnapshot;
  movingPositions: number[];
  deduction: DeductionResult;
}
