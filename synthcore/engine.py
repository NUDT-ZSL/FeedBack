"""合成系统内核:增量重算引擎。

派生状态定义(与 README 中的规则一致):

- 物品成本 cost(item):获得 1 个该物品的最小成本。基础库存 > 0 的物品可
  直接消耗库存获得,单位成本为 1,来源记为 'stock'。其余物品成本 =
  min(配方成本 / 该物品在配方中的产出数量),配方成本 =
  sum(输入物品成本 * 输入数量)。成本用 Fraction 精确表示。
  成本为 None 表示不可获得(无库存且没有任何可用配方链)。
- 最优配方:达到最小成本的配方;成本相同(或同时不可行)时按配方标识的
  字典序取最小者。库存物品若没有被更便宜的配方取代,来源记为 'stock'
  (成本相同优先库存)。库存数量只影响可获得性(>0 即可),不影响单位成本。
- 环:在物品依赖图(配方输入物品 -> 输出物品)上求强连通分量(SCC),大小 > 1
  或存在自环的分量记为一条 cycle 冲突,并给出环上的配方序列。
  环上物品若存在环外来源(库存,或输入全部可获得的配方链),仍可正常获得,
  其最优配方、成本与依赖树均按该无环来源推导;只有推导无法脱离环的物品
  (成本保持 None)才判定为不可合成获得。
- 自增殖环(如 1A->2A,沿环成本可持续降低):成本按"推导深度不超过物品数"
  截断,未收敛的物品记入 _unsettled;当物品数变化(截断深度随之变化)时,
  这些物品被显式并入受影响集合重算,保证增量与全量一致。
- 最优配方:在达到最小成本的配方中,先排除"推导会绕回物品自身"的配方
  (某输入不存在不经过该物品的最小成本推导,由最小二乘不动点判定),
  其余按配方标识字典序取最小;与库存成本相同(=1)时优先库存。
  无环情形下所有候选配方都可行,裁决完全由配方标识决定。
- 增量重算:每次修改只重置"受影响物品"(变更配方的输出物品 + 反向依赖闭包,
  并并入受影响物品上游闭包中的未收敛物品)的派生值,未受影响物品保留缓存;
  由于未受影响且已收敛物品的全部传递输入都不在变更集中,其结果与从零全量
  推导逐物品一致(有随机化一致性测试保证)。
"""
from __future__ import annotations

from collections import defaultdict, deque
from fractions import Fraction
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from .errors import NotFoundError, ValidationError
from .model import Item, Recipe

Pair = Tuple[str, int]


class Engine:
    """物品 / 配方 / 库存 + 派生状态(成本、最优配方、可用性、环冲突)。"""

    def __init__(self) -> None:
        self.items: Dict[str, Item] = {}
        self.recipes: Dict[str, Recipe] = {}
        self._producers: Dict[str, Set[str]] = defaultdict(set)  # 物品 -> 生产它的配方
        self._consumers: Dict[str, Set[str]] = defaultdict(set)  # 物品 -> 消费它的配方
        self._cost: Dict[str, Optional[Fraction]] = {}
        self._best: Dict[str, Optional[str]] = {}
        self._usable: Dict[str, bool] = {}
        self.conflicts: List[dict] = []
        self._scc: Dict[str, int] = {}
        #: 成本松弛未收敛(自增殖环)的物品,向下游闭包;物品数变化时需重算
        self._unsettled: Set[str] = set()
        #: 上一次修改实际重算的物品集合(用于观测增量性)
        self.last_affected: frozenset = frozenset()

    # ------------------------------------------------------------------ #
    # 校验
    # ------------------------------------------------------------------ #
    @staticmethod
    def _check_id(value, where: str) -> str:
        if not isinstance(value, str) or not value:
            raise ValidationError(f"{where}: 标识必须为非空字符串, 实际为 {value!r}")
        return value

    @staticmethod
    def _check_qty(value, where: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise ValidationError(f"{where}: 数量必须为正整数, 实际为 {value!r}")
        return value

    @staticmethod
    def _check_stock(value, where: str) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValidationError(f"{where}: 库存必须为非负整数, 实际为 {value!r}")
        return value

    def _norm_pairs(self, pairs, kind: str, rid: str) -> Tuple[Pair, ...]:
        if isinstance(pairs, dict):
            pairs = list(pairs.items())
        try:
            pairs = list(pairs)
        except TypeError:
            raise ValidationError(f"配方 {rid!r} {kind}: 应为 (物品, 数量) 序列")
        if not pairs:
            raise ValidationError(f"配方 {rid!r} {kind}: 至少需要一个条目")
        out: List[Pair] = []
        seen: Set[str] = set()
        for idx, entry in enumerate(pairs):
            where = f"配方 {rid!r} {kind}[{idx}]"
            try:
                iid, qty = entry
            except (TypeError, ValueError):
                raise ValidationError(f"{where}: 应为 (物品, 数量) 对, 实际为 {entry!r}")
            self._check_id(iid, where + " 物品标识")
            self._check_qty(qty, where)
            if iid in seen:
                raise ValidationError(f"{where}: 物品 {iid!r} 在同一列表中重复出现")
            if iid not in self.items:
                raise ValidationError(f"{where}: 引用了不存在的物品 {iid!r}")
            seen.add(iid)
            out.append((iid, qty))
        return tuple(out)

    def _require_item(self, item_id: str) -> Item:
        try:
            return self.items[item_id]
        except KeyError:
            raise NotFoundError(f"物品 {item_id!r} 不存在")

    def _require_recipe(self, recipe_id: str) -> Recipe:
        try:
            return self.recipes[recipe_id]
        except KeyError:
            raise NotFoundError(f"配方 {recipe_id!r} 不存在")

    # ------------------------------------------------------------------ #
    # 修改操作(全部先校验后落库,失败不影响现有状态)
    # ------------------------------------------------------------------ #
    def add_item(self, item_id: str, stock: int = 0) -> None:
        self._check_id(item_id, "物品标识")
        self._check_stock(stock, f"物品 {item_id!r} 库存")
        if item_id in self.items:
            raise ValidationError(f"物品 {item_id!r} 已存在")
        self.items[item_id] = Item(item_id, stock)
        # 物品数变化会改变成本截断深度,未收敛物品必须一并重算
        self._recompute({item_id} | self._unsettled)

    def set_stock(self, item_id: str, stock: int) -> None:
        self._require_item(item_id)
        self._check_stock(stock, f"物品 {item_id!r} 库存")
        self.items[item_id] = Item(item_id, stock)
        self._recompute(self._affected_closure({item_id}))

    def add_recipe(self, recipe_id: str, inputs, outputs) -> None:
        self._check_id(recipe_id, "配方标识")
        if recipe_id in self.recipes:
            raise ValidationError(f"配方 {recipe_id!r} 已存在")
        ins = self._norm_pairs(inputs, "inputs", recipe_id)
        outs = self._norm_pairs(outputs, "outputs", recipe_id)
        self._install_recipe(Recipe(recipe_id, ins, outs))
        self._recompute(self._affected_closure(i for i, _ in outs))

    def remove_recipe(self, recipe_id: str) -> None:
        r = self._require_recipe(recipe_id)
        seed = {i for i, _ in r.outputs}
        self._uninstall_recipe(r)
        self._recompute(self._affected_closure(seed))

    def update_recipe(self, recipe_id: str, inputs, outputs) -> None:
        old = self._require_recipe(recipe_id)
        ins = self._norm_pairs(inputs, "inputs", recipe_id)
        outs = self._norm_pairs(outputs, "outputs", recipe_id)
        seed = {i for i, _ in old.outputs} | {i for i, _ in outs}
        self._uninstall_recipe(old)
        self._install_recipe(Recipe(recipe_id, ins, outs))
        self._recompute(self._affected_closure(seed))

    def _install_recipe(self, r: Recipe) -> None:
        self.recipes[r.id] = r
        for iid, _ in r.inputs:
            self._consumers[iid].add(r.id)
        for iid, _ in r.outputs:
            self._producers[iid].add(r.id)

    def _uninstall_recipe(self, r: Recipe) -> None:
        del self.recipes[r.id]
        self._usable.pop(r.id, None)
        for iid, _ in r.inputs:
            self._consumers[iid].discard(r.id)
        for iid, _ in r.outputs:
            self._producers[iid].discard(r.id)

    # ------------------------------------------------------------------ #
    # 重算
    # ------------------------------------------------------------------ #
    def _affected_closure(self, seed: Iterable[str]) -> Set[str]:
        """变更物品 + 所有传递依赖它们的物品(反向闭包)。"""
        seen: Set[str] = set()
        stack = [i for i in seed if i in self.items]
        while stack:
            iid = stack.pop()
            if iid in seen:
                continue
            seen.add(iid)
            for rid in self._consumers.get(iid, ()):
                for o, _ in self.recipes[rid].outputs:
                    if o not in seen:
                        stack.append(o)
        return seen

    def _upstream_closure(self, seed: Iterable[str]) -> Set[str]:
        """种子物品 + 它们的全部传递输入物品(正向闭包)。"""
        seen: Set[str] = set()
        stack = [i for i in seed if i in self.items]
        while stack:
            iid = stack.pop()
            if iid in seen:
                continue
            seen.add(iid)
            for rid in self._producers.get(iid, ()):
                for i2, _ in self.recipes[rid].inputs:
                    if i2 not in seen:
                        stack.append(i2)
        return seen

    def full_recompute(self) -> None:
        """从零全量推导(基准实现,也是校验增量正确性的参照)。"""
        self._recompute(set(self.items))

    def _recompute(self, affected: Set[str]) -> None:
        affected = {i for i in affected if i in self.items}
        # 未收敛物品不是不动点:受影响物品若读取未收敛的上游,必须把该上游
        # 一并重置重算,否则与全量推导的迭代深度错位
        if self._unsettled:
            affected |= self._upstream_closure(affected) & self._unsettled
        self.last_affected = frozenset(affected)

        # SCC 仅用于环冲突记录与配方 cyclic 标记,不影响成本推导
        self._scc = _scc_index(self._item_graph())

        cost = dict(self._cost)

        # 成本松弛:无自增殖环时,最优成本必然由深度不超过物品数的推导树
        # 达到,因此 len(items)+1 轮内收敛;存在自增殖环时成本持续下降,
        # 按该深度截断。截断值依赖于全部上游的逐轮预热序列,因此一旦未收敛,
        # 必须把未收敛物品的全部上游(含已收敛物品)并入重算,直到闭合并与
        # 全量推导逐轮对齐;未收敛物品记入 _unsettled。
        converged = True
        last_changed: Set[str] = set()
        max_sweeps = len(self.items) + 1
        while affected:
            for iid in affected:
                cost[iid] = Fraction(1) if self.items[iid].stock > 0 else None
            for _ in range(max_sweeps):
                last_changed = set()
                for rid in sorted(self.recipes):
                    r = self.recipes[rid]
                    total = Fraction(0)
                    ok = True
                    for iid, q in r.inputs:
                        c = cost.get(iid)
                        if c is None:
                            ok = False
                            break
                        total += c * q
                    if not ok:
                        continue
                    for o, q in r.outputs:
                        if o not in affected:
                            continue
                        cand = total / q
                        if cost[o] is None or cand < cost[o]:
                            cost[o] = cand
                            last_changed.add(o)
                if not last_changed:
                    break
            converged = not last_changed
            if converged:
                break
            # 未收敛:把仍在下降物品的全部上游并入受影响集合后重跑
            need = self._upstream_closure(last_changed) - affected
            if not need:
                break
            affected |= need
        self.last_affected = frozenset(affected)

        # 维护未收敛集合:本轮重算的物品先移出,仍下降的物品及其下游重新记入
        for iid in affected:
            self._unsettled.discard(iid)
        if not converged:
            self._unsettled |= self._affected_closure(last_changed)

        # 成本确定后,最优配方单轮直接确定(确定性,与迭代历史无关)
        best = dict(self._best)
        avoid_cache: Dict[str, Dict[str, bool]] = {}
        for iid in affected:
            best[iid] = self._compute_best(iid, cost, avoid_cache)

        self._cost, self._best = cost, best

        # 配方可用性:只重算消费了受影响物品的配方
        dirty_recipes: Set[str] = set()
        for iid in affected:
            dirty_recipes |= self._consumers.get(iid, set())
        for rid in dirty_recipes:
            r = self.recipes.get(rid)
            if r is not None:
                self._usable[rid] = all(
                    self._cost.get(i) is not None for i, _ in r.inputs
                )
        # 新增配方可能不消费任何受影响物品,也要补算
        for rid, r in self.recipes.items():
            if rid not in self._usable:
                self._usable[rid] = all(
                    self._cost.get(i) is not None for i, _ in r.inputs
                )

        self._detect_cycles()

    # ------------------------------------------------------------------ #
    # 环检测(Tarjan SCC,物品依赖图:输入物品 -> 输出物品)
    # ------------------------------------------------------------------ #
    def _item_graph(self) -> Dict[str, Set[str]]:
        adj: Dict[str, Set[str]] = defaultdict(set)
        for r in self.recipes.values():
            for iid, _ in r.inputs:
                for o, _ in r.outputs:
                    adj[iid].add(o)
        return adj

    def _compute_best(self, item_id: str, cost, avoid_cache) -> Optional[str]:
        """最优配方:达到最小成本、且推导不绕回物品自身的配方中,标识最小者;
        与库存同价(=1)时优先库存(返回 None)。"""
        c = cost.get(item_id)
        if c is None:
            return None
        if self.items[item_id].stock > 0 and c == 1:
            return None
        avoid = avoid_cache.get(item_id)
        if avoid is None:
            avoid = self._avoid_map(item_id, cost)
            avoid_cache[item_id] = avoid
        achieving = []
        for rid in self._producers.get(item_id, ()):
            r = self.recipes[rid]
            total = Fraction(0)
            ok = True
            for iid, q in r.inputs:
                ci = cost.get(iid)
                if ci is None or not avoid.get(iid):
                    ok = False
                    break
                total += ci * q
            if ok and total / r.output_qty(item_id) == c:
                achieving.append(rid)
        return min(achieving) if achieving else None

    def _avoid_map(self, target: str, cost) -> Dict[str, bool]:
        """avoid[i] = 物品 i 是否存在一条"不经过 target"的最小成本推导。

        最小二乘不动点:库存本身就是最小成本来源的物品为真;某物品存在一条
        达到最小成本、且所有输入都为真的配方时为真。沿推导必然终止于库存,
        因此为真的物品都有良基无环的最小成本推导。
        """
        avoid: Dict[str, bool] = {}
        for iid, it in self.items.items():
            avoid[iid] = (
                iid != target and it.stock > 0 and cost.get(iid) == Fraction(1)
            )
        for _ in range(len(self.items) + 1):
            changed = False
            for iid in sorted(self.items):
                if avoid[iid] or iid == target or cost.get(iid) is None:
                    continue
                for rid in self._producers.get(iid, ()):
                    r = self.recipes[rid]
                    total = Fraction(0)
                    ok = True
                    for i2, q in r.inputs:
                        ci = cost.get(i2)
                        if ci is None or not avoid.get(i2):
                            ok = False
                            break
                        total += ci * q
                    if ok and total / r.output_qty(iid) == cost[iid]:
                        avoid[iid] = True
                        changed = True
                        break
            if not changed:
                break
        return avoid

    def _is_cyclic_edge(self, r: Recipe, output: str) -> bool:
        """配方 r 用于产出 output 是否会成环(某输入与 output 同属一个环状 SCC)。"""
        so = self._scc.get(output)
        if so is None:
            return False
        return any(self._scc.get(i) == so for i, _ in r.inputs)

    def _detect_cycles(self) -> None:
        adj = self._item_graph()
        self.conflicts = []
        for comp in _tarjan_sccs(adj):
            self_loop = len(comp) == 1 and comp[0] in adj[comp[0]]
            if len(comp) > 1 or self_loop:
                items, recipes = self._extract_cycle(set(comp), adj)
                self.conflicts.append(
                    {
                        "type": "cycle",
                        "items": items,
                        "recipes": recipes,
                        "obtainable": {
                            i: self._cost.get(i) is not None for i in sorted(comp)
                        },
                    }
                )

    def _extract_cycle(self, scc: Set[str], adj) -> Tuple[List[str], List[str]]:
        """在 SCC 内找出一条具体环路径,返回(物品序列, 配方序列)。"""
        start = min(scc)
        if start in adj[start]:
            path = [start]
        else:
            # BFS 找 start -> ... -> u 且 u -> start
            parent = {start: None}
            queue = deque([start])
            found = None
            while queue and found is None:
                u = queue.popleft()
                if u != start and start in adj[u]:
                    found = u
                    break
                for v in sorted(adj[u] & scc):
                    if v not in parent:
                        parent[v] = u
                        queue.append(v)
            path = []
            u = found
            while u is not None:
                path.append(u)
                u = parent[u]
            path.reverse()
        recipes = []
        for a, b in zip(path, path[1:] + path[:1]):
            rid = min(
                r.id
                for r in self.recipes.values()
                if any(i == a for i, _ in r.inputs)
                and any(o == b for o, _ in r.outputs)
            )
            recipes.append(rid)
        return path, recipes

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #
    def craftable(self, item_id: str) -> bool:
        self._require_item(item_id)
        return self._cost.get(item_id) is not None

    def unit_cost(self, item_id: str) -> Optional[Fraction]:
        """获得 1 个该物品的最小成本;不可获得返回 None。"""
        self._require_item(item_id)
        return self._cost.get(item_id)

    def source(self, item_id: str) -> Optional[str]:
        """'recipe' / 'stock' / 'limit'(自增殖截断,无对应配方) / None。"""
        self._require_item(item_id)
        if self._best.get(item_id) is not None:
            return "recipe"
        if self.items[item_id].stock > 0:
            return "stock"
        if self._cost.get(item_id) is not None:
            return "limit"
        return None

    def best_recipe(self, item_id: str) -> Optional[str]:
        """最优配方标识;库存物品与不可获得物品返回 None(用 source 区分)。"""
        self._require_item(item_id)
        return self._best.get(item_id)

    def best_plan(self, item_id: str) -> dict:
        """某物品的最优获取方案。"""
        self._require_item(item_id)
        src = self.source(item_id)
        plan = {"item": item_id, "source": src, "cost": self._cost.get(item_id)}
        if src == "recipe":
            plan["recipe"] = self._best[item_id]
        elif src is None:
            plan["reason"] = self._explain(item_id, ())
        return plan

    def recipe_usable(self, recipe_id: str) -> bool:
        self._require_recipe(recipe_id)
        return self._usable.get(recipe_id, False)

    def recipe_status(self, recipe_id: str) -> dict:
        """配方可用性;不可用时给出每条缺失输入的完整缺失链。"""
        r = self._require_recipe(recipe_id)
        usable = self._usable.get(recipe_id, False)
        status = {
            "recipe": recipe_id,
            "usable": usable,
            "cyclic": any(self._is_cyclic_edge(r, o) for o, _ in r.outputs),
        }
        if not usable:
            status["missing"] = [
                self._explain(iid, ())
                for iid, _ in r.inputs
                if self._cost.get(iid) is None
            ]
        return status

    def _explain(self, item_id: str, path: Tuple[str, ...]) -> dict:
        """解释物品为何不可获得(递归到叶子:无库存无配方 / 环)。"""
        node = {"item": item_id, "stock": self.items[item_id].stock}
        if item_id in path:
            node["cause"] = "cycle"
            node["chain"] = list(path) + [item_id]
            return node
        producers = sorted(self._producers.get(item_id, ()))
        if not producers:
            node["cause"] = "无库存且没有任何配方能生产它"
            return node
        node["cause"] = "所有候选配方均不可用"
        node["candidates"] = []
        for rid in producers:
            r = self.recipes[rid]
            missing = [
                self._explain(i2, path + (item_id,))
                for i2, _ in r.inputs
                if self._cost.get(i2) is None
            ]
            node["candidates"].append({"recipe": rid, "missing": missing})
        return node

    def dependency_tree(self, item_id: str) -> dict:
        """按最优配方展开的完整合成依赖树(库存为叶子,环引用被截断标记)。"""
        self._require_item(item_id)

        def build(iid: str, path: Tuple[str, ...]) -> dict:
            if iid in path:
                return {"item": iid, "source": "cycle-ref"}
            node = {"item": iid, "stock": self.items[iid].stock}
            rid = self._best.get(iid)
            if rid is not None:
                node["source"] = "recipe"
                node["recipe"] = rid
                node["unit_cost"] = self._cost[iid]
                node["inputs"] = [
                    build(c, path + (iid,)) for c, _ in self.recipes[rid].inputs
                ]
            elif self.items[iid].stock > 0:
                node["source"] = "stock"
            elif self._cost.get(iid) is not None:
                node["source"] = "limit"
                node["reason"] = "自增殖环,成本为截断极限值"
            else:
                node["source"] = None
                node["reason"] = "不可获得"
            return node

        return build(item_id, ())

    def transitive_inputs(self, recipe_id: str) -> dict:
        """某配方的全部传递输入:沿最优配方展开到底层原材料。

        返回 {'raw': {物品: 数量}, 'missing': {物品: 数量}},
        raw 为有库存的叶子原材料,missing 为不可获得的叶子。数量为 Fraction。
        """
        r = self._require_recipe(recipe_id)
        raw: Dict[str, Fraction] = defaultdict(Fraction)
        missing: Dict[str, Fraction] = defaultdict(Fraction)

        def expand(iid: str, qty: Fraction, path: Tuple[str, ...]) -> None:
            rid = self._best.get(iid)
            if rid is not None and iid not in path:
                rr = self.recipes[rid]
                runs = qty / rr.output_qty(iid)
                for c, q in rr.inputs:
                    expand(c, q * runs, path + (iid,))
            elif self.items[iid].stock > 0:
                raw[iid] += qty
            else:
                missing[iid] += qty

        for iid, q in r.inputs:
            expand(iid, Fraction(q), ())
        return {"raw": dict(raw), "missing": dict(missing)}

    def relation(self, a: str, b: str) -> str:
        """两种物品的依赖先后关系(结构依赖,遍历全部配方)。

        返回 'a_depends_on_b' / 'b_depends_on_a' / 'cyclic'(互相依赖) / 'none'。
        """
        self._require_item(a)
        self._require_item(b)

        def reaches(src: str, dst: str) -> bool:
            seen = {src}
            queue = deque([src])
            while queue:
                u = queue.popleft()
                # 沿"输入"边走:u 作为输出时,它的生产配方的输入是 u 依赖的物品
                for rid in self._producers.get(u, ()):
                    for iid, _ in self.recipes[rid].inputs:
                        if iid == dst:
                            return True
                        if iid not in seen:
                            seen.add(iid)
                            queue.append(iid)
            return False

        if a == b:
            return "cyclic" if reaches(a, a) else "none"
        ab = reaches(a, b)
        ba = reaches(b, a)
        if ab and ba:
            return "cyclic"
        if ab:
            return "a_depends_on_b"
        if ba:
            return "b_depends_on_a"
        return "none"


def _scc_index(adj: Dict[str, Set[str]]) -> Dict[str, int]:
    """物品 -> 其环状 SCC 的编号;不在任何环中的物品不出现。"""
    index: Dict[str, int] = {}
    for n, comp in enumerate(_tarjan_sccs(adj)):
        if len(comp) > 1 or (len(comp) == 1 and comp[0] in adj[comp[0]]):
            for iid in comp:
                index[iid] = n
    return index


def _tarjan_sccs(adj: Dict[str, Set[str]]) -> List[List[str]]:
    """迭代版 Tarjan 强连通分量,返回分量列表(每个分量为物品标识列表)。"""
    index: Dict[str, int] = {}
    lowlink: Dict[str, int] = {}
    on_stack: Set[str] = set()
    stack: List[str] = []
    result: List[List[str]] = []
    counter = [0]

    for root in sorted(adj):
        if root in index:
            continue
        work = [(root, iter(sorted(adj[root])))]
        index[root] = lowlink[root] = counter[0]
        counter[0] += 1
        stack.append(root)
        on_stack.add(root)
        while work:
            v, it = work[-1]
            descended = False
            for w in it:
                if w not in index:
                    index[w] = lowlink[w] = counter[0]
                    counter[0] += 1
                    stack.append(w)
                    on_stack.add(w)
                    work.append((w, iter(sorted(adj[w]))))
                    descended = True
                    break
                if w in on_stack:
                    lowlink[v] = min(lowlink[v], index[w])
            if descended:
                continue
            work.pop()
            if work:
                parent = work[-1][0]
                lowlink[parent] = min(lowlink[parent], lowlink[v])
            if lowlink[v] == index[v]:
                comp = []
                while True:
                    w = stack.pop()
                    on_stack.discard(w)
                    comp.append(w)
                    if w == v:
                        break
                result.append(sorted(comp))
    return result
