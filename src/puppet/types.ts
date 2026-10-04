/**
 * 皮影影人领域模型（纯数据，不依赖浏览器 API）。
 * 与 .trae/documents/技术架构-皮影戏互动游戏.md 第 5.1 节数据结构对齐。
 */

export type PartType =
  | 'head'
  | 'body'
  | 'armLeft'
  | 'armRight'
  | 'legLeft'
  | 'legRight';

export interface Vec2 {
  x: number;
  y: number;
}

/** 关节定义：连接两个部件的铰链点，并给出合法角度范围（单位：度）。 */
export interface Joint {
  id: string;
  partId: string;
  parentPartId?: string;
  /** 关节点在所属部件局部坐标系中的位置。 */
  position: Vec2;
  /** 关节点在父部件局部坐标系中的位置（根部件无此值）。 */
  parentPosition?: Vec2;
  /** 关节角度下限（度）。 */
  minAngle: number;
  /** 关节角度上限（度）。 */
  maxAngle: number;
  /** 阻尼系数，PRD/技术架构固定为 0.3。 */
  damping: number;
}

export interface ShadowPart {
  id: string;
  type: PartType;
  color: string;
  leatherType: 'cow' | 'donkey' | 'sheep';
  jointIds: string[];
}

/** 皮影角色骨架：由部件与连接它们的关节（骨架树）组成。 */
export interface FigureRig {
  id: string;
  name: string;
  /** 根部件 id，约定为躯干 body。 */
  rootPartId: string;
  parts: ShadowPart[];
  joints: Joint[];
}

/** 单个关节的运行时状态（角度：度；角速度：度/秒）。 */
export interface JointState {
  angle: number;
  angularVelocity: number;
}

/** 一次完整的关节姿态输入。 */
export type JointStateMap = Record<string, JointState>;

/** 部件在世界坐标系中的合成姿态。 */
export interface PartPose {
  partId: string;
  position: Vec2;
  rotation: number;
}

export interface FigurePose {
  rigId: string;
  parts: PartPose[];
}
