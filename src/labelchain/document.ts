import type { Fragment, IngestLogEntry, Position } from './types.ts';

export const fragmentKey = (source: string, seq: number): string =>
  `${source}#${seq}`;

/**
 * 输入侧：接收带来源与顺序的文本片段。
 * - 乱序到达：按 (source, seq) 确定性排序，与到达顺序无关；
 * - 重复提交：同 key 同 revision 幂等忽略并记录；
 *   同 key 同 revision 但文本不同 -> revisionClash（保留先到者，矛盾可观察）；
 * - 中途修正：同 key 更高 revision 覆盖旧文本（corrected）；
 *   更低 revision -> stale，忽略并记录。
 */
export class DocumentStore {
  private fragments = new Map<string, Fragment>();
  readonly ingestLog: IngestLogEntry[] = [];
  private positions: Position[] = [];

  get text(): string {
    return this.positions.map((p) => p.char).join('');
  }

  get length(): number {
    return this.positions.length;
  }

  getPositions(): readonly Position[] {
    return this.positions;
  }

  at(index: number): Position | undefined {
    return this.positions[index];
  }

  /** 提交片段，返回是否引起文档变化以及变化的位置范围 */
  submit(frag: Fragment): {
    changed: boolean;
    oldLength: number;
    firstDiff: number;
    lastDiff: number;
  } {
    const key = fragmentKey(frag.source, frag.seq);
    const oldLength = this.positions.length;
    const prev = this.fragments.get(key);

    if (prev) {
      if (prev.revision === frag.revision) {
        if (prev.text === frag.text) {
          this.ingestLog.push({
            kind: 'duplicate',
            fragmentKey: key,
            revision: frag.revision,
            note: `重复提交，已幂等忽略（${frag.text.length} 字）`,
          });
        } else {
          this.ingestLog.push({
            kind: 'revisionClash',
            fragmentKey: key,
            revision: frag.revision,
            note: `同一修订号 ${frag.revision} 内容不一致，保留先到文本`,
          });
        }
        return { changed: false, oldLength, firstDiff: -1, lastDiff: -1 };
      }
      if (prev.revision > frag.revision) {
        this.ingestLog.push({
          kind: 'stale',
          fragmentKey: key,
          revision: frag.revision,
          note: `过期修订号 ${frag.revision}（当前 ${prev.revision}），已忽略`,
        });
        return { changed: false, oldLength, firstDiff: -1, lastDiff: -1 };
      }
      this.fragments.set(key, frag);
      this.ingestLog.push({
        kind: 'corrected',
        fragmentKey: key,
        revision: frag.revision,
        note: `片段已由修订 ${prev.revision} 修正为 ${frag.revision}`,
      });
    } else {
      this.fragments.set(key, frag);
      this.ingestLog.push({
        kind: 'accepted',
        fragmentKey: key,
        revision: frag.revision,
        note: `新片段已接收（${frag.text.length} 字）`,
      });
    }

    const old = this.positions;
    this.positions = this.rebuild();
    const diff = diffPositions(old, this.positions);
    return {
      changed: diff.firstDiff >= 0,
      oldLength,
      firstDiff: diff.firstDiff,
      lastDiff: diff.lastDiff,
    };
  }

  /** 确定性重建：按来源、顺序号排序后逐字展开为位置 */
  private rebuild(): Position[] {
    const ordered = [...this.fragments.values()].sort((a, b) =>
      a.source < b.source
        ? -1
        : a.source > b.source
          ? 1
          : a.seq - b.seq,
    );
    const out: Position[] = [];
    for (const frag of ordered) {
      const key = fragmentKey(frag.source, frag.seq);
      for (let offset = 0; offset < frag.text.length; offset++) {
        out.push({
          index: out.length,
          char: frag.text[offset],
          fragmentKey: key,
          revision: frag.revision,
        });
      }
    }
    return out;
  }
}

function diffPositions(old: Position[], next: Position[]): {
  firstDiff: number;
  lastDiff: number;
} {
  let firstDiff = -1;
  for (let i = 0; i < Math.min(old.length, next.length); i++) {
    if (old[i].char !== next[i].char || old[i].fragmentKey !== next[i].fragmentKey) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff < 0 && old.length !== next.length) {
    firstDiff = Math.min(old.length, next.length);
  }
  if (firstDiff < 0) return { firstDiff: -1, lastDiff: -1 };
  let lastDiff = next.length - 1;
  if (old.length === next.length) {
    for (let i = next.length - 1; i >= firstDiff; i--) {
      if (old[i].char !== next[i].char || old[i].fragmentKey !== next[i].fragmentKey) {
        lastDiff = i;
        break;
      }
    }
  }
  return { firstDiff, lastDiff };
}
