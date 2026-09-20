# -*- coding: utf-8 -*-
"""依赖图结构分析：边集、强连通分量（成环检测）、构建顺序、反向可达集。"""


def dependency_edges(manifest):
    """返回 (edges, missing)。

    edges:   {模块id: [清单中存在的依赖id, ...]}（按声明顺序去重）
    missing: {模块id: [指向清单外模块的依赖名, ...]}
    """
    edges = {}
    missing = {}
    for mid, mod in manifest.modules.items():
        seen = set()
        ok = []
        miss = []
        for dep in mod.deps:
            if dep in seen:
                continue
            seen.add(dep)
            if dep in manifest.modules:
                ok.append(dep)
            else:
                miss.append(dep)
        edges[mid] = ok
        if miss:
            missing[mid] = miss
    return edges, missing


def tarjan_scc(nodes, edges):
    """迭代版 Tarjan，返回强连通分量列表（每个分量是按 id 排序的列表）。"""
    index_of = {}
    lowlink = {}
    on_stack = set()
    stack = []
    result = []
    counter = [0]

    for root in nodes:
        if root in index_of:
            continue
        work = [(root, 0)]
        while work:
            node, child_idx = work[-1]
            if child_idx == 0:
                index_of[node] = lowlink[node] = counter[0]
                counter[0] += 1
                stack.append(node)
                on_stack.add(node)
            recurse = False
            children = edges.get(node, [])
            i = child_idx
            while i < len(children):
                nxt = children[i]
                if nxt not in index_of:
                    work[-1] = (node, i + 1)
                    work.append((nxt, 0))
                    recurse = True
                    break
                if nxt in on_stack:
                    lowlink[node] = min(lowlink[node], index_of[nxt])
                i += 1
            if recurse:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                lowlink[parent] = min(lowlink[parent], lowlink[node])
            if lowlink[node] == index_of[node]:
                scc = []
                while True:
                    w = stack.pop()
                    on_stack.discard(w)
                    scc.append(w)
                    if w == node:
                        break
                result.append(sorted(scc))
    return result


def build_order(nodes, edges, sccs):
    """构建顺序：被依赖的分量在前。环作为整组相邻输出，组内按 id 排序。"""
    scc_of = {}
    for i, scc in enumerate(sccs):
        for m in scc:
            scc_of[m] = i
    deps_of = [set() for _ in sccs]
    for m, ds in edges.items():
        for d in ds:
            a, b = scc_of[m], scc_of[d]
            if a != b:
                deps_of[a].add(b)
    done = [False] * len(sccs)
    remaining = set(range(len(sccs)))
    order = []
    while remaining:
        ready = [i for i in remaining if all(done[j] for j in deps_of[i])]
        if not ready:  # 凝聚图理论无环，兜底防死循环
            ready = [min(remaining)]
        ready.sort(key=lambda i: sccs[i][0])
        for i in ready:
            order.extend(sccs[i])
            done[i] = True
            remaining.discard(i)
    return order


def reverse_adjacency(edges):
    """反向邻接表：dep -> [依赖它的模块]。"""
    rev = {m: [] for m in edges}
    for m, ds in edges.items():
        for d in ds:
            rev.setdefault(d, []).append(m)
    for ds in rev.values():
        ds.sort()
    return rev


def reverse_reachable(edges, sources):
    """从 sources 出发沿“被谁依赖”方向可达的全部模块（含 sources 自身）。"""
    rev = reverse_adjacency(edges)
    seen = set(sources)
    queue = list(sources)
    while queue:
        cur = queue.pop(0)
        for nxt in rev.get(cur, []):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen
