import type {
  ShowState,
  ValidationEvidence,
  ValidationIssue,
} from '../types';
import {
  MAX_PROPS_PER_PUPPET,
  PUPPET_HEIGHT,
  PUPPET_SPECS,
  PUPPET_WIDTH,
  PROP_SPECS,
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from './constants';

function puppetLabel(name: string): string {
  return PUPPET_SPECS.find((s) => s.name === name)?.label ?? name;
}

function propLabel(name: string): string {
  return PROP_SPECS.find((s) => s.name === name)?.label ?? name;
}

/** 校验单个场次，返回定位到具体对象的问题列表 */
export function validateShow(show: ShowState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const base = { showId: show.id, showName: show.name };

  // 1. 影人是否都在舞台范围内
  for (const puppet of show.puppets) {
    if (!puppet.isOnStage) continue;
    const { x, y } = puppet.position;
    const out =
      x < 0 || y < 0 || x + PUPPET_WIDTH > STAGE_WIDTH || y + PUPPET_HEIGHT > STAGE_HEIGHT;
    if (out) {
      issues.push({
        type: 'puppet-out-of-stage',
        severity: 'error',
        ...base,
        objectId: puppet.id,
        message: `影人「${puppetLabel(puppet.name)}」超出舞台范围（位置 ${Math.round(x)},${Math.round(y)}）`,
        evidence: [
          {
            objectId: puppet.id,
            objectKind: 'puppet',
            detail: `position=(${x}, ${y}), 舞台=${STAGE_WIDTH}x${STAGE_HEIGHT}`,
          },
        ],
      });
    }
  }

  // 2. 道具挂载点是否指向存在的影人
  for (const prop of show.props) {
    if (prop.attachedTo === null) continue;
    const target = show.puppets.find((p) => p.id === prop.attachedTo);
    if (!target) {
      issues.push({
        type: 'attachment-target-missing',
        severity: 'error',
        ...base,
        objectId: prop.id,
        message: `道具「${propLabel(prop.name)}」挂载到不存在的影人 ${prop.attachedTo}`,
        evidence: [
          {
            objectId: prop.id,
            objectKind: 'prop',
            detail: `attachedTo=${prop.attachedTo}, point=${prop.attachmentPoint}`,
          },
        ],
      });
    }
  }

  // 3. 同一道具被挂到多个挂载点的冲突：收集账本与影人携带列表两侧的全部主张
  interface Claim {
    puppetId: string;
    point: string | null;
    via: string;
  }
  const claims = new Map<string, Claim[]>();
  const addClaim = (propId: string, claim: Claim) => {
    const list = claims.get(propId) ?? [];
    list.push(claim);
    claims.set(propId, list);
  };
  for (const prop of show.props) {
    if (prop.attachedTo !== null) {
      addClaim(prop.id, {
        puppetId: prop.attachedTo,
        point: prop.attachmentPoint,
        via: '道具账本',
      });
    }
  }
  for (const puppet of show.puppets) {
    for (const carried of puppet.props) {
      addClaim(carried.id, {
        puppetId: puppet.id,
        point: carried.attachmentPoint,
        via: `影人「${puppetLabel(puppet.name)}」携带列表`,
      });
    }
  }
  for (const [propId, list] of claims) {
    const merged = new Map<string, { puppetId: string; point: string | null; vias: string[] }>();
    for (const c of list) {
      const key = `${c.puppetId}@${c.point}`;
      const entry = merged.get(key) ?? { puppetId: c.puppetId, point: c.point, vias: [] };
      entry.vias.push(c.via);
      merged.set(key, entry);
    }
    if (merged.size <= 1) continue;
    const prop = show.props.find((p) => p.id === propId);
    const evidence: ValidationEvidence[] = [...merged.values()].map((m) => ({
      objectId: m.puppetId,
      objectKind: 'puppet' as const,
      detail: `${m.vias.join(" + ")}：挂载到 ${m.puppetId} 的 ${m.point ?? "未知挂载点"}`,
    }));
    issues.push({
      type: 'mount-conflict',
      severity: 'error',
      ...base,
      objectId: propId,
      message: `道具「${prop ? propLabel(prop.name) : propId}」存在 ${merged.size} 处冲突挂载，双方依据均已保留`,
      evidence,
    });
  }

  // 4. 录音事件时刻是否落在场次时长内 + 事件归属是否为当前场次
  for (const ev of show.recording.events) {
    if (ev.showId !== show.id) {
      issues.push({
        type: 'foreign-recording-event',
        severity: 'error',
        ...base,
        objectId: ev.id,
        message: `录音事件 ${ev.id}（${ev.note}）属于场次 ${ev.showId}，不应出现在本场`,
        evidence: [
          {
            objectId: ev.id,
            objectKind: 'recording-event',
            detail: `event.showId=${ev.showId}, 当前场次=${show.id}`,
          },
        ],
      });
    }
    if (ev.timestamp < 0 || ev.timestamp > show.duration) {
      issues.push({
        type: 'recording-event-out-of-duration',
        severity: 'error',
        ...base,
        objectId: ev.id,
        message: `录音事件 ${ev.id}（${ev.note} @ ${ev.timestamp}ms）超出场次时长 ${show.duration}ms`,
        evidence: [
          {
            objectId: ev.id,
            objectKind: 'recording-event',
            detail: `timestamp=${ev.timestamp}, duration=${show.duration}`,
          },
        ],
      });
    }
  }

  // 5. 影人携带道具数量超限
  for (const puppet of show.puppets) {
    if (puppet.props.length > MAX_PROPS_PER_PUPPET) {
      issues.push({
        type: 'puppet-over-capacity',
        severity: 'warning',
        ...base,
        objectId: puppet.id,
        message: `影人「${puppetLabel(puppet.name)}」携带 ${puppet.props.length} 个道具，超过上限 ${MAX_PROPS_PER_PUPPET}`,
        evidence: puppet.props.map((p) => ({
          objectId: p.id,
          objectKind: 'prop' as const,
          detail: propLabel(p.name),
        })),
      });
    }
  }

  return issues;
}

/** 整体重算所有场次 */
export function validateShows(shows: ShowState[]): Map<string, ValidationIssue[]> {
  const result = new Map<string, ValidationIssue[]>();
  for (const show of shows) result.set(show.id, validateShow(show));
  return result;
}

/**
 * 增量校验引擎：缓存每场结果，修正后只重算受影响场次，
 * 未受影响的场次直接复用缓存，合并结果与整体重算一致。
 */
export class ValidationEngine {
  private cache = new Map<string, ValidationIssue[]>();

  validate(
    shows: ShowState[],
    options: { onlyShowIds?: string[] } = {},
  ): Map<string, ValidationIssue[]> {
    const only = options.onlyShowIds ? new Set(options.onlyShowIds) : null;
    const alive = new Set(shows.map((s) => s.id));
    for (const cachedId of [...this.cache.keys()]) {
      if (!alive.has(cachedId)) this.cache.delete(cachedId);
    }
    const result = new Map<string, ValidationIssue[]>();
    for (const show of shows) {
      if (only === null || only.has(show.id) || !this.cache.has(show.id)) {
        this.cache.set(show.id, validateShow(show));
      }
      result.set(show.id, this.cache.get(show.id)!);
    }
    return result;
  }

  invalidate(showId: string): void {
    this.cache.delete(showId);
  }

  reset(): void {
    this.cache.clear();
  }
}
