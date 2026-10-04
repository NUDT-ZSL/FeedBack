/**
 * 皮影角色合成（纯数值模块）。
 *
 * 对应架构文档 5.1 数据模型：ShadowFigure 由 6 个 ShadowPart
 * （头、身、左臂、右臂、左腿、右腿）通过 Joint 铆钉绑定而成。
 *
 * 装配阶段做结构校验（唯一 ID、恰好 6 件、必需绑定、长度为正、限位合法）；
 * 合成阶段按固定拓扑做正运动学，输出每个部件的世界坐标与旋转，
 * 输出与关节输入一一对应——验证器据此核对「合成结果 ←→ 各关节角度」。
 */

export type PartType = 'head' | 'body' | 'armLeft' | 'armRight' | 'legLeft' | 'legRight';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PuppetPart {
  id: string;
  type: PartType;
  /** 部件沿 +x 方向的几何长度（头部件视为零长度装饰件） */
  length: number;
  /** 装配点（铆钉孔）在部件局部坐标中的位置 */
  anchor: Vec2;
}

export interface JointBinding {
  id: string;
  /** 子部件 id（肢体部件） */
  childPartId: string;
  /** 父部件 id；躯干为根，其父为 null */
  parentPartId: string | null;
  /** 铆钉在父部件局部坐标中的位置 */
  pivot: Vec2;
  minDeg: number;
  maxDeg: number;
}

export interface FigurePose {
  /** key = 绑定关节 id，value = 相对父部件的角度（度，0° 沿父部件 +x） */
  jointAngles: Record<string, number>;
}

export interface ComposedPart {
  partId: string;
  type: PartType;
  /** 部件锚点的世界坐标 */
  position: Vec2;
  /** 部件世界旋转角（度）= 全部祖先关节角之和 */
  rotationDeg: number;
  /** 部件远端（anchor + length 方向）的世界坐标，供渲染/投影核对 */
  tip: Vec2;
}

export interface ComposedFigure {
  figureId: string;
  parts: ComposedPart[];
}

const REQUIRED_TYPES: readonly PartType[] = [
  'head',
  'body',
  'armLeft',
  'armRight',
  'legLeft',
  'legRight',
];

const LIMB_PARENTS: Readonly<Record<Exclude<PartType, 'head' | 'body'>, PartType>> = {
  armLeft: 'body',
  armRight: 'body',
  legLeft: 'body',
  legRight: 'body',
};

function fail(message: string): never {
  throw new Error(`[角色合成] ${message}`);
}

function assertFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${name} 必须为有限数值，实际收到 ${String(value)}`);
  }
}

export interface FigureDefinition {
  id: string;
  parts: PuppetPart[];
  bindings: JointBinding[];
  /** 躯干（根部件）在戏台坐标系中的放置位置与角度 */
  rootPlacement: { position: Vec2; rotationDeg: number };
}

/** 装配：校验结构合法性，返回规范化的拓扑索引（非法即抛错，不做静默修复）。 */
export function assembleFigure(def: FigureDefinition): {
  bodyId: string;
  byType: Record<PartType, string>;
  bindingByChild: Map<string, JointBinding>;
} {
  if (!def || typeof def.id !== 'string' || def.id.length === 0) {
    fail('缺少有效的 figure id');
  }
  if (def.parts.length !== 6 || new Set(def.parts.map((p) => p.type)).size !== 6) {
    fail(`影人必须恰好包含 6 种部件各一件（头/身/双臂/双腿），实际 ${def.parts.length} 件`);
  }
  for (const type of REQUIRED_TYPES) {
    if (!def.parts.some((p) => p.type === type)) {
      fail(`缺少必需部件：${type}`);
    }
  }
  const partIds = new Set<string>();
  for (const part of def.parts) {
    if (partIds.has(part.id)) fail(`部件 id 重复：${part.id}`);
    partIds.add(part.id);
    if (!(part.length >= 0)) fail(`部件 ${part.id} 长度必须为非负数`);
    assertFinite(part.anchor.x, `部件 ${part.id} anchor.x`);
    assertFinite(part.anchor.y, `部件 ${part.id} anchor.y`);
  }

  const byType = {} as Record<PartType, string>;
  for (const part of def.parts) byType[part.type] = part.id;

  const bindingIds = new Set<string>();
  const bindingByChild = new Map<string, JointBinding>();
  for (const binding of def.bindings) {
    if (bindingIds.has(binding.id)) fail(`关节 id 重复：${binding.id}`);
    bindingIds.add(binding.id);
    if (!partIds.has(binding.childPartId)) fail(`关节 ${binding.id} 的子部件不存在：${binding.childPartId}`);
    if (bindingByChild.has(binding.childPartId)) {
      fail(`部件 ${binding.childPartId} 存在多个绑定关节`);
    }
    if (binding.parentPartId !== null && !partIds.has(binding.parentPartId)) {
      fail(`关节 ${binding.id} 的父部件不存在：${binding.parentPartId}`);
    }
    if (binding.minDeg > binding.maxDeg) fail(`关节 ${binding.id} 限位非法：min > max`);
    assertFinite(binding.pivot.x, `关节 ${binding.id} pivot.x`);
    assertFinite(binding.pivot.y, `关节 ${binding.id} pivot.y`);
    bindingByChild.set(binding.childPartId, binding);
  }

  const bodyId = byType.body;
  const bodyBinding = bindingByChild.get(bodyId);
  if (bodyBinding && bodyBinding.parentPartId !== null) {
    fail('躯干必须为根部件，不能再挂载到其他部件');
  }
  for (const limbType of Object.keys(LIMB_PARENTS) as Array<Exclude<PartType, 'head' | 'body'>>) {
    const limbId = byType[limbType];
    const binding = bindingByChild.get(limbId);
    if (!binding) fail(`部件 ${limbType} 缺少绑定关节`);
    if (binding.parentPartId !== bodyId) {
      fail(`${limbType} 必须绑定在躯干上，实际挂在 ${binding.parentPartId}`);
    }
  }
  const headBinding = bindingByChild.get(byType.head);
  if (!headBinding || headBinding.parentPartId !== bodyId) {
    fail('头部必须绑定在躯干上');
  }

  assertFinite(def.rootPlacement.position.x, 'rootPlacement.x');
  assertFinite(def.rootPlacement.position.y, 'rootPlacement.y');
  assertFinite(def.rootPlacement.rotationDeg, 'rootPlacement.rotationDeg');

  return { bodyId, byType, bindingByChild };
}

/**
 * 合成：根据定义与关节角输入计算各部件世界姿态。
 * 缺关节角按 0° 处理并在 missingJoints 中列出（不抛错，便于上层提示），
 * 超出限位的输入按边界截断并在 clampedJoints 中列出；非有限角度抛错。
 */
export function composeFigure(
  def: FigureDefinition,
  pose: FigurePose,
): ComposedFigure & { missingJoints: string[]; clampedJoints: string[] } {
  const { byType, bindingByChild } = assembleFigure(def);
  const missingJoints: string[] = [];
  const clampedJoints: string[] = [];

  for (const [jointId, value] of Object.entries(pose.jointAngles)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`关节 ${jointId} 角度必须为有限数值，实际收到 ${String(value)}`);
    }
  }

  const partById = new Map(def.parts.map((p) => [p.id, p]));
  const results = new Map<string, ComposedPart>();

  const rootRot = def.rootPlacement.rotationDeg;
  results.set(byType.body, {
    partId: byType.body,
    type: 'body',
    position: { ...def.rootPlacement.position },
    rotationDeg: rootRot,
    tip: tipOf(def.rootPlacement.position, rootRot, partById.get(byType.body)!.length),
  });

  for (const type of REQUIRED_TYPES) {
    if (type === 'body') continue;
    const partId = byType[type];
    const binding = bindingByChild.get(partId)!;
    let raw = pose.jointAngles[binding.id];
    if (raw === undefined) {
      missingJoints.push(binding.id);
      raw = 0;
    }
    if (raw < binding.minDeg || raw > binding.maxDeg) {
      clampedJoints.push(binding.id);
    }
    const angle = Math.max(binding.minDeg, Math.min(binding.maxDeg, raw));
    const parent = results.get(binding.parentPartId!)!;
    const parentPart = partById.get(binding.parentPartId!)!;
    const worldPivot = rotateOffset(binding.pivot, parent.rotationDeg, parent.position, parentPart.anchor);
    const rotationDeg = parent.rotationDeg + angle;
    const position = worldPivot;
    results.set(partId, {
      partId,
      type,
      position,
      rotationDeg,
      tip: tipOf(position, rotationDeg, partById.get(partId)!.length),
    });
  }

  return {
    figureId: def.id,
    parts: REQUIRED_TYPES.map((type) => results.get(byType[type])!),
    missingJoints,
    clampedJoints,
  };
}

/** 将父部件局部坐标的铆钉位置换算为世界坐标（补偿父部件自身 anchor 偏移）。 */
function rotateOffset(pivotLocal: Vec2, parentRotationDeg: number, parentPos: Vec2, parentAnchor: Vec2): Vec2 {
  const rad = (parentRotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localX = pivotLocal.x - parentAnchor.x;
  const localY = pivotLocal.y - parentAnchor.y;
  return {
    x: parentPos.x + localX * cos - localY * sin,
    y: parentPos.y + localX * sin + localY * cos,
  };
}

function tipOf(position: Vec2, rotationDeg: number, length: number): Vec2 {
  const rad = (rotationDeg * Math.PI) / 180;
  return {
    x: position.x + length * Math.cos(rad),
    y: position.y + length * Math.sin(rad),
  };
}
