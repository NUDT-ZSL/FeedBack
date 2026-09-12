"""graph / layout 的 unittest 测试。

固定随机种子（SEED=20260912），纯标准库、可离线复现。
"""

import random
import time
import unittest

from graph import Edge, Graph, Node, Port
from layout import LayoutEngine

SEED = 20260912


# ---------------------------------------------------------------------- #
# 几何校验辅助
# ---------------------------------------------------------------------- #

def segment_enters_rect(p, q, rect):
    """轴对齐折线段是否进入矩形内部。

    严格判定：段与矩形仅在边界上相接（端点落在节点边界）不算穿越。
    """
    x1, y1 = p
    x2, y2 = q
    rx, ry, rw, rh = rect
    ex, ey = rx + rw, ry + rh
    if abs(y1 - y2) < 1e-12:  # 水平段
        y = y1
        xa, xb = sorted((x1, x2))
        return xa < ex and rx < xb and ry < y < ey
    if abs(x1 - x2) < 1e-12:  # 竖直段
        x = x1
        ya, yb = sorted((y1, y2))
        return rx < x < ex and ya < ey and ry < yb
    raise AssertionError(f"非正交折线段: {p} -> {q}")


def route_crossings(graph, engine, positions, routes, ignore=None):
    """返回所有“折线段进入节点矩形内部”的 (edge_id, 段端点, 节点 id)。"""
    ignore = ignore or set()
    rects = {nid: (p[0], p[1]) + engine._size_of(nid)
             for nid, p in positions.items()}
    bad = []
    for eid, pts in routes.items():
        if eid in ignore:
            continue
        for a, b in zip(pts, pts[1:]):
            for nid, r in rects.items():
                if segment_enters_rect(a, b, r):
                    bad.append((eid, a, b, nid))
    return bad


def assert_endpoints_on_boundary(test, graph, engine, positions, routes):
    for eid, pts in routes.items():
        e = graph.edges[eid]
        if e.is_self_loop:
            x, y = positions[e.source]
            w, _ = engine._size_of(e.source)
            for px, py in (pts[0], pts[-1]):
                test.assertAlmostEqual(px, x + w)
            continue
        x, y = positions[e.source]
        w, h = engine._size_of(e.source)
        test.assertEqual(pts[0], (x + w, y + h / 2.0))
        x, y = positions[e.target]
        _, h = engine._size_of(e.target)
        test.assertEqual(pts[-1], (x, y + h / 2.0))


def rects_overlap(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


# ---------------------------------------------------------------------- #
# 内核（老接口）
# ---------------------------------------------------------------------- #

class KernelTests(unittest.TestCase):
    def test_connect_disconnect_snapshot(self):
        g = Graph()
        g.add_node("a", (1, 2), (10, 20))
        g.add_node("b")
        e = g.connect("a", "b", edge_id="e1")
        self.assertIsInstance(e, Edge)
        self.assertEqual(g.successors("a"), ["b"])
        snap = g.snapshot()
        self.assertEqual(snap["nodes"]["a"]["position"], [1, 2])
        self.assertEqual(snap["edges"][0]["id"], "e1")

        removed = g.disconnect("e1")
        self.assertEqual(removed.id, "e1")
        self.assertNotIn("e1", g.edges)
        with self.assertRaises(KeyError):
            g.disconnect("e1")
        with self.assertRaises(ValueError):
            g.connect("nope", "b")
        with self.assertRaises(ValueError):
            g.connect("a", "nope")

    def test_auto_edge_id_and_duplicate(self):
        g = Graph()
        g.add_node("a")
        g.add_node("b")
        self.assertEqual(g.connect("a", "b").id, "e1")
        self.assertEqual(g.connect("a", "b").id, "e2")  # 允许平行边
        with self.assertRaises(ValueError):
            g.connect("a", "b", edge_id="e1")

    def test_remove_node_cascades_edges(self):
        g = Graph()
        g.add_node("a")
        g.add_node("b")
        g.connect("a", "b")
        g.remove_node("a")
        self.assertEqual(len(g.edges), 0)

    def test_ports(self):
        n = Node("n")
        n.add_port("in0", "in")
        n.add_port("out0", "out")
        self.assertIsInstance(n.inputs[0], Port)
        with self.assertRaises(ValueError):
            n.add_port("bad", "sideways")
        with self.assertRaises(ValueError):
            n.add_port("in0", "in")

    def test_snapshot_is_deep_copy(self):
        g = Graph()
        g.add_node("a", (0, 0))
        snap = g.snapshot()
        g.nodes["a"].position = (9, 9)
        self.assertEqual(snap["nodes"]["a"]["position"], [0, 0])


# ---------------------------------------------------------------------- #
# 分层与排布
# ---------------------------------------------------------------------- #

class LayeringTests(unittest.TestCase):
    def test_longest_path_layers(self):
        # 图：
        #   a ──→ b ──→ c ──→ d
        #    \                ↑
        #     └──→ e ─────────┘   （e 让 d 的最长路径为 3）
        # 另外 a -> f（f 应在第 1 层，与 b 同层）
        g = Graph()
        for nid in "abcdef":
            g.add_node(nid)
        for s, t in [("a", "b"), ("b", "c"), ("c", "d"),
                     ("a", "e"), ("e", "d"), ("a", "f")]:
            g.connect(s, t)
        eng = LayoutEngine(g)
        layers = eng._longest_path_layers()
        by_layer = {l: set(v) for l, v in layers.items()}
        self.assertEqual(by_layer[0], {"a"})
        self.assertEqual(by_layer[1], {"b", "e", "f"})
        self.assertEqual(by_layer[2], {"c"})
        self.assertEqual(by_layer[3], {"d"})

    def test_same_layer_order_by_y_then_id(self):
        g = Graph()
        g.add_node("z", position=(0, 300))
        g.add_node("a", position=(0, 100))
        g.add_node("m", position=(0, 200))
        eng = LayoutEngine(g)
        pos = eng.layout()
        self.assertEqual([n for n, _ in sorted(pos.items(),
                                               key=lambda kv: kv[1][1])],
                         ["a", "m", "z"])
        # y 相同时按 id 字典序
        g2 = Graph()
        for nid in ("c", "a", "b"):
            g2.add_node(nid, position=(0, 50))
        p2 = LayoutEngine(g2).layout()
        self.assertEqual([n for n, _ in sorted(p2.items(),
                                               key=lambda kv: kv[1][1])],
                         ["a", "b", "c"])

    def test_variable_node_heights_no_overlap(self):
        g = Graph()
        g.add_node("n0", size=(160, 80))
        g.add_node("n1", size=(160, 120))
        g.add_node("n2", size=(160, 60))
        eng = LayoutEngine(g, v_gap=40)
        pos = eng.layout()
        rects = {n: pos[n] + g.nodes[n].size for n in pos}
        ids = sorted(pos, key=lambda n: pos[n][1])
        self.assertEqual(ids, ["n0", "n1", "n2"])
        self.assertEqual(pos["n0"][1], 0)
        self.assertAlmostEqual(pos["n1"][1], 80 + 40)
        self.assertAlmostEqual(pos["n2"][1], 80 + 40 + 120 + 40)
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                self.assertFalse(rects_overlap(rects[a], rects[b]))

    def test_variable_widths_drive_x(self):
        g = Graph()
        g.add_node("a", size=(100, 80))
        g.add_node("b", size=(160, 80))
        g.connect("a", "b")
        eng = LayoutEngine(g, h_gap=60)
        pos = eng.layout()
        self.assertEqual(pos["a"][0], 0)
        self.assertAlmostEqual(pos["b"][0], 100 + 60)

    def test_no_rect_overlap_full_graph(self):
        rng = random.Random(SEED)
        g = Graph()
        for i in range(60):
            g.add_node(f"n{i}", size=(rng.choice([(160, 80), (120, 120),
                                                   (200, 60)])))
        for _ in range(130):
            a, b = rng.sample(range(60), 2)
            if a < b and not g.edges_between(f"n{a}", f"n{b}"):
                g.connect(f"n{a}", f"n{b}")
        eng = LayoutEngine(g)
        pos = eng.layout()
        rects = [pos[n] + g.nodes[n].size for n in pos]
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                self.assertFalse(rects_overlap(rects[i], rects[j]))


# ---------------------------------------------------------------------- #
# 环
# ---------------------------------------------------------------------- #

class CycleTests(unittest.TestCase):
    def test_multinode_cycle_rejected_with_ids(self):
        g = Graph()
        for nid in ("a", "b", "c"):
            g.add_node(nid)
        g.connect("a", "b")
        g.connect("b", "c")
        g.connect("c", "a")
        eng = LayoutEngine(g)
        with self.assertRaises(ValueError) as ctx:
            eng.layout()
        msg = str(ctx.exception)
        for nid in ("a", "b", "c"):
            self.assertIn(nid, msg)

    def test_self_loop_is_routable_not_cycle_error(self):
        g = Graph()
        g.add_node("a")
        g.add_node("b")
        g.connect("a", "b")
        loop = g.connect("a", "a")
        eng = LayoutEngine(g)
        pos = eng.layout()  # 不应抛错
        routes = eng.route_edges(pos)
        self.assertIn(loop.id, routes)
        self.assertEqual(len(route_crossings(g, eng, pos, routes)), 0)


# ---------------------------------------------------------------------- #
# 路由
# ---------------------------------------------------------------------- #

class RoutingTests(unittest.TestCase):
    def _diamond_with_long_edge(self):
        # a ──→ b ──→ c ──→ d，外加长边 a ──→ d（跨 3 层）
        g = Graph()
        for nid in "abcd":
            g.add_node(nid)
        g.connect("a", "b", "ab")
        g.connect("b", "c", "bc")
        g.connect("c", "d", "cd")
        g.connect("a", "d", "ad")
        eng = LayoutEngine(g)
        pos = eng.layout()
        return g, eng, pos

    def test_endpoints_on_boundaries(self):
        g, eng, pos = self._diamond_with_long_edge()
        routes = eng.route_edges(pos)
        assert_endpoints_on_boundary(self, g, eng, pos, routes)

    def test_long_edge_does_not_cut_through_middle_nodes(self):
        g, eng, pos = self._diamond_with_long_edge()
        routes = eng.route_edges(pos)
        self.assertGreaterEqual(len(routes["ad"]), 5)  # 非退化直线
        self.assertEqual(route_crossings(g, eng, pos, routes), [])

        # 中间层节点纵向插满后，长边必须绕到更外侧通道，仍不得穿越。
        g2 = Graph()
        g2.add_node("a", position=(0, 400))
        for i in range(8):
            g2.add_node(f"m{i}")
        g2.add_node("d")
        g2.connect("a", "m0")
        for i in range(7):
            g2.connect(f"m{i}", f"m{i+1}")
        g2.connect("m7", "d")
        g2.connect("a", "d", "long")
        eng2 = LayoutEngine(g2)
        p2 = eng2.layout()
        r2 = eng2.route_edges(p2)
        self.assertEqual(route_crossings(g2, eng2, p2, r2), [])
        self.assertGreaterEqual(len(r2["long"]), 5)

    def test_self_loop_outside_node(self):
        g = Graph()
        g.add_node("a", position=(50, 60), size=(160, 80))
        g.add_node("b")
        g.connect("a", "b")
        eid = g.connect("a", "a").id
        eng = LayoutEngine(g)
        pos = eng.layout()
        routes = eng.route_edges(pos)
        pts = routes[eid]
        rect = pos["a"] + (160, 80)
        for p in pts:
            self.assertFalse(segment_enters_rect(p, p, rect))
        # 外扩圈整体位于节点右侧
        for x, y in pts:
            self.assertGreaterEqual(x, pos["a"][0] + 160 - 1e-9)
        self.assertEqual(len(pts), 4)

    def test_dense_random_dag_no_crossing_and_reproducible(self):
        rng = random.Random(SEED + 1)
        g = Graph()
        for i in range(120):
            g.add_node(f"n{i}")
        for _ in range(260):
            a, b = rng.sample(range(120), 2)
            if a < b and not g.edges_between(f"n{a}", f"n{b}"):
                g.connect(f"n{a}", f"n{b}")
        eng = LayoutEngine(g)
        p1 = eng.layout()
        p2 = eng.layout()
        self.assertEqual(p1, p2)
        r1 = eng.route_edges(p1)
        r2 = eng.route_edges(p1)
        self.assertEqual(r1, r2)
        self.assertEqual(len(r1), len(g.edges))
        self.assertEqual(route_crossings(g, eng, p1, r1), [])
        assert_endpoints_on_boundary(self, g, eng, p1, r1)

    def test_parallel_edges_do_not_overlap_vertical(self):
        # 同一 gap 内多条 y 区间重合的边必须分到不同 lane。
        g = Graph()
        for i in range(40):
            g.add_node(f"a{i}", position=(0, 100 * i))
            g.add_node(f"b{i}", position=(300, 100 * i))
            g.connect(f"a{i}", f"b{i}")
        eng = LayoutEngine(g)
        pos = eng.layout()
        routes = eng.route_edges(pos)
        self.assertEqual(route_crossings(g, eng, pos, routes), [])
        # 同一 gap x 上不允许两条竖直段 y 区间重合
        verts = []
        for pts in routes.values():
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                if abs(x1 - x2) < 1e-12 and abs(y1 - y2) > 1e-12:
                    verts.append((round(x1, 6), min(y1, y2), max(y1, y2)))
        verts.sort()
        for i in range(len(verts)):
            for j in range(i + 1, len(verts)):
                if verts[j][0] != verts[i][0]:
                    break
                self.assertFalse(
                    verts[i][1] < verts[j][2] and verts[j][1] < verts[i][2],
                    f"同通道竖段重合: {verts[i]} {verts[j]}")


# ---------------------------------------------------------------------- #
# scope 局部布局 / 增量扩圈
# ---------------------------------------------------------------------- #

class ScopeTests(unittest.TestCase):
    def _branch_graph(self):
        # u -> a -> b -> c ；x -> y（无关分支）
        g = Graph()
        for nid in ("u", "a", "b", "c", "x", "y"):
            g.add_node(nid)
        g.connect("u", "a")
        g.connect("a", "b")
        g.connect("b", "c")
        g.connect("x", "y")
        return g

    def test_scope_only_moves_seed_and_downstream(self):
        g = self._branch_graph()
        eng = LayoutEngine(g)
        full = eng.layout()
        g.apply_positions(full)
        # 把 a、b、c 拖乱，u 与无关分支 x->y 不动。
        g.nodes["a"].position = (700, 900)
        g.nodes["b"].position = (50, 50)
        g.nodes["c"].position = (-10, 800)
        before = {nid: g.nodes[nid].position for nid in g.nodes}

        pos = eng.layout({"a"})
        untouched = {"u", "x", "y"}
        for nid in untouched:
            self.assertEqual(pos[nid], before[nid],
                             f"{nid} 不在作用域内却被移动")
        moved = {"a", "b", "c"}
        # 受影响集合内每个节点都有坐标
        self.assertEqual(set(pos), set(g.nodes))
        # 受影响块内部重新堆叠：a 在最左层，b、c 依次向右
        self.assertLess(pos["a"][0], pos["b"][0])
        self.assertLess(pos["b"][0], pos["c"][0])

    def test_scope_unknown_ids_ignored(self):
        g = self._branch_graph()
        eng = LayoutEngine(g)
        full = eng.layout()
        g.apply_positions(full)
        pos = eng.layout({"a", "ghost"})
        self.assertEqual(pos["u"], full["u"])

    def test_incremental_expands_on_collision(self):
        g = Graph()
        g.add_node("a", position=(0, 0))
        g.add_node("b", position=(0, 0))
        g.add_node("c", position=(220, 0))  # 无关节点，恰好挡住 b 的新位置
        g.connect("a", "b")
        eng = LayoutEngine(g)

        # 只允许 1 轮：检测到 b 与 c 冲突即报错，冲突列表要点名两者。
        with self.assertRaises(RuntimeError) as ctx:
            eng.incremental_relayout({"a"}, max_rounds=1)
        msg = str(ctx.exception)
        self.assertIn("b", msg)
        self.assertIn("c", msg)

        # 默认 5 轮：c 被自动纳入受影响集合后重排成功，且最终无重叠。
        pos = eng.incremental_relayout({"a"})
        rects = [pos[n] + g.nodes[n].size for n in pos]
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                self.assertFalse(rects_overlap(rects[i], rects[j]))

    def test_incremental_empty_seed_returns_original(self):
        g = self._branch_graph()
        eng = LayoutEngine(g)
        full = eng.layout()
        g.apply_positions(full)
        pos = eng.incremental_relayout(set())
        self.assertEqual(pos, full)


# ---------------------------------------------------------------------- #
# 时钟注入 / 空图 / 深链
# ---------------------------------------------------------------------- #

class MiscTests(unittest.TestCase):
    def test_clock_injection_never_affects_coordinates(self):
        g = Graph()
        for i in range(5):
            g.add_node(f"n{i}")
        for i in range(4):
            g.connect(f"n{i}", f"n{i + 1}")
        ticks = iter([100.0, 300.0])
        eng = LayoutEngine(g, clock=lambda: next(ticks))
        pos = eng.layout()
        self.assertEqual(eng.last_elapsed, 200.0)
        self.assertEqual(pos, LayoutEngine(g).layout())

    def test_empty_graph(self):
        eng = LayoutEngine(Graph())
        self.assertEqual(eng.layout(), {})
        self.assertEqual(eng.route_edges({}), {})

    def test_deep_chain_5000_no_recursion(self):
        g = Graph()
        for i in range(5000):
            g.add_node(f"d{i}", size=(10, 10))
        for i in range(4999):
            g.connect(f"d{i}", f"d{i + 1}")
        eng = LayoutEngine(g, node_size=(10, 10), h_gap=10, v_gap=5)
        pos = eng.layout()
        self.assertEqual(pos["d0"][0], 0)
        self.assertGreater(pos["d4999"][0], pos["d0"][0])
        routes = eng.route_edges(pos)
        self.assertEqual(len(routes), 4999)


# ---------------------------------------------------------------------- #
# 性能
# ---------------------------------------------------------------------- #

def _build_random_dag(n_nodes, n_edges, seed, size=(80, 40)):
    rng = random.Random(seed)
    g = Graph()
    for i in range(n_nodes):
        g.add_node(f"p{i}", size=size)
    edges = set()
    while len(edges) < n_edges:
        a = rng.randrange(n_nodes)
        b = rng.randrange(n_nodes)
        if a < b and (a, b) not in edges:
            edges.add((a, b))
            g.connect(f"p{a}", f"p{b}")
    return g, rng


class PerformanceTests(unittest.TestCase):
    def test_500_nodes_1200_edges_under_2s(self):
        g, _ = _build_random_dag(500, 1200, SEED + 2)
        eng = LayoutEngine(g, node_size=(80, 40))
        t0 = time.perf_counter()
        pos = eng.layout()
        routes = eng.route_edges(pos)
        dt = time.perf_counter() - t0
        print(f"\n[perf] 500 节点 / 1200 边 layout+route = {dt:.3f}s")
        self.assertLess(dt, 2.0)
        self.assertEqual(len(routes), 1200)
        self.assertEqual(route_crossings(g, eng, pos, routes), [])

    def test_incremental_10_changed_under_200ms(self):
        # 真实使用场景：整图已排好，用户把 10 个节点在原位附近拖乱。
        g, rng = _build_random_dag(500, 1200, SEED + 2)
        eng = LayoutEngine(g, node_size=(80, 40))
        g.apply_positions(eng.layout())
        changed = [f"p{i}" for i in range(10)]
        for nid in changed:
            x, y = g.nodes[nid].position
            g.nodes[nid].position = (
                x + rng.uniform(-40, 40), y + rng.uniform(-60, 60))
        t0 = time.perf_counter()
        pos = eng.incremental_relayout(changed)
        dt = time.perf_counter() - t0
        print(f"\n[perf] 增量重排 10 个改动节点 = {dt * 1000:.1f}ms")
        self.assertLess(dt, 0.2)
        self.assertEqual(set(pos), set(g.nodes))


if __name__ == "__main__":
    unittest.main(verbosity=2)
