/**
 * 幽冥魂灯 · 魂力流转引擎
 *
 * 职责：
 *  - 魂力来源按类型与强度持续注入；
 *  - 多来源按优先级分层接纳，同层按注入强度比例分摊；
 *  - 消耗端：拖动 / 切换灯芯 / 触发魂术 / 灯焰维持；
 *  - 灯焰亮度由注入速率与当前储量决定，形态带迟滞切换；
 *  - 来源中断或储量归零进入熄灭过渡，恢复注入后平滑回升；
 *  - 来源增删改只做增量重算，结果与整体重推一致。
 *
 * 确定性：固定步长、无随机数、无墙钟依赖，离线可复现。
 */

import type {
  FlameForm,
  FlameSnapshot,
  SoulSource,
  SourceEntry,
  SourceType,
  Wick,
} from './types.ts';

/** 固定步长（秒），所有推进都按整步进行 */
export const FIXED_DT = 1 / 60;

/** 各来源类型的基础注入速率（单位/秒，强度为 1 时） */
export const BASE_RATE: Record<SourceType, number> = {
  ley: 6,     // 地脉：稳定大流量
  spirit: 3,  // 游魂：中等
  blood: 9,   // 精血：强但代价高
};

export interface EngineTuning {
  capacity: number;
  /** 灯焰维持消耗（单位/秒） */
  upkeepPerSec: number;
  /** 拖动消耗（单位/秒） */
  dragCostPerSec: number;
  /** 切换灯芯一次性消耗 */
  wickSwitchCost: number;
  /** 触发魂术一次性消耗 */
  soulArtCost: number;
  /** 亮度视为“满注入”的参考速率 */
  referenceRate: number;
  /** 亮度上升/下降/熄灭时间常数（秒） */
  tauUp: number;
  tauDown: number;
  tauExtinguish: number;
  /** 低储量警戒迟滞带（进入/退出阈值，按储量比例） */
  lowEnter: number;
  lowExit: number;
}

export const DEFAULT_TUNING: EngineTuning = {
  capacity: 100,
  upkeepPerSec: 1.2,
  dragCostPerSec: 4,
  wickSwitchCost: 8,
  soulArtCost: 20,
  referenceRate: 8,
  tauUp: 0.45,
  tauDown: 0.8,
  tauExtinguish: 2.2,
  lowEnter: 0.15,
  lowExit: 0.25,
};

/** 形态阈值：[进入阈值(上升), 退出阈值(下降)]，按亮度 0..1 */
const FORM_BANDS: Array<{ form: FlameForm; enter: number; exit: number }> = [
  { form: 'surging', enter: 0.92, exit: 0.86 },
  { form: 'bright', enter: 0.68, exit: 0.6 },
  { form: 'steady', enter: 0.42, exit: 0.34 },
  { form: 'weak', enter: 0.16, exit: 0.1 },
  { form: 'embers', enter: 0.03, exit: 0.015 },
];

const EPS = 1e-9;

interface Tier {
  priority: number;
  memberIds: string[];
  /** 该层总供给速率 */
  offer: number;
  /** 该层被接纳的速率 */
  accepted: number;
}

export class SoulFlameEngine {
  private tuning: EngineTuning;
  private sources = new Map<string, SourceEntry>();
  private wicks = new Map<string, Wick>();
  private activeWickId: string | null = null;

  private storage: number;
  private brightness = 0;
  private form: FlameForm = 'out';
  private lowReserve = false;
  private dragging = false;
  private tick = 0;
  private time = 0;

  /** 本步各来源被接纳速率（增量重算的工作集） */
  private acceptedRate = new Map<string, number>();
  /** 分层缓存：按优先级升序排列 */
  private tiers: Tier[] = [];
  /** 增量重算阈值：优先级 <= 该值的层需要重算；null 表示全部缓存有效 */
  private dirtyThreshold: number | null = null;
  /** 上一步的接纳预算，预算变化时全量重算 */
  private lastBudget = -1;

  private lastSnapshot: FlameSnapshot;
  private lastConsumption = 0;

  constructor(tuning: Partial<EngineTuning> = {}, initialStorage?: number) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
    this.storage = clamp(initialStorage ?? this.tuning.capacity * 0.5, 0, this.tuning.capacity);
    this.lastSnapshot = this.makeSnapshot(0, 0);
  }

  // ---------------------------------------------------------------- 来源管理

  addSource(source: SoulSource): void {
    const connected = this.isConnectedByActiveWick(source.id);
    this.sources.set(source.id, { ...source, intensity: Math.max(0, source.intensity), connected });
    this.markDirtyFrom(source.priority);
  }

  removeSource(id: string): void {
    const entry = this.sources.get(id);
    if (!entry) return;
    this.sources.delete(id);
    this.acceptedRate.delete(id);
    this.markDirtyFrom(entry.priority);
  }

  /** 调整强度：只重算该来源所在层及更低优先级层 */
  setIntensity(id: string, intensity: number): void {
    const entry = this.sources.get(id);
    if (!entry) return;
    entry.intensity = Math.max(0, intensity);
    this.markDirtyFrom(entry.priority);
  }

  getSource(id: string): Readonly<SourceEntry> | undefined {
    return this.sources.get(id);
  }

  // ---------------------------------------------------------------- 灯芯

  addWick(wick: Wick): void {
    this.wicks.set(wick.id, wick);
  }

  /** 切换灯芯：来源集合整体替换 + 一次性扣减，属于原子操作 */
  switchWick(wickId: string): boolean {
    const wick = this.wicks.get(wickId);
    if (!wick || wickId === this.activeWickId) return false;
    this.activeWickId = wickId;
    const member = new Set(wick.sourceIds);
    for (const entry of this.sources.values()) {
      entry.connected = member.has(entry.id);
    }
    // 集合整体变化，受影响范围即全部层
    this.markDirtyFrom(Number.POSITIVE_INFINITY);
    // 立即按当前预算重算，保证切换瞬间快照反映新来源集合
    const headroomRate = (this.tuning.capacity - this.storage) / FIXED_DT;
    const budget = Math.max(0, this.lastConsumption + headroomRate);
    this.reallocate(budget);
    this.spend(this.tuning.wickSwitchCost);
    return true;
  }

  get activeWick(): string | null {
    return this.activeWickId;
  }

  // ---------------------------------------------------------------- 消耗端

  setDragging(dragging: boolean): void {
    this.dragging = dragging;
  }

  /** 触发魂术：储量不足时扣到 0 为止，返回是否足额支付 */
  castSoulArt(): boolean {
    return this.spend(this.tuning.soulArtCost);
  }

  // ---------------------------------------------------------------- 推进

  /** 推进一个固定步长，返回最新快照 */
  step(): FlameSnapshot {
    const dt = FIXED_DT;
    const t = this.tuning;

    // 1. 本步消耗需求
    const consumption = t.upkeepPerSec + (this.dragging ? t.dragCostPerSec : 0);

    // 2. 接纳预算：本步消耗 + 剩余储量空间（防止储量溢出）
    const headroomRate = (t.capacity - this.storage) / dt;
    const budget = Math.max(0, consumption + headroomRate);

    // 3. 分配：预算未变时只增量重算受影响层
    const acceptedTotal = this.reallocate(budget).total;

    // 4. 储量结算（钳制到 [0, capacity]，绝不出现负值）
    const net = acceptedTotal - consumption;
    this.storage = clamp(this.storage + net * dt, 0, t.capacity);
    this.lastConsumption = consumption;

    // 5. 低储量警戒（迟滞，防止下限附近抖动）
    const ratio = this.storage / t.capacity;
    if (!this.lowReserve && ratio < t.lowEnter) this.lowReserve = true;
    else if (this.lowReserve && ratio > t.lowExit) this.lowReserve = false;

    // 6. 目标亮度：由注入速率（来源供给）与当前储量共同决定
    const offeredTotal = this.totalOffer();
    const injectionNorm = clamp(offeredTotal / t.referenceRate, 0, 1);
    const hasSupply = offeredTotal > EPS || this.storage > EPS;
    const target = hasSupply
      ? clamp(0.12 + 0.88 * (0.65 * injectionNorm + 0.35 * ratio), 0, 1)
      : 0;

    // 7. 亮度平滑：熄灭用更慢的时间常数，形成过渡而非瞬灭
    const tau = target > this.brightness ? t.tauUp : hasSupply ? t.tauDown : t.tauExtinguish;
    this.brightness += (target - this.brightness) * (1 - Math.exp(-dt / tau));
    if (this.brightness < 1e-4 && target === 0) this.brightness = 0;

    // 8. 形态切换（迟滞）
    this.form = this.resolveForm(this.form, this.brightness);

    this.tick += 1;
    this.time += dt;
    this.lastSnapshot = this.makeSnapshot(offeredTotal, consumption);
    return this.lastSnapshot;
  }

  /** 推进指定秒数（按固定步长取整），离线复现用 */
  advance(seconds: number): FlameSnapshot {
    const steps = Math.round(seconds / FIXED_DT);
    let snap = this.lastSnapshot;
    for (let i = 0; i < steps; i++) snap = this.step();
    return snap;
  }

  getSnapshot(): FlameSnapshot {
    return this.lastSnapshot;
  }

  // ---------------------------------------------------------------- 内部分配

  /**
   * 分层分配：优先级高的层先接纳，同层按供给（=基础速率×强度）比例分摊。
   * 增量路径：只重算 dirtyFrom 起的层；更高优先级层的接纳结果不受影响，
   * 与整体重推结果一致（由验证脚本保证）。
   */
  /**
   * 在指定预算下执行一次分层分配（会更新缓存）。
   * 同一预算重复调用走缓存；来源变动后只重算受影响层。
   */
  reallocate(budget: number): { total: number; accepted: Record<string, number> } {
    if (budget !== this.lastBudget) {
      this.rebuildTiers();
      this.dirtyThreshold = null; // 预算变化：全部重算，随后逐层高到低执行
    } else if (this.dirtyThreshold !== null) {
      this.rebuildTiers();
    } else {
      return this.acceptedRecord();
    }

    const threshold = this.dirtyThreshold;
    let remaining = budget;
    // 高层（优先级大）先吃预算；tiers 按优先级升序，从末尾开始
    for (let i = this.tiers.length - 1; i >= 0; i--) {
      const tier = this.tiers[i];
      const cached = threshold !== null && tier.priority > threshold;
      if (cached) {
        // 未受影响的层：沿用缓存结果，但预算占用必须保持一致
        remaining -= tier.accepted;
        continue;
      }
      tier.accepted = Math.min(tier.offer, Math.max(0, remaining));
      remaining -= tier.accepted;
      const share = tier.offer > EPS ? tier.accepted / tier.offer : 0;
      for (const id of tier.memberIds) {
        const entry = this.sources.get(id)!;
        this.acceptedRate.set(id, this.offerOf(entry) * share);
      }
    }
    // 已被移除的来源不应残留接纳量
    for (const id of [...this.acceptedRate.keys()]) {
      const entry = this.sources.get(id);
      if (!entry || !entry.connected) this.acceptedRate.delete(id);
    }
    this.dirtyThreshold = null;
    return this.acceptedRecord();
  }

  private acceptedRecord(): { total: number; accepted: Record<string, number> } {
    const accepted: Record<string, number> = {};
    let total = 0;
    for (const [id, v] of this.acceptedRate) {
      accepted[id] = v;
      total += v;
    }
    return { total, accepted };
  }

  /** 全量重推（验证增量一致性的基准，也供调试面板使用） */
  reallocateFull(budget: number): Record<string, number> {
    const saved = new Map(this.acceptedRate);
    const savedTiers = this.tiers;
    const savedDirty = this.dirtyThreshold;
    const savedBudget = this.lastBudget;

    this.rebuildTiers();
    this.dirtyThreshold = null;
    this.lastBudget = -1;
    const full = this.reallocate(budget).accepted;

    this.acceptedRate = saved;
    this.tiers = savedTiers;
    this.dirtyThreshold = savedDirty;
    this.lastBudget = savedBudget;
    return full;
  }

  /** 当前各来源被接纳速率（增量路径结果） */
  getAcceptedRates(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, v] of this.acceptedRate) out[id] = v;
    return out;
  }

  private rebuildTiers(): void {
    const byPriority = new Map<number, string[]>();
    for (const entry of this.sources.values()) {
      if (!entry.connected) continue;
      const list = byPriority.get(entry.priority) ?? [];
      list.push(entry.id);
      byPriority.set(entry.priority, list);
    }
    const priorities = [...byPriority.keys()].sort((a, b) => a - b);
    const oldAccepted = new Map(this.tiers.map((t) => [t.priority, t.accepted]));
    this.tiers = priorities.map((priority) => {
      const memberIds = byPriority.get(priority)!;
      const offer = memberIds.reduce((sum, id) => sum + this.offerOf(this.sources.get(id)!), 0);
      return { priority, memberIds, offer, accepted: oldAccepted.get(priority) ?? 0 };
    });
  }

  private markDirtyFrom(priority: number): void {
    // 优先级 <= priority 的层都受影响（本层分摊变化 + 向下层传递的余量变化）；
    // 更高优先级层的接纳结果不变，可继续命中缓存
    this.dirtyThreshold =
      this.dirtyThreshold === null ? priority : Math.max(this.dirtyThreshold, priority);
  }

  private offerOf(entry: SourceEntry): number {
    return entry.connected ? BASE_RATE[entry.type] * entry.intensity : 0;
  }

  private sumAccepted(): number {
    let sum = 0;
    for (const v of this.acceptedRate.values()) sum += v;
    return sum;
  }

  private spend(amount: number): boolean {
    const paid = Math.min(amount, this.storage);
    this.storage = clamp(this.storage - paid, 0, this.tuning.capacity);
    // 一次性扣减立即反映到快照，避免事件与渲染之间出现一拍延迟
    this.lastSnapshot = this.makeSnapshot(this.totalOffer(), this.lastConsumption);
    return paid >= amount - EPS;
  }

  private totalOffer(): number {
    let sum = 0;
    for (const entry of this.sources.values()) sum += this.offerOf(entry);
    return sum;
  }

  private isConnectedByActiveWick(sourceId: string): boolean {
    if (!this.activeWickId) return true; // 未设灯芯时全部接通
    const wick = this.wicks.get(this.activeWickId);
    return !!wick && wick.sourceIds.includes(sourceId);
  }

  private resolveForm(current: FlameForm, b: number): FlameForm {
    // 升序排列的形态及其进入（高）/退出（低）阈值
    const order: FlameForm[] = ['embers', 'weak', 'steady', 'bright', 'surging'];
    const enter = [0.03, 0.16, 0.42, 0.68, 0.92];
    const exit = [0.015, 0.1, 0.34, 0.6, 0.86];
    if (b <= 0) return 'out';
    let idx = current === 'out' ? -1 : order.indexOf(current);
    // 上升：跨过进入阈值才提升
    while (idx < order.length - 1 && b >= enter[idx + 1]) idx += 1;
    // 下降：跌破退出阈值才降低
    while (idx >= 0 && b < exit[idx]) idx -= 1;
    if (idx < 0) return 'embers';
    return order[idx];
  }

  private makeSnapshot(acceptedTotal: number, consumption: number): FlameSnapshot {
    const accepted: Record<string, number> = {};
    for (const [id, v] of this.acceptedRate) accepted[id] = v;
    return {
      tick: this.tick,
      time: this.time,
      storage: this.storage,
      capacity: this.tuning.capacity,
      storageRatio: this.storage / this.tuning.capacity,
      injectionRate: acceptedTotal,
      consumptionRate: consumption,
      accepted,
      brightness: this.brightness,
      form: this.form,
      extinguishing: this.brightness > 0 && acceptedTotal <= EPS && this.storage <= EPS,
      lowReserve: this.lowReserve,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
