export interface HistoryEntry {
  seq: number;
  kind: 'pattern.submit' | 'order.transition';
  label: string;
  undo(): void;
}

export class UndoHistory {
  private entries: HistoryEntry[] = [];
  private audit: string[] = [];
  private seq = 0;

  push(entry: Omit<HistoryEntry, 'seq'>): HistoryEntry {
    const full: HistoryEntry = { ...entry, seq: ++this.seq };
    this.entries.push(full);
    return full;
  }

  undoLast(): HistoryEntry | null {
    const entry = this.entries.pop();
    if (!entry) return null;
    entry.undo();
    this.audit.push(`undo#${entry.seq}:${entry.kind}:${entry.label}`);
    return entry;
  }

  get size(): number {
    return this.entries.length;
  }

  get auditLog(): readonly string[] {
    return this.audit;
  }
}
