import { Adjudication, ConfigIssue, SimConfig, TierConfig } from "./types";

/**
 * 档位配置校验。问题一律显式产出，绝不静默择一：
 * - INVALID_*：非法数值（blocking）；
 * - TIER_OVERLAP：两个及以上档位共享同一阈值；blocking，必须人工裁决（
 *   adjudications 中给出 overlap 选择），或修改配置；
 * - TIER_CYCLE：显式 escalateTo 链成环；blocking，需 cycle 裁决指定断点；
 * - DANGLING_TARGET：escalateTo 指向不存在的档位（blocking）。
 */
export function validateConfig(
  config: SimConfig,
  adjudications: Adjudication[] = [],
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const ids = new Set(config.tiers.map((t) => t.id));

  if (!(config.baseConsumeRate >= 0) || !Number.isFinite(config.baseConsumeRate)) {
    issues.push({
      code: "INVALID_RATE",
      message: `基础消费速率非法：${String(config.baseConsumeRate)}`,
      tierIds: [],
      blocking: true,
    });
  }

  const groups = new Map<number, string[]>();
  for (const tier of config.tiers) {
    if (!(tier.threshold >= 0) || !Number.isFinite(tier.threshold)) {
      issues.push({
        code: "INVALID_THRESHOLD",
        message: `档位 ${tier.id} 阈值非法：${String(tier.threshold)}`,
        tierIds: [tier.id],
        blocking: true,
      });
    }
    if (!(tier.consumeRate >= 0) || !Number.isFinite(tier.consumeRate)) {
      issues.push({
        code: "INVALID_RATE",
        message: `档位 ${tier.id} 消费速率非法：${String(tier.consumeRate)}`,
        tierIds: [tier.id],
        blocking: true,
      });
    }
    if (tier.releaseBelow !== undefined &&
      tier.releaseBelow >= tier.threshold) {
      issues.push({
        code: "INVALID_THRESHOLD",
        message: `档位 ${tier.id} 回落阈值必须小于进入阈值（${tier.releaseBelow} >= ${tier.threshold}）`,
        tierIds: [tier.id],
        blocking: true,
      });
    }
    const a = tier.action;
    if (!["drop", "downsample", "expandBuffer", "pauseSource"].includes(a.type)) {
      issues.push({
        code: "INVALID_ACTION",
        message: `档位 ${tier.id} 未知处置动作：${String(a.type)}`,
        tierIds: [tier.id],
        blocking: true,
      });
    }
    if (a.type === "downsample" &&
      (a.keepRatio === undefined || a.keepRatio <= 0 || a.keepRatio > 1)) {
      issues.push({
        code: "INVALID_ACTION",
        message: `档位 ${tier.id} 的 downsample.keepRatio 必须在 (0,1] 内`,
        tierIds: [tier.id],
        blocking: true,
      });
    }
    if (a.type === "expandBuffer" &&
      (a.capacity === undefined || a.capacity < 0)) {
      issues.push({
        code: "INVALID_ACTION",
        message: `档位 ${tier.id} 的 expandBuffer.capacity 必须 >= 0`,
        tierIds: [tier.id],
        blocking: true,
      });
    }
    if (tier.escalateTo !== undefined && !ids.has(tier.escalateTo)) {
      issues.push({
        code: "DANGLING_TARGET",
        message: `档位 ${tier.id} 的 escalateTo 指向不存在的档位 ${tier.escalateTo}`,
        tierIds: [tier.id, tier.escalateTo],
        blocking: true,
      });
    }
    const g = groups.get(tier.threshold) ?? [];
    g.push(tier.id);
    groups.set(tier.threshold, g);
  }

  for (const [threshold, tierIds] of groups) {
    if (tierIds.length > 1) {
      const resolved = adjudications.some(
        (a) => a.kind === "overlap" &&
          a.anchor === threshold &&
          tierIds.includes(a.chosenTierId),
      );
      issues.push({
        code: "TIER_OVERLAP",
        message:
          `档位 ${tierIds.join("、")} 共享阈值 ${threshold}，同一积压水平会并发触发多个档位` +
          (resolved ? "（已由人工裁决确定唯一生效档位）" : "，需人工裁决"),
        tierIds,
        blocking: !resolved,
      });
    }
  }

  // escalateTo 成环检测
  const cycles = detectCycles(config.tiers);
  for (const cyc of cycles) {
    const resolved = adjudications.some(
      (a) => a.kind === "cycle" &&
        cyc.includes(a.anchor as string) &&
        cyc.includes(a.chosenTierId),
    );
    issues.push({
      code: "TIER_CYCLE",
      message:
        `升级链成环：${cyc.join(" → ")} → ${cyc[0]}` +
        (resolved ? "（已由人工裁决在环上断开）" : "，需人工裁决断点"),
      tierIds: cyc,
      blocking: !resolved,
    });
  }

  return issues;
}

function detectCycles(tiers: TierConfig[]): string[][] {
  const byId = new Map(tiers.map((t) => [t.id, t]));
  const found: string[][] = [];
  const seenCycle = new Set<string>();

  for (const start of tiers) {
    const path: string[] = [];
    let cur: TierConfig | undefined = start;
    while (cur && cur.escalateTo !== undefined) {
      if (path.includes(cur.id)) {
        const cyc = path.slice(path.indexOf(cur.id));
        const key = [...cyc].sort().join("|");
        if (!seenCycle.has(key)) {
          seenCycle.add(key);
          found.push(cyc);
        }
        break;
      }
      path.push(cur.id);
      cur = byId.get(cur.escalateTo);
    }
  }
  return found;
}

export interface ResolvedTiers {
  /** 按阈值升序排列的档位（重叠处取裁决选择，其余稳定排序）。 */
  ordered: TierConfig[];
  /** threshold -> 裁决选择的档位（重叠时）。 */
  overlapChoice: Map<number, string>;
  /** 被 cycle 裁决断开的档位 id（忽略其 escalateTo）。 */
  cycleBreaks: Set<string>;
}

/**
 * 将裁决应用到配置上，得到确定性的档位线性顺序与升级规则。
 * 排序键 (threshold, 是否裁决优先, id 字典序)，保证完全确定。
 */
export function resolveTiers(
  config: SimConfig,
  adjudications: Adjudication[] = [],
): ResolvedTiers {
  const overlapChoice = new Map<number, string>();
  for (const a of adjudications) {
    if (a.kind === "overlap") {
      overlapChoice.set(a.anchor as number, a.chosenTierId);
    }
  }
  const cycleBreaks = new Set<string>();
  for (const a of adjudications) {
    if (a.kind === "cycle") cycleBreaks.add(a.chosenTierId);
  }

  // 每个阈值最多保留一个档位：裁决选择优先，否则取 id 最小者
  // （该分支只在非阻塞模式下被使用，例如校验器调用前的容错场景）。
  const byThreshold = new Map<number, TierConfig[]>();
  for (const t of config.tiers) {
    const arr = byThreshold.get(t.threshold) ?? [];
    arr.push(t);
    byThreshold.set(t.threshold, arr);
  }
  const ordered: TierConfig[] = [];
  for (const arr of byThreshold.values()) {
    if (arr.length === 1) {
      ordered.push(arr[0]);
    } else {
      const chosenId = overlapChoice.get(arr[0].threshold);
      const pick =
        arr.find((t) => t.id === chosenId) ??
        [...arr].sort((a, b) => (a.id < b.id ? -1 : 1))[0];
      ordered.push(pick);
    }
  }
  ordered.sort((a, b) =>
    a.threshold === b.threshold ? (a.id < b.id ? -1 : 1) : a.threshold - b.threshold,
  );
  return { ordered, overlapChoice, cycleBreaks };
}
