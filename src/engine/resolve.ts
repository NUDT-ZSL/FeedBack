// ---------------------------------------------------------------------------
// 结论解析：从决策链推导最终生效结论的可读解释
// 优先级：consumed > 人工裁决决策 > 时间序最后的自动决策
// ---------------------------------------------------------------------------

import type { Decision, EventResult, SwitchRecord } from './types.ts';

/** 最终生效的决策（被消费的事件无生效决策） */
export function effectiveDecision(eventResult: EventResult): Decision | undefined {
  if (eventResult.disposition === 'consumed') return undefined;
  const manual = [...eventResult.decisions].reverse().find((d) => d.origin === 'manual');
  if (manual) return manual;
  return eventResult.decisions[eventResult.decisions.length - 1];
}

const ACTION_LABEL: Record<string, string> = {
  drop: '丢弃',
  downsample: '降采样',
  expand: '缓冲扩容',
  pause: '暂停来源',
  admit: '准入',
};

/** 生成事件结论的可读解释（可追溯决策链） */
export function explainEvent(
  eventResult: EventResult,
  switchesById: Map<string, SwitchRecord>,
): string {
  const parts: string[] = [];
  parts.push(`事件 ${eventResult.id}（来源 ${eventResult.source}，到达 t=${eventResult.tick}）`);
  if (eventResult.decisions.length === 0) {
    parts.push('未触发任何处置决策');
  }
  for (const decision of eventResult.decisions) {
    const sw = switchesById.get(decision.switchId);
    const via = sw
      ? `档位 ${sw.toTier}（切换 ${decision.switchId}，t=${sw.tick} 起生效）`
      : decision.switchId.endsWith('#0')
        ? '初始档位窗口'
        : `切换 ${decision.switchId}`;
    const origin = decision.origin === 'manual' ? '人工裁决' : '自动判定';
    parts.push(
      `t=${decision.tick} 经${via}的${ACTION_LABEL[decision.action] ?? decision.action}动作（${origin}）` +
        (decision.detail ? `：${decision.detail}` : ''),
    );
  }
  const finalLabel =
    eventResult.disposition === 'consumed'
      ? '已被消费'
      : eventResult.disposition === 'dropped'
        ? '最终被丢弃'
        : '最终被保留';
  const effective = effectiveDecision(eventResult);
  parts.push(
    effective
      ? `结论：${finalLabel}，生效决策来自切换 ${effective.switchId}（${effective.origin === 'manual' ? '人工裁决' : '自动判定'}）`
      : `结论：${finalLabel}`,
  );
  return parts.join('；');
}

/** 判断两个切换窗口是否覆盖同一事件区间（用于冲突排查） */
export function windowsOverlap(a: SwitchRecord, b: SwitchRecord): boolean {
  return a.source === b.source && a.affectedFrom <= b.affectedTo && b.affectedFrom <= a.affectedTo;
}
