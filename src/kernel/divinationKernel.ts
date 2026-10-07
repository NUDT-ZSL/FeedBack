import { baguaMatchRules } from '../lib/starData.ts';

/** 光柱持续 2s，与原页面 setTimeout 行为一致 */
export const BEAM_DURATION_MS = 2000;
/** 错误提示持续 0.4s，与原页面错误闪烁动画一致 */
export const ERROR_DURATION_MS = 400;
/** 浑天仪拖拽灵敏度（度/像素），保持原操作手感 */
export const ROTATION_SPEED = 0.5;
/** 光柱落点半径（场景单位） */
export const BEAM_RADIUS = 1.5;
/** 光柱基座高度（场景单位） */
export const BEAM_BASE_Y = -3;
/** 八卦共 8 个卦位，每卦位 45° */
export const SECTOR_COUNT = 8;
export const SECTOR_DEGREES = 360 / SECTOR_COUNT;

/** 光柱状态：自身携带 id 与到期时间，不依赖外部 setTimeout 闭包 */
export interface LightBeamState {
  position: [number, number, number];
  visible: boolean;
  beamId: number;
  startedAt: number;
  expiresAt: number;
}

/** 内核完整可观察状态：旋转 / 拖拽 / 悬停 / 光柱 / 错误各自独立字段 */
export interface KernelState {
  rotation: [number, number];
  isRotating: boolean;
  draggedTalisman: string | null;
  dragSessionId: number;
  isDragOverBagua: boolean;
  lightBeam: LightBeamState | null;
  baguaError: boolean;
  errorExpiresAt: number | null;
}

/** 一次被内核接受的落点推演结果 */
export interface DivinationResult {
  at: number;
  talisman: string;
  /** 依据落点方向判定出的卦位（0-7） */
  position: number;
  /** 该符咒期望命中的卦位 */
  expectedPosition: number;
  matched: boolean;
  beam: LightBeamState | null;
}

/** 输入事件：页面只负责把 DOM 输入翻译为这些事件；时间由调用方注入 */
export type KernelEvent =
  | { type: 'sphereDragStart'; at: number }
  | { type: 'sphereRotate'; at: number; deltaX: number; deltaY: number }
  | { type: 'sphereDragEnd'; at: number }
  | { type: 'talismanDragStart'; at: number; talisman: string }
  | { type: 'talismanDragEnd'; at: number }
  | { type: 'baguaDragOver'; at: number }
  | { type: 'baguaDragLeave'; at: number }
  | {
      type: 'baguaDrop';
      at: number;
      /** 符咒名（由页面从 dataTransfer / 当前拖拽态取得） */
      talisman: string;
      /** 落点相对八卦阵图中心的方向（x 向右，y 向上；任意非零长度均可） */
      direction: [number, number];
    }
  | { type: 'advanceTo'; at: number };

export interface DispatchOutcome {
  state: KernelState;
  /** 本次事件产出的推演结果；重复投递 / 陈旧投递 / 非落点事件均为 null */
  result: DivinationResult | null;
  /** 事件是否被忽略（未引发任何状态变化） */
  ignored: boolean;
}

/** 将任意角度规整到 [0, 360) */
export function normalizeDegrees(value: number): number {
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * 落点判定（纯函数，与屏幕布局完全解耦）：
 * 只看落点相对阵图中心的方向，不看距离、像素、尺寸、缩放与滚动位置。
 * 同一方向无论向量长度、坐标精度如何，卦位恒定。
 * 0 号位对应正上方（屏幕 y 轴正方向），顺时针每 45° 一个卦位。
 */
export function resolveTrigramPosition(direction: readonly [number, number]): number {
  const angleDeg = (Math.atan2(direction[1], direction[0]) * 180) / Math.PI;
  return (
    Math.round(((angleDeg + 360 + 90) % 360) / SECTOR_DEGREES) % SECTOR_COUNT
  );
}

/** 由卦位计算光柱的 3D 落点，保持与原 App 中完全一致的几何 */
export function computeBeamPosition(position: number): [number, number, number] {
  const angleRad = ((position * SECTOR_DEGREES - 90) * Math.PI) / 180;
  return [
    Math.cos(angleRad) * BEAM_RADIUS,
    BEAM_BASE_Y,
    Math.sin(angleRad) * BEAM_RADIUS,
  ];
}

export function createInitialState(): KernelState {
  return {
    rotation: [0, 0],
    isRotating: false,
    draggedTalisman: null,
    dragSessionId: 0,
    isDragOverBagua: false,
    lightBeam: null,
    baguaError: false,
    errorExpiresAt: null,
  };
}

/**
 * 推演内核：纯状态机，不依赖 React、DOM 或真实时钟。
 * 所有到期清理（光柱消失 / 错误复位）都以注入的时间戳驱动，
 * 连续投递与快速叠加时不会被陈旧定时器覆盖。
 */
export class DivinationKernel {
  private state: KernelState;
  private beamSeq = 0;

  constructor(initialState?: KernelState) {
    this.state = initialState ? cloneState(initialState) : createInitialState();
  }

  getState(): KernelState {
    return this.state;
  }

  /** 下一次需要外部唤醒做到期清理的时间戳；无待清理效果时为 null */
  nextExpiryAt(): number | null {
    const candidates: number[] = [];
    if (this.state.lightBeam) candidates.push(this.state.lightBeam.expiresAt);
    if (this.state.baguaError && this.state.errorExpiresAt !== null) {
      candidates.push(this.state.errorExpiresAt);
    }
    return candidates.length ? Math.min(...candidates) : null;
  }

  dispatch(event: KernelEvent): DispatchOutcome {
    const before = this.state;
    const after = this.applyExpiry(before, event.at);
    this.state = after;

    switch (event.type) {
      case 'advanceTo':
        return after === before ? this.ignored() : this.commit(after);

      case 'sphereDragStart':
        if (this.state.isRotating) return this.ignored();
        return this.commit({ ...this.state, isRotating: true });

      case 'sphereRotate': {
        if (!this.state.isRotating) return this.ignored();
        const [rotX, rotY] = this.state.rotation;
        return this.commit({
          ...this.state,
          rotation: [
            normalizeDegrees(rotX + event.deltaY * ROTATION_SPEED),
            normalizeDegrees(rotY + event.deltaX * ROTATION_SPEED),
          ],
        });
      }

      case 'sphereDragEnd':
        if (!this.state.isRotating) return this.ignored();
        return this.commit({ ...this.state, isRotating: false });

      case 'talismanDragStart':
        // 拖拽中途切换符咒：开启新会话并替换当前符咒
        if (this.state.draggedTalisman === event.talisman) return this.ignored();
        return this.commit({
          ...this.state,
          draggedTalisman: event.talisman,
          dragSessionId: this.state.dragSessionId + 1,
          isDragOverBagua: false,
        });

      case 'talismanDragEnd':
        if (this.state.draggedTalisman === null && !this.state.isDragOverBagua) {
          return this.ignored();
        }
        return this.commit({
          ...this.state,
          draggedTalisman: null,
          isDragOverBagua: false,
        });

      case 'baguaDragOver':
        if (this.state.isDragOverBagua) return this.ignored();
        return this.commit({ ...this.state, isDragOverBagua: true });

      case 'baguaDragLeave':
        if (!this.state.isDragOverBagua) return this.ignored();
        return this.commit({ ...this.state, isDragOverBagua: false });

      case 'baguaDrop': {
        // 任何落点事件都先结束悬停态
        let next: KernelState = { ...this.state, isDragOverBagua: false };

        // 无活动拖拽，或投递的符咒与当前活动符咒不一致
        // （重复投递 / 中途切换符咒后的陈旧投递）→ 一律忽略
        if (
          next.draggedTalisman === null ||
          event.talisman !== next.draggedTalisman
        ) {
          if (this.state.isDragOverBagua) {
            this.state = next;
            return { state: next, result: null, ignored: true };
          }
          return this.ignored();
        }

        const position = resolveTrigramPosition(event.direction);
        const expectedPosition =
          Object.prototype.hasOwnProperty.call(baguaMatchRules, event.talisman)
            ? baguaMatchRules[event.talisman]
            : -1;
        const matched = position === expectedPosition;

        const result: DivinationResult = {
          at: event.at,
          talisman: event.talisman,
          position,
          expectedPosition,
          matched,
          beam: null,
        };

        // 命中与未命中只改各自字段，互不牵连
        if (matched) {
          const beam: LightBeamState = {
            position: computeBeamPosition(position),
            visible: true,
            beamId: ++this.beamSeq,
            startedAt: event.at,
            expiresAt: event.at + BEAM_DURATION_MS,
          };
          next = { ...next, lightBeam: beam };
          result.beam = beam;
        } else {
          next = {
            ...next,
            baguaError: true,
            errorExpiresAt: event.at + ERROR_DURATION_MS,
          };
        }

        // 符咒只消费一次，拖拽会话立即结束
        next = { ...next, draggedTalisman: null };
        this.state = next;
        return { state: next, result, ignored: false };
      }
    }
  }

  /** 依据时间戳清理已到期的光柱 / 错误（不使用任何外部定时器） */
  private applyExpiry(state: KernelState, at: number): KernelState {
    let next = state;
    if (next.lightBeam && at >= next.lightBeam.expiresAt) {
      next = { ...next, lightBeam: null };
    }
    if (
      next.baguaError &&
      next.errorExpiresAt !== null &&
      at >= next.errorExpiresAt
    ) {
      next = { ...next, baguaError: false, errorExpiresAt: null };
    }
    return next;
  }

  private commit(next: KernelState): DispatchOutcome {
    this.state = next;
    return { state: next, result: null, ignored: false };
  }

  private ignored(): DispatchOutcome {
    return { state: this.state, result: null, ignored: true };
  }
}

function cloneState(state: KernelState): KernelState {
  return {
    ...state,
    rotation: [state.rotation[0], state.rotation[1]],
    lightBeam: state.lightBeam ? { ...state.lightBeam, position: [...state.lightBeam.position] as [number, number, number] } : null,
  };
}
