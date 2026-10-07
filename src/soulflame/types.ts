/**
 * 幽冥魂灯 · 魂力流转模型类型定义
 *
 * 该模块只包含纯数据与纯函数约定，不依赖 DOM / Three.js，
 * 固定步长推进、无随机数，保证离线可复现。
 */

/** 魂力来源类型：不同类型有不同的单位注入强度 */
export type SourceType = 'ley' | 'spirit' | 'blood';

/** 魂力来源 */
export interface SoulSource {
  id: string;
  /** 来源类型，决定基础注入速率 */
  type: SourceType;
  /** 优先级，数值越大越优先承担消耗 */
  priority: number;
  /** 当前强度（>=0），0 表示仍在集合中但不注入 */
  intensity: number;
}

/** 灯焰形态（离散状态，切换带迟滞，防止边界抖动跳变） */
export type FlameForm =
  | 'out'        // 熄灭
  | 'embers'     // 余烬
  | 'weak'       // 微弱
  | 'steady'     // 稳定
  | 'bright'     // 明亮
  | 'surging';   // 奔涌

/** 灯芯：每种灯芯接通的来源集合不同，切换瞬间整体替换 */
export interface Wick {
  id: string;
  name: string;
  sourceIds: string[];
}

/** 引擎每一步的只读快照，渲染层只消费这个结构 */
export interface FlameSnapshot {
  tick: number;
  time: number;
  /** 魂力储量 [0, capacity] */
  storage: number;
  capacity: number;
  storageRatio: number;
  /** 本步实际注入速率（单位/秒） */
  injectionRate: number;
  /** 本步实际消耗速率（单位/秒，含拖动/维持/魂术摊销） */
  consumptionRate: number;
  /** 各来源本步被接纳的注入量（按优先级+比例分配后的结果） */
  accepted: Record<string, number>;
  /** 灯焰连续亮度 0..1 */
  brightness: number;
  /** 灯焰形态 */
  form: FlameForm;
  /** 是否处于熄灭过渡（亮度仍在衰减，但已无有效供给） */
  extinguishing: boolean;
  /** 是否处于低储量警戒（带迟滞） */
  lowReserve: boolean;
}

/** 来源注册项（引擎内部） */
export interface SourceEntry extends SoulSource {
  /** 是否被当前灯芯接通 */
  connected: boolean;
}
