/**
 * 灌溉推演的输入/输出模型。
 * 本文件不依赖 React、Three.js 或任何渲染能力，可在 Node 离线复算中直接使用。
 */

/** 水车参数：闸门开度(0-100)、风帆角度(0-90 度)、提水系数 */
export interface WheelParams {
  gateOpening: number;
  sailAngle: number;
  liftCoefficient: number;
}

/** 渠道参数：分流比例为绝对占比（取总来流的比例，不做自动归一化） */
export interface ChannelParams {
  id: string;
  name: string;
  ratio: number;
}

/** 田块参数 */
export interface FieldParams {
  id: string;
  name: string;
  /** 所属渠道 id */
  channelId: string;
  /** 田块容量上限 */
  capacity: number;
  /** 作物需水阈值：蓄水率低于该值即判定缺水，取值 0-1 */
  cropThreshold: number;
  /** 每刻（tick）作物耗水量 */
  consumptionRate: number;
  /** 初始蓄水 */
  initialStorage: number;
}

/** 一次完整推演的全部输入 */
export interface SimulationParams {
  /** 上游来水量（每刻） */
  upstreamInflow: number;
  wheel: WheelParams;
  channels: ChannelParams[];
  fields: FieldParams[];
  /** 推演刻数 */
  ticks: number;
}

/** 田块逐刻留痕，用于缺水依据追溯 */
export interface FieldTracePoint {
  tick: number;
  inflow: number;
  consumption: number;
  storage: number;
  storageRatio: number;
  deficit: boolean;
}

export interface FieldResult {
  fieldId: string;
  name: string;
  channelId: string;
  capacity: number;
  cropThreshold: number;
  finalStorage: number;
  storageRatio: number;
  /** 最终一刻的缺水判定 */
  deficit: boolean;
  /** 推演期内累计缺水刻数 */
  deficitTicks: number;
  /** 人类可读的判定依据，数值口径固定保留 3 位小数 */
  basis: string;
  trace: FieldTracePoint[];
}

export interface ChannelResult {
  channelId: string;
  name: string;
  ratio: number;
  flow: number;
}

export interface SimulationResult {
  wheelSpeed: number;
  liftedFlow: number;
  totalInflow: number;
  channels: ChannelResult[];
  fields: FieldResult[];
  meta: {
    ticks: number;
    /** 本次结果的计算方式，仅用于溯源；不参与结果等价性比较 */
    mode: 'full' | 'incremental';
    /** 增量推演时实际重算的田块 id */
    recomputedFields: string[];
  };
}

/** 推演结果中的可比较内容（剔除溯源元信息） */
export type ComparableResult = Omit<SimulationResult, 'meta'>;
