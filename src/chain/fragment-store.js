/**
 * 片段存储：接收带来源(source)与顺序(seq)的文本片段。
 * - 乱序到达：最终顺序只由 (source, seq) 决定，与到达先后无关。
 * - 重复提交：同 (source, seq, revision) 且内容相同 -> 幂等忽略（可观察事件）。
 * - 同版本不同内容：拒绝并记录 conflicting-duplicate-rejected，不静默择一。
 * - 中途修正：更高 revision 覆盖旧文本，触发受影响位置重推。
 * - 过期版本：更低 revision 拒绝并记录 stale-rejected。
 */
export class FragmentStore {
  constructor() {
    this.fragments = new Map(); // key `${source}#${seq}` -> {source, seq, revision, text}
    this.events = [];
  }

  static keyOf(source, seq) {
    return `${source}#${seq}`;
  }

  submit({ source, seq, revision = 0, text }) {
    const key = FragmentStore.keyOf(source, seq);
    const prev = this.fragments.get(key);

    if (!prev) {
      this.fragments.set(key, { source, seq, revision, text });
      this.events.push({ type: 'accepted', key, revision });
      return { accepted: true, kind: 'new', changed: true };
    }
    if (revision < prev.revision) {
      this.events.push({ type: 'stale-rejected', key, revision, current: prev.revision });
      return { accepted: false, kind: 'stale', changed: false };
    }
    if (revision === prev.revision) {
      if (text === prev.text) {
        this.events.push({ type: 'duplicate-ignored', key, revision });
        return { accepted: false, kind: 'duplicate', changed: false };
      }
      this.events.push({ type: 'conflicting-duplicate-rejected', key, revision });
      return { accepted: false, kind: 'conflicting-duplicate', changed: false };
    }
    this.fragments.set(key, { source, seq, revision, text });
    this.events.push({ type: 'corrected', key, from: prev.revision, to: revision });
    return { accepted: true, kind: 'corrected', changed: prev.text !== text };
  }

  ordered() {
    return [...this.fragments.values()].sort((a, b) =>
      a.source < b.source ? -1 : a.source > b.source ? 1 : a.seq - b.seq
    );
  }

  /** 展开为位置序列；位置 id 与到达顺序无关，修正后保持稳定。 */
  positions() {
    const out = [];
    for (const f of this.ordered()) {
      for (let i = 0; i < f.text.length; i++) {
        out.push({
          id: `${f.source}#${f.seq}@${i}`,
          source: f.source,
          seq: f.seq,
          offset: i,
          char: f.text[i],
          index: out.length,
        });
      }
    }
    return out;
  }
}
