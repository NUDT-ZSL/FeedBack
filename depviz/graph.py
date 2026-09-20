# -*- coding: utf-8 -*-
"""图算法：依赖环检测、拓扑排序、反向影响链。"""
import heapq
import sys


def find_cycles(nodes, edges):
    """用 Tarjan 强连通分量找出所有依赖环。

    返回环列表，每个环是参与闭环的模块 id 列表（排序后）。
    长度大于 1 的分量，或带自环的单节点，都视为环。
    """
    sys.setrecursionlimit(max(10000, len(nodes) * 4 + 100))
    index_of, lowlink, on_stack = {}, {}, set()
    stack, result = [], []
    counter = [0]

    def visit(v):
        index_of[v] = lowlink[v] = counter[0]
        counter[0] += 1
        stack.append(v)
        on_stack.add(v)
        for w in edges.get(v, []):
            if w not in index_of:
                visit(w)
                lowlink[v] = min(lowlink[v], lowlink[w])
            elif w in on_stack:
                lowlink[v] = min(lowlink[v], index_of[w])
        if lowlink[v] == index_of[v]:
            comp = []
            while True:
                w = stack.pop()
                on_stack.discard(w)
                comp.append(w)
                if w == v:
                    break
            result.append(comp)

    for n in nodes:
        if n not in index_of:
            visit(n)
    cycles = []
    for comp in result:
        if len(comp) > 1 or comp[0] in edges.get(comp[0], []):
            cycles.append(sorted(comp))
    return cycles


def topo_order(nodes, edges):
    """Kahn 拓扑排序，依赖排在使用者之前。输入必须是无环图。"""
    indeg = {n: 0 for n in nodes}
    dependents = {n: [] for n in nodes}
    for m in nodes:
        for d in edges.get(m, []):
            if d in indeg:
                indeg[m] += 1
                dependents[d].append(m)
    heap = [n for n in nodes if indeg[n] == 0]
    heapq.heapify(heap)
    order = []
    while heap:
        n = heapq.heappop(heap)
        order.append(n)
        for nxt in dependents[n]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                heapq.heappush(heap, nxt)
    return order


def impact_chains(edges, start):
    """从 start 沿依赖反方向（谁依赖它）BFS。

    返回 {受影响模块: 传导链}，传导链是从 start 到该模块的模块序列。
    """
    rev = {}
    for m, ds in edges.items():
        for d in ds:
            rev.setdefault(d, []).append(m)
    chains = {}
    path = {start: [start]}
    queue = [start]
    while queue:
        cur = queue.pop(0)
        for nxt in sorted(rev.get(cur, [])):
            if nxt in path:
                continue
            path[nxt] = path[cur] + [nxt]
            chains[nxt] = path[nxt]
            queue.append(nxt)
    return chains
