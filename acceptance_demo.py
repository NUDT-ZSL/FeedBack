# -*- coding: utf-8 -*-
"""离线验收演示：逐条演示需求 1..8 并打印可核对的中文报告。

运行（无需联网、无第三方依赖）：
    python acceptance_demo.py

产物：
    examples/sample.reflow.json   —— 可重新载入的完整存档样例
"""
import json
import os
import tempfile

from reflow import (
    AnchorError,
    Block,
    LayoutError,
    Manuscript,
    PersistenceError,
    ReflowEngine,
    ValidationError,
)

PASS = "通过"
FAIL = "失败"
results = []


def check(name, condition, detail=""):
    results.append((name, bool(condition)))
    tag = f"[{PASS}]" if condition else f"[{FAIL}]"
    print(f"  {tag} {name}" + (f" —— {detail}" if detail else ""))
    if not condition:
        raise SystemExit(f"验收点未通过：{name}")


def section(title):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def build_manuscript():
    return Manuscript("ms-2026-001", [
        Block("h1", "title", 0, 220, content="包容性阅读：分栏重排引擎"),
        Block("p1", "text", 1, 220,
              content="正文应当在字号放大与视窗变化时保持连续的阅读顺序，" * 8),
        Block("img1", "image", 2, 260,
              content="图1 城市天际线（摄影：作者）",
              image_width=600, image_height=300),
        Block("note1", "note", 3, 180, anchor="img1",
              content="注释：图片须紧跟图1，展示拍摄参数与来源"),
        Block("p2", "text", 4, 220, content="第二段文字内容。" * 60),
        Block("p3", "text", 5, 220, content="第三段文字内容。" * 40),
        Block("img2", "image", 6, 300,
              content="图2 超宽信息图（原始 3000×900）",
              image_width=3000, image_height=900),
        Block("p4", "text", 7, 220, content="收尾段落。" * 30),
    ], title="包容性阅读演示稿")


# ---- 需求 1 --------------------------------------------------------------- #
def demo_requirement_1():
    section("需求 1：稿件与内容块 —— 唯一标识 / 类型 / 顺序校验")
    ms = build_manuscript()
    print(f"  稿件 {ms.id} 含 {len(ms.blocks)} 个块，按原始顺序：")
    print("   ", [b.id for b in sorted(ms.blocks, key=lambda b: b.order)])
    check("合法稿件被接受", len(ms.blocks) == 8)

    def expect_error(label, fn, exc_type, needle):
        try:
            fn()
        except exc_type as e:
            ok = needle in str(e)
            check(label, ok, str(e))
            return e
        check(label, False, "未拒绝非法输入")

    expect_error("类型非法被拒绝并指出位置",
                 lambda: Block("x", "poetry", 1, 100),
                 ValidationError, "类型非法")
    dup = build_manuscript().blocks + [Block("p1", "text", 9, 100, content="重复标识")]
    e = expect_error("标识重复被拒绝并给出两个位置",
                     lambda: Manuscript("m", dup), ValidationError, "标识重复")
    check("重复错误携带首末位置",
          e.details.get("first_position") == 1 and e.details.get("position") == 8,
          f"first={e.details.get('first_position')}, here={e.details.get('position')}")
    bad_order = build_manuscript().blocks + [Block("z", "text", 4, 100)]
    expect_error("原始顺序重复被拒绝",
                 lambda: Manuscript("m", bad_order), ValidationError, "原始顺序重复")


# ---- 需求 2 --------------------------------------------------------------- #
def demo_requirement_2():
    section("需求 2：锚点 —— 指向存在且排序在前、无环、给出块序列")

    def expect_anchor(label, blocks, needle):
        try:
            Manuscript("m", blocks)
        except AnchorError as e:
            check(label, needle in str(e), f"{e}；涉及序列 {e.sequence}")
            return e
        check(label, False, "未拒绝非法锚点")

    expect_anchor("锚点指向不存在的块",
                  [Block("a", "text", 0, 100),
                   Block("b", "text", 1, 100, anchor="ghost")],
                  "不存在")
    e = expect_anchor("锚点目标必须排序在前",
                      [Block("a", "text", 0, 100, anchor="b"),
                       Block("b", "text", 1, 100)],
                      "排序在前")
    check("错误给出涉及块序列", e.sequence == ["b", "a"], str(e.sequence))
    e = expect_anchor("两个块争抢同一紧邻位置",
                      [Block("a", "text", 0, 100),
                       Block("b", "text", 1, 100, anchor="a"),
                       Block("c", "text", 2, 100, anchor="a")],
                      "锚点冲突")
    check("冲突序列可读", e.sequence == ["a", "b", "c"], str(e.sequence))

    ms = build_manuscript()
    seq = [b.id for b in ms.reading_sequence()]
    check("阅读序列中 note1 紧跟 img1",
          seq.index("note1") == seq.index("img1") + 1, str(seq))


# ---- 需求 3 --------------------------------------------------------------- #
def demo_requirement_3(eng):
    section("需求 3：按字号 / 视窗重排 —— 栏数单调、顺序保持、锚点不被打破")
    print(f"  {'字号':>4} {'视窗':>5} {'栏数':>4}  阅读顺序（栏号:偏移）")
    last_cols = None
    for font, vp in [(14, 1400), (18, 1100), (22, 900), (28, 700), (40, 480), (48, 300)]:
        r = eng.configure(font, vp)
        desc = " ".join(f"{p.block.id}@{p.column}:{p.offset}" for p in r.placements)
        print(f"  {font:>4} {vp:>5} {r.column_count:>4}  {desc}")
        cols = [p.column for p in r.placements]
        check(f"{font}/{vp} 栏号随阅读顺序单调不减", cols == sorted(cols))
        pm = {p.block.id: p for p in r.placements}
        adj = (pm["note1"].column == pm["img1"].column and
               pm["note1"].offset == pm["img1"].offset + pm["img1"].geometry.height)
        check(f"{font}/{vp} 锚点 note1 仍紧跟 img1", adj)
        if last_cols is not None:
            check(f"{font}/{vp} 放大字号/收窄视窗后栏数不增加",
                  r.column_count <= last_cols, f"{last_cols} -> {r.column_count}")
        last_cols = r.column_count
    try:
        eng.configure(99, 1000)
        check("非法字号被拒绝", False)
    except LayoutError as e:
        check("非法字号被拒绝", True, str(e))


# ---- 需求 4 --------------------------------------------------------------- #
def demo_requirement_4(eng):
    section("需求 4：增量重排 —— 只动受影响块，且与冷重排完全一致")

    def snapshot(r):
        return [(p.block.id, p.column, p.offset, p.band,
                 p.geometry.height, p.geometry.rendered_width,
                 p.geometry.scaled, p.geometry.degraded, p.geometry.degrade_reason)
                for p in r.placements]

    configs = [(16, 1200), (18, 1200), (19, 1200), (24, 820), (16, 1200)]
    for font, vp in configs:
        inc = eng.configure(font, vp)
        cold = eng.reflow_cold()
        same = snapshot(inc) == snapshot(cold)
        check(f"{font}/{vp} 增量结果 == 冷重排结果（逐字段）", same)
        print(f"      重测几何块={inc.geometry_recomputed}")
        print(f"      重新打包块={inc.relaid_out_blocks}")
        print(f"      坐标未变块 ={inc.unaffected_blocks}")
        print(f"      坐标变化块 ={inc.affected_blocks}")

    eng.configure(20, 1200)
    again = eng.configure(20, 1200)
    check("相同配置重复应用：零重测、零重排、零变化",
          again.geometry_recomputed == [] and again.relaid_out_blocks == []
          and again.affected_blocks == [])

    # 对象级前缀复用：固定视窗（栏宽不变），只改字号。未降级图片的几何只
    # 取决于栏宽，因此首个图片组签名不变，其 placement 对象被原样复用；
    # 只有其后的文本组重新测量/打包。
    prefix_eng = ReflowEngine(Manuscript("prefix", [
        Block("i", "image", 0, 200, content="题图", image_width=400, image_height=200),
        Block("t1", "text", 1, 200, content="前缀之后的文字。" * 40),
        Block("t2", "text", 2, 200, content="更后面的文字。" * 80),
    ]))
    prefix_eng.configure(18, 1100)
    old_img = prefix_eng._result.placement_of("i")
    r = prefix_eng.configure(19, 1100)
    new_img = r.placement_of("i")
    check("未受影响首组 placement 对象被原样复用（同一 Python 对象）",
          new_img is old_img)
    check("只有首个变化组之后被重新打包",
          r.relaid_out_blocks == ["t1", "t2"] and "i" in r.unaffected_blocks,
          f"relaid={r.relaid_out_blocks}")


# ---- 需求 5 --------------------------------------------------------------- #
def demo_requirement_5(eng):
    section("需求 5：图片缩放 / 降级 —— 确定性、记录原因、不丢弃内容")
    for font, vp in [(16, 1400), (20, 800), (28, 480), (40, 300), (44, 200)]:
        r = eng.configure(font, vp)
        line = [f"{font}/{vp}"]
        for bid in ("img1", "img2"):
            p = r.placement_of(bid)
            g = p.geometry
            state = ("正常" if not g.scaled and not g.degraded
                     else f"缩放×{g.scale_ratio:.2f}" if g.scaled
                     else f"降级({g.degrade_reason})")
            line.append(f"{bid}:{state} 渲染宽{g.rendered_width}/{g.original_width}")
        print("     ", " | ".join(line))

    eng.configure(40, 300)
    p = r2 = eng._result.placement_of("img2")
    check("超宽信息图在窄视窗下被降级", p.geometry.degraded)
    check("降级原因被记录", p.geometry.degrade_reason in
          ("below_legible_scale", "below_min_readable_width"),
          p.geometry.degrade_reason)
    check("内容未被丢弃：块仍在版面且替代说明保留",
          eng._result.placement_of("img2") is not None and bool(p.block.content))
    # 确定性：同一参数两次测量签名一致
    from reflow import measure, column_count, column_width
    n = column_count(40, 300, min_required_width=300)
    cw = column_width(300, n, 16)
    g1 = measure(p.block, 40, cw)
    g2 = measure(p.block, 40, cw)
    check("相同输入几何完全一致（确定性）", g1.signature() == g2.signature())


# ---- 需求 6 --------------------------------------------------------------- #
def demo_requirement_6(eng):
    section("需求 6：中断后恢复阅读位置（含回退）")
    eng.configure(18, 1100, reading_block_id="img1", reading_intra_offset=40)
    before = eng._result.placement_of("img1")
    print(f"  中断时：img1 位于栏 {before.column}，块内偏移 40")
    eng.configure(36, 560)
    out = eng.restore_reading_position("img1", 40)
    after = eng._result.placement_of("img1")
    print("  放大字号并收窄视窗后恢复：", out)
    check("恢复到同一块", out["restored"] and out["block_id"] == "img1")
    check("栏号为新版面栏号", out["column"] == after.column)
    check("给出块内偏移", out["intra_offset"] == 40)

    fb = eng.restore_reading_position("deleted-block", 10)
    print("  请求已删除块时：", fb)
    check("回退到可用块并说明原因",
          not fb["restored"] and fb["block_id"] and "不存在" in fb["fallback_reason"])


# ---- 需求 7 --------------------------------------------------------------- #
def demo_requirement_7(eng, sample_path):
    section("需求 7：稳定查询与重排版本号")
    eng.configure(22, 900)
    rows1 = [v.to_dict() for v in eng.query_all()]
    rows2 = [v.to_dict() for v in eng.query_all()]
    check("重复查询完全一致", rows1 == rows2)
    keys = [(r["column"], r["offset"], r["order"]) for r in rows1]
    check("结果按稳定顺序（栏号, 偏移, 原始顺序）", keys == sorted(keys))
    print(f"  {'块':>6} {'类型':>5} {'栏':>3} {'偏移':>5} {'降级':>5} {'锚点满足':>8}")
    for r in rows1:
        print(f"  {r['block_id']:>6} {r['type']:>5} {r['column']:>3} "
              f"{r['offset']:>5} {str(r['degraded']):>5} {str(r['anchor_satisfied']):>8}")
    v = eng.layout_version
    eng.configure(23, 900)
    check("每次重排版本号递增", eng.layout_version == v + 1, f"{v} -> {eng.layout_version}")
    img = eng.query_block("img1").to_dict()
    check("单块查询含全部要求字段",
          set(["column", "offset", "degraded", "degrade_reason", "anchor_satisfied"])
          <= set(img))


# ---- 需求 8 --------------------------------------------------------------- #
def demo_requirement_8(eng, sample_path):
    section("需求 8：存档 / 载入 / 损坏校验 / 失败状态不变")
    os.makedirs(os.path.dirname(sample_path), exist_ok=True)
    eng.save(sample_path)
    check("存档写出", os.path.exists(sample_path), sample_path)

    loaded = ReflowEngine.load(sample_path)
    same = ([(p.block.id, p.column, p.offset) for p in eng._result.placements]
            == [(p.block.id, p.column, p.offset) for p in loaded._result.placements])
    check("载入后版面与存档逐块一致", same)
    check("版本号恢复", loaded.layout_version == eng.layout_version)
    check("阅读位置恢复",
          loaded.reading_block_id == eng.reading_block_id
          and loaded.reading_intra_offset == eng.reading_intra_offset)

    with open(sample_path, encoding="utf-8") as f:
        good = json.load(f)
    tmpdir = tempfile.mkdtemp(prefix="reflow-corrupt-")

    def corrupt(name, mutate, raw_text=None):
        path = os.path.join(tmpdir, name)
        if raw_text is not None:
            with open(path, "w", encoding="utf-8") as f:
                f.write(raw_text)
        else:
            data = json.loads(json.dumps(good))  # 深拷贝
            mutate(data)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        try:
            ReflowEngine.load(path)
        except PersistenceError as e:
            check(f"损坏存档被拒绝（{name}）", True, str(e))
            return
        check(f"损坏存档被拒绝（{name}）", False)

    corrupt("not_json.json", None, raw_text="{oops")
    corrupt("missing_config.json", lambda d: d.pop("config"))
    corrupt("missing_block_field.json",
            lambda d: d["manuscript"]["blocks"][1].pop("min_readable_width"))
    corrupt("duplicate_id.json",
            lambda d: d["manuscript"]["blocks"][2].__setitem__("id", "p1"))
    corrupt("bad_anchor.json",
            lambda d: d["manuscript"]["blocks"][3].__setitem__("anchor", "ghost"))
    corrupt("tampered_column.json",
            lambda d: d["layout"]["blocks"][0].__setitem__("column", 42))
    corrupt("tampered_column_count.json",
            lambda d: d["layout"].__setitem__(
                "column_count", d["layout"]["column_count"] + 1))
    corrupt("ghost_reading.json",
            lambda d: d.__setitem__("reading_position",
                                    {"block_id": "ghost", "intra_offset": 0}))

    # 失败后既有引擎状态不变
    coords_before = [(p.block.id, p.column, p.offset)
                     for p in loaded._result.placements]
    version_before = loaded.layout_version
    try:
        ReflowEngine.load(os.path.join(tmpdir, "tampered_column.json"))
    except PersistenceError:
        pass
    coords_after = [(p.block.id, p.column, p.offset)
                    for p in loaded._result.placements]
    check("载入失败后既有引擎状态不变",
          coords_before == coords_after and loaded.layout_version == version_before)


def main():
    print("#" * 72)
    print("# 离线阅读重排引擎 —— 验收演示（纯标准库，无需联网）")
    print("#" * 72)
    demo_requirement_1()
    demo_requirement_2()
    eng = ReflowEngine(build_manuscript())
    demo_requirement_3(eng)
    demo_requirement_4(eng)
    demo_requirement_5(eng)
    demo_requirement_6(eng)
    sample_path = os.path.join("examples", "sample.reflow.json")
    demo_requirement_7(eng, sample_path)
    demo_requirement_8(eng, sample_path)

    section("验收汇总")
    print(f"  共 {len(results)} 个验收点，全部通过：{all(ok for _, ok in results)}")
    for name, ok in results:
        assert ok, name
    print("  结论：需求 1..8 全部满足。")


if __name__ == "__main__":
    main()
