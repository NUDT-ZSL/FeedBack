import type { CanvasElement } from '../types';
import type { Clock, Op } from './protocol';
import { compareClock, clockOf } from './protocol';

interface ElementMeta {
  /** Per-attribute last-writer clock. */
  attrs: Record<string, Clock>;
  /** Max clock of any delete seen for this element. */
  deleteClock: Clock | null;
  /** Max clock of any add/update seen for this element. */
  writeClock: Clock | null;
}

const SEEN_OPS_CAP = 10000;

/**
 * Replicated board state with deterministic, order-independent merging.
 *
 * Convergence rules (identical on server and every client):
 * - Same element, same attribute: the write with the higher
 *   (lamport, userId) clock wins; op clocks are unique per site, so the
 *   outcome never depends on message arrival order.
 * - Delete vs write: an element is visible iff its highest write clock
 *   beats its highest delete clock. Visibility is a pure function of the
 *   op set, so deletes and updates commute; a later write revives the
 *   element on top of its retained (tombstone) data.
 * - Ops are idempotent (dedup by opId), so replicas that have seen the
 *   same set of ops hold the same state regardless of order.
 */
export class BoardState {
  /** Best-known data per element, whether currently visible or deleted. */
  private data = new Map<string, CanvasElement>();
  private meta = new Map<string, ElementMeta>();
  private seenOps = new Set<string>();
  private seenQueue: string[] = [];
  /** Updates that arrived before the element's `add` (reordered delivery). */
  private buffered = new Map<string, Op[]>();

  hasSeen(opId: string): boolean {
    return this.seenOps.has(opId);
  }

  /** Apply an op. Returns true if the visible state may have changed. */
  applyOp(op: Op): boolean {
    if (this.seenOps.has(op.opId)) return false;
    this.seenOps.add(op.opId);
    this.seenQueue.push(op.opId);
    if (this.seenQueue.length > SEEN_OPS_CAP) {
      const evicted = this.seenQueue.shift();
      if (evicted !== undefined) this.seenOps.delete(evicted);
    }
    switch (op.kind) {
      case 'add':
        return this.applyAdd(op);
      case 'update':
        return this.applyUpdate(op);
      case 'delete':
        return this.applyDelete(op);
    }
  }

  private getMeta(id: string): ElementMeta {
    let m = this.meta.get(id);
    if (!m) {
      m = { attrs: {}, deleteClock: null, writeClock: null };
      this.meta.set(id, m);
    }
    return m;
  }

  private bumpWrite(m: ElementMeta, c: Clock): void {
    if (!m.writeClock || compareClock(m.writeClock, c) < 0) m.writeClock = c;
  }

  private mergeFields(target: CanvasElement, fields: Record<string, unknown>, m: ElementMeta, c: Clock): boolean {
    let changed = false;
    for (const [key, value] of Object.entries(fields)) {
      const cur = m.attrs[key];
      if (!cur || compareClock(cur, c) < 0) {
        (target as unknown as Record<string, unknown>)[key] = value;
        m.attrs[key] = c;
        changed = true;
      }
    }
    return changed;
  }
  private applyAdd(op: Extract<Op, { kind: 'add' }>): boolean {
    const c = clockOf(op);
    const id = op.element.id;
    const m = this.getMeta(id);
    this.bumpWrite(m, c);

    let changed = false;
    const existing = this.data.get(id);
    if (existing) {
      changed = this.mergeFields(existing, op.element as unknown as Record<string, unknown>, m, c);
    } else {
      const created: CanvasElement = { ...op.element };
      this.data.set(id, created);
      for (const key of Object.keys(op.element)) {
        const cur = m.attrs[key];
        if (!cur || compareClock(cur, c) < 0) m.attrs[key] = c;
      }
      changed = true;
    }
    // Replay updates that arrived before this add. They are already in
    // seenOps, so bypass applyOp's dedup and merge them directly.
    const buf = this.buffered.get(id);
    if (buf) {
      this.buffered.delete(id);
      for (const b of buf) {
        if (b.kind === 'update') this.applyUpdate(b);
      }
    }
    return changed;
  }

  private applyUpdate(op: Extract<Op, { kind: 'update' }>): boolean {
    const c = clockOf(op);
    const id = op.elementId;
    const m = this.getMeta(id);
    const target = this.data.get(id);
    if (!target) {
      // Element data not seen yet (op reordering): buffer the update and
      // replay it when the add arrives. Never drop it — its clocks still
      // participate in attribute and visibility resolution.
      const buf = this.buffered.get(id) ?? [];
      buf.push(op);
      this.buffered.set(id, buf);
      this.bumpWrite(m, c);
      return false;
    }
    this.bumpWrite(m, c);
    return this.mergeFields(target, op.updates as Record<string, unknown>, m, c);
  }

  private applyDelete(op: Extract<Op, { kind: 'delete' }>): boolean {
    const c = clockOf(op);
    const m = this.getMeta(op.elementId);
    if (m.deleteClock && compareClock(m.deleteClock, c) >= 0) return false;
    m.deleteClock = c;
    return true;
  }

  private isVisible(id: string): boolean {
    const m = this.meta.get(id);
    if (!m || !m.writeClock) return false;
    return !m.deleteClock || compareClock(m.writeClock, m.deleteClock) > 0;
  }

  /** Visible elements, sorted by id for a canonical, comparable view. */
  getElements(): CanvasElement[] {
    return Array.from(this.data.values())
      .filter((el) => this.isVisible(el.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** Replace local state with a server snapshot (full resync path). */
  loadSnapshot(elements: CanvasElement[]): void {
    this.reset();
    const zero: Clock = { lamport: 0, site: '' };
    for (const el of elements) {
      this.data.set(el.id, { ...el });
      const m = this.getMeta(el.id);
      m.writeClock = zero;
      for (const key of Object.keys(el)) m.attrs[key] = zero;
    }
  }

  reset(): void {
    this.data.clear();
    this.meta.clear();
    this.buffered.clear();
    this.seenOps.clear();
    this.seenQueue = [];
  }
}
