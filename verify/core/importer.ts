/**
 * 导入与引用校验：
 *  - 指向缺失（missing-ref）：记录依赖 / 事件关联指向不存在的记录或对象；
 *  - 自引用（self-ref）：记录依赖自身；
 *  - 成环（cycle）：记录依赖关系构成有向环（Tarjan SCC）。
 * 所有异常都落成可追溯 Anomaly（归属主体 + 引用路径），绝不静默跳过。
 * 异常边仅从推导图中剔除，记录本身仍参与回放，保证回放结论不缺失。
 */
import type { Anomaly, ImportInput, ImportResult, KeyEvent, SpatialRecord } from './types.ts';

export function importAll(batches: ImportInput[]): ImportResult {
  const records = new Map<string, SpatialRecord>();
  const events = new Map<string, KeyEvent>();
  for (const batch of batches) {
    for (const record of batch.records ?? []) records.set(record.id, record);
    for (const event of batch.events ?? []) events.set(event.id, event);
  }

  const anomalies: Anomaly[] = [];
  const objectIds = new Set<string>();
  for (const record of records.values()) objectIds.add(record.objectId);

  // 1) 指向缺失 + 自引用（记录依赖）
  for (const record of [...records.values()].sort((a, b) => a.id < b.id ? -1 : 1)) {
    for (const dep of record.dependsOn ?? []) {
      if (dep === record.id) {
        anomalies.push({
          kind: 'self-ref',
          owner: `record:${record.id}`,
          path: [record.id, record.id],
          message: `记录 ${record.id} 依赖自身，构成自引用`,
        });
      } else if (!records.has(dep)) {
        anomalies.push({
          kind: 'missing-ref',
          owner: `record:${record.id}`,
          path: [record.id, dep],
          message: `记录 ${record.id} 依赖的记录 ${dep} 不存在`,
        });
      }
    }
  }

  // 2) 指向缺失（事件关联）
  for (const event of [...events.values()].sort((a, b) => a.id < b.id ? -1 : 1)) {
    for (const rid of event.linkedRecordIds ?? []) {
      if (!records.has(rid)) {
        anomalies.push({
          kind: 'missing-ref',
          owner: `event:${event.id}`,
          path: [event.id, rid],
          message: `事件 ${event.id} 关联的记录 ${rid} 不存在`,
        });
      }
    }
    for (const oid of event.linkedObjectIds ?? []) {
      if (!objectIds.has(oid)) {
        anomalies.push({
          kind: 'missing-ref',
          owner: `event:${event.id}`,
          path: [event.id, oid],
          message: `事件 ${event.id} 关联的对象 ${oid} 不存在`,
        });
      }
    }
  }

  // 3) 成环检测（Tarjan SCC，仅基于存在的记录边）
  const edges = new Map<string, string[]>();
  for (const record of records.values()) {
    edges.set(record.id, (record.dependsOn ?? []).filter(
      (dep) => dep !== record.id && records.has(dep),
    ));
  }
  for (const component of stronglyConnectedComponents(edges)) {
    if (component.length > 1) {
      const cyclePath = [...component, component[0]];
      for (const id of component) {
        anomalies.push({
          kind: 'cycle',
          owner: `record:${id}`,
          path: cyclePath,
          message: `记录 ${id} 处于依赖环 ${cyclePath.join(' -> ')} 中`,
        });
      }
    }
  }

  // 成环记录之间的推导边全部剔除（边保留给异常归因，不进入推导图）
  const cyclicIds = new Set(
    anomalies.filter((a) => a.kind === 'cycle').map((a) => a.owner.slice('record:'.length)),
  );
  const cleanEdges = new Map<string, string[]>();
  for (const [id, deps] of edges) {
    cleanEdges.set(id, cyclicIds.has(id) ? [] : deps.filter((dep) => !cyclicIds.has(dep)));
  }

  anomalies.sort((a, b) =>
    a.kind === b.kind
      ? (a.owner === b.owner ? a.path.join('>').localeCompare(b.path.join('>')) : a.owner.localeCompare(b.owner))
      : a.kind.localeCompare(b.kind),
  );
  return { records, events, anomalies, edges: cleanEdges };
}

/** Tarjan 强连通分量，返回所有分量（长度 > 1 即环）。 */
function stronglyConnectedComponents(edges: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const visit = (node: string): void => {
    index.set(node, counter);
    lowlink.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of (edges.get(node) ?? []).slice().sort()) {
      if (!index.has(next)) {
        visit(next);
        lowlink.set(node, Math.min(lowlink.get(node)!, lowlink.get(next)!));
      } else if (onStack.has(next)) {
        lowlink.set(node, Math.min(lowlink.get(node)!, index.get(next)!));
      }
    }
    if (lowlink.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component.sort());
    }
  };

  for (const node of [...edges.keys()].sort()) {
    if (!index.has(node)) visit(node);
  }
  return components;
}
