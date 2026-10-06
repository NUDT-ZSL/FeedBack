import { ConflictPair, RuleSet, isThresholdValid, newPairId, pairKey, pairLabel } from './rules';

export interface Snapshot {
  name: string;
  createdAt: number;
  rules: RuleSet;
}

const STORAGE_KEY = 'element-lab-rule-snapshots-v1';

export class SnapshotStore {
  private listeners: Array<() => void> = [];

  list(): Snapshot[] {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as Snapshot[];
      return parsed.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  private persist(snapshots: Snapshot[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
    this.listeners.forEach(fn => fn());
  }

  save(name: string, rules: RuleSet): void {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('快照名称不能为空');
    const snapshots = this.list();
    const existing = snapshots.find(s => s.name === trimmed);
    if (existing) {
      existing.rules = JSON.parse(JSON.stringify(rules));
      existing.createdAt = Date.now();
    } else {
      snapshots.push({ name: trimmed, createdAt: Date.now(), rules: JSON.parse(JSON.stringify(rules)) });
    }
    this.persist(snapshots);
  }

  load(name: string): RuleSet | null {
    const snap = this.list().find(s => s.name === name);
    return snap ? JSON.parse(JSON.stringify(snap.rules)) : null;
  }

  remove(name: string): void {
    this.persist(this.list().filter(s => s.name !== name));
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }
}

export interface PairModification {
  before: ConflictPair;
  after: ConflictPair;
  changes: Array<'reaction' | 'color'>;
}

export interface RuleSetDiff {
  thresholdChanged: boolean;
  thresholdFrom: number;
  thresholdTo: number;
  thresholdFromValid: boolean;
  thresholdToValid: boolean;
  added: ConflictPair[];
  removed: ConflictPair[];
  modified: PairModification[];
  identical: boolean;
}

export function diffRuleSets(from: RuleSet, to: RuleSet): RuleSetDiff {
  const added: ConflictPair[] = [];
  const removed: ConflictPair[] = [];
  const modified: PairModification[] = [];

  const fromMap = new Map<string, ConflictPair>();
  from.conflictPairs.forEach(pair => fromMap.set(pairKey(pair.a, pair.b), pair));
  const toMap = new Map<string, ConflictPair>();
  to.conflictPairs.forEach(pair => toMap.set(pairKey(pair.a, pair.b), pair));

  for (const [key, toPair] of toMap) {
    const fromPair = fromMap.get(key);
    if (!fromPair) {
      added.push(toPair);
    } else {
      const changes: Array<'reaction' | 'color'> = [];
      if (fromPair.reaction !== toPair.reaction) changes.push('reaction');
      if (fromPair.color.toLowerCase() !== toPair.color.toLowerCase()) changes.push('color');
      if (changes.length > 0) modified.push({ before: fromPair, after: toPair, changes });
    }
  }
  for (const [key, fromPair] of fromMap) {
    if (!toMap.has(key)) removed.push(fromPair);
  }

  const thresholdChanged = from.fusionThreshold !== to.fusionThreshold;
  const identical =
    !thresholdChanged && added.length === 0 && removed.length === 0 && modified.length === 0;

  return {
    thresholdChanged,
    thresholdFrom: from.fusionThreshold,
    thresholdTo: to.fusionThreshold,
    thresholdFromValid: isThresholdValid(from.fusionThreshold),
    thresholdToValid: isThresholdValid(to.fusionThreshold),
    added,
    removed,
    modified,
    identical
  };
}

export { pairLabel, newPairId };
