// 面纹依赖图分析：找出指向缺失、指向已撤回、以及互相引用形成的闭环，
// 并给出确定性的拓扑推演顺序。任何异常都以数据形式返回，不抛异常、不中断推演。

export interface GraphNode {
  id: string
  withdrawn: boolean
  dependsOn: string[]
}

export interface GraphProblems {
  /** 每条边：source -> 缺失的依赖 */
  missingEdges: Array<{ source: string; missing: string }>
  /** 每条边：source -> 已撤回的依赖 */
  withdrawnEdges: Array<{ source: string; withdrawn: string }>
  /** 闭环，成员按 id 排序后输出，保证确定性 */
  cycles: string[][]
  /** 所有处于任一闭环上的面纹 id */
  cycleNodes: Set<string>
}

export function analyzeGraph(nodes: GraphNode[]): GraphProblems {
  const byId = new Map<string, GraphNode>()
  for (const node of nodes) {
    byId.set(node.id, node)
  }

  const missingEdges: GraphProblems['missingEdges'] = []
  const withdrawnEdges: GraphProblems['withdrawnEdges'] = []
  for (const node of nodes) {
    for (const depId of node.dependsOn) {
      const dep = byId.get(depId)
      if (!dep) {
        missingEdges.push({ source: node.id, missing: depId })
      } else if (dep.withdrawn) {
        withdrawnEdges.push({ source: node.id, withdrawn: depId })
      }
    }
  }

  // Tarjan 强连通分量：size>1（或自环）的分量即为闭环。
  const indexOf = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []
  let counter = 0

  const strongConnect = (start: string): void => {
    // 迭代版 Tarjan，避免深依赖链上的递归栈问题。
    interface Frame {
      id: string
      nextEdge: number
    }
    const work: Frame[] = [{ id: start, nextEdge: 0 }]
    indexOf.set(start, counter)
    low.set(start, counter)
    counter += 1
    stack.push(start)
    onStack.add(start)

    while (work.length > 0) {
      const frame = work[work.length - 1]
      const node = byId.get(frame.id)
      const neighbors = node ? node.dependsOn.filter((depId) => byId.has(depId)) : []
      if (frame.nextEdge < neighbors.length) {
        const neighbor = neighbors[frame.nextEdge]
        frame.nextEdge += 1
        if (!indexOf.has(neighbor)) {
          indexOf.set(neighbor, counter)
          low.set(neighbor, counter)
          counter += 1
          stack.push(neighbor)
          onStack.add(neighbor)
          work.push({ id: neighbor, nextEdge: 0 })
        } else if (onStack.has(neighbor)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, indexOf.get(neighbor)!))
        }
        continue
      }

      work.pop()
      if (work.length > 0) {
        const parent = work[work.length - 1].id
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.id)!))
      }
      if (low.get(frame.id) === indexOf.get(frame.id)) {
        const component: string[] = []
        for (;;) {
          const member = stack.pop()!
          onStack.delete(member)
          component.push(member)
          if (member === frame.id) break
        }
        const isSelfLoop =
          component.length === 1 && (byId.get(component[0])?.dependsOn.includes(component[0]) ?? false)
        if (component.length > 1 || isSelfLoop) {
          cycles.push(component.sort())
        }
      }
    }
  }

  for (const node of [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!indexOf.has(node.id)) strongConnect(node.id)
  }

  cycles.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const cycleNodes = new Set<string>()
  for (const cycle of cycles) {
    for (const id of cycle) cycleNodes.add(id)
  }

  missingEdges.sort((a, b) =>
    a.source === b.source
      ? a.missing < b.missing
        ? -1
        : a.missing > b.missing
          ? 1
          : 0
      : a.source < b.source
        ? -1
        : 1,
  )
  withdrawnEdges.sort((a, b) =>
    a.source === b.source
      ? a.withdrawn < b.withdrawn
        ? -1
        : a.withdrawn > b.withdrawn
          ? 1
          : 0
      : a.source < b.source
        ? -1
        : 1,
  )

  return { missingEdges, withdrawnEdges, cycles, cycleNodes }
}

/**
 * 可推演节点的确定性顺序：按“被依赖者在前”的拓扑序排列；
 * 闭环成员无法获得拓扑序，按 id 排序附在最后（它们会被 blocked-cycle 标记）。
 */
export function derivationOrder(nodes: GraphNode[], cycleNodes: Set<string>): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const order: string[] = []
  const visited = new Set<string>()

  const visit = (id: string, trail: Set<string>): void => {
    if (visited.has(id)) return
    if (trail.has(id)) return // 命中闭环：交由 blocked-cycle 处理
    const node = byId.get(id)
    if (!node) return
    const nextTrail = new Set(trail)
    nextTrail.add(id)
    for (const depId of node.dependsOn) {
      if (byId.has(depId) && !cycleNodes.has(depId)) visit(depId, nextTrail)
    }
    visited.add(id)
    order.push(id)
  }

  for (const id of [...byId.keys()].sort()) {
    if (!cycleNodes.has(id)) visit(id, new Set())
  }
  for (const id of [...cycleNodes].sort()) order.push(id)
  return order
}

/** 找出依赖闭包：从 seeds 出发，所有（传递）依赖它们的面纹 id，连同 seeds 本身 */
export function dependentClosure(nodes: GraphNode[], seeds: Iterable<string>): Set<string> {
  const affected = new Set<string>(seeds)
  // 构建反向边：dep -> 依赖它的面纹
  const dependents = new Map<string, string[]>()
  for (const node of nodes) {
    for (const depId of node.dependsOn) {
      const list = dependents.get(depId)
      if (list) list.push(node.id)
      else dependents.set(depId, [node.id])
    }
  }
  const queue = [...affected]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const dependent of dependents.get(current) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent)
        queue.push(dependent)
      }
    }
  }
  return affected
}
