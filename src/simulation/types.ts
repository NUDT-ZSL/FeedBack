/**
 * 灌溉推演引擎 —— 类型定义
 *
 * 该模块与渲染链路完全解耦：不依赖 React / Three.js / DOM，
 * 同一份输入在任意环境（浏览器 / Node 离线脚本）下推演结果完全一致。
 */

/** 水车参数：转速沿用 PRD 口径 speed = gateOpening × sin(sailAngle°) × 0.8 */
export interface WheelParams {
  id: string;
  name: string;
  /** 闸门开度 0-100（%） */
  gateOpening: number;
  /** 风帆角度 0-90（度） */
  sailAngle: number;
  /** 提水效率：每单位转速折算的提水量 */
  liftEfficiency: number;
}

/** 渠道参数：按分流比例把上游来水分配到各条支渠 */
export interface ChannelParams {
  id: string;
  name: string;
  /** 分流比例，同一时刻所有渠道之和应 ≤ 1，剩余部分记为弃水 */
  shareRatio: number;
  /** 驱动该渠道水车的 id */
  wheelId: string;
  /** 该渠道灌溉的全部田块 id */
  fieldIds: string[];
}

/** 田块参数 */
export interface FieldParams {
  id: string;
  name: string;
  /** 蓄水容量上限 */
  capacity: number;
  /** 初始蓄水量 */
  initialStorage: number;
  /** 每 tick 蒸散消耗 */
  evaporationRate: number;
  /** 作物缺水阈值：蓄水量低于该值判定为缺水 */
  cropDemandThreshold: number;
}

/** 一次推演的完整输入（唯一事实来源，界面与离线脚本共用） */
export interface ScenarioInput {
  id: string;
  label: string;
  /** 推演步数（tick） */
  ticks: number;
  /** 每个 tick 的上游来水量（恒定来水） */
  upstreamInflow: number;
  wheels: WheelParams[];
  channels: ChannelParams[];
  fields: FieldParams[];
}

/** 单个 tick 内某条渠道的水量记录 */
export interface ChannelTickRecord {
  tick: number;
  channelId: string;
  /** 按分流比例分得的水量 */
  allocated: number;
  /** 水车实际提水量 */
  lifted: number;
  /** 未利用而溢出的水量 */
  spilled: number;
}

/** 单个 tick 内某块田的蓄水推进记录（缺水判定依据可追溯） */
export interface FieldTickRecord {
  tick: number;
  fieldId: string;
  storageBefore: number;
  inflow: number;
  evaporation: number;
  storageAfter: number;
  /** 因容量上限而溢出的水量 */
  overflow: number;
  deficit: boolean;
  deficitMargin: number;
}

/** 单个 tick 内某台水车的状态记录 */
export interface WheelTickRecord {
  tick: number;
  wheelId: string;
  speed: number;
  lifted: number;
}

/** 某块田的缺水判定结论与依据 */
export interface FieldDeficitSummary {
  fieldId: string;
  deficitTicks: number[];
  deficitCount: number;
  finalStorage: number;
  threshold: number;
  deficit: boolean;
}

export interface SimulationResult {
  scenarioId: string;
  label: string;
  ticks: number;
  channelRecords: ChannelTickRecord[];
  fieldRecords: FieldTickRecord[];
  wheelRecords: WheelTickRecord[];
  fieldSummaries: FieldDeficitSummary[];
  totals: {
    upstreamInflow: number;
    allocated: number;
    lifted: number;
    spilled: number;
    evaporated: number;
    fieldOverflow: number;
    deficitFieldCount: number;
  };
  /** 规范化输出的 FNV-1a 校验和，用于跨环境比对“同输入同结果” */
  checksum: string;
}
