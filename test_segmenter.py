"""segmenter 核心逻辑自测。"""
import sample_data
import segmenter
from segmenter import Point

P = segmenter.DEFAULT_PARAMS


def test_drift_excluded_and_low_acc_kept():
    pts = sample_data.build()
    _, flags, kept = segmenter.segment(pts, P)
    excluded = [i for i, f in flags.items() if f["excluded"]]
    warned = [i for i, f in flags.items() if not f["excluded"]]
    assert len(excluded) == 1, flags
    assert len(warned) == 1, flags
    assert len(kept) == len(pts) - 1


def test_alternating_and_uncertain():
    pts = sample_data.build()
    segs, _, _ = segmenter.segment(pts, P)
    types = [s["type"] for s in segs]
    assert "uncertain" in types
    for a, b in zip(types, types[1:]):
        assert a != b, types  # 相邻段类型不同(停驻/移动交替,待确认独立成段)
    unc = next(s for s in segs if s["type"] == "uncertain")
    assert unc["reasons"], "待确认段必须说明原因"


def test_stay_requires_duration_and_extent():
    # 空间聚集但时长不足 -> 不是停驻
    pts = [Point(t=k * 20, lat=31.23, lon=121.47, acc=10) for k in range(5)]
    segs, _, _ = segmenter.segment(pts, P)
    assert all(s["type"] == "move" for s in segs)
    # 时长足够且聚集 -> 停驻
    pts = [Point(t=k * 30, lat=31.23 + k * 1e-6, lon=121.47, acc=10) for k in range(10)]
    segs, _, _ = segmenter.segment(pts, P)
    assert segs[0]["type"] == "stay"


def test_override_merge_and_validity():
    pts = sample_data.build()
    segs, _, kept = segmenter.segment(pts, P)
    flt = [pts[i] for i in kept]
    unc = next(s for s in segs if s["type"] == "uncertain")
    n_before = len(segs)
    segs = segmenter.override_segment(segs, flt, unc["id"], "move", P)
    assert len(segs) == n_before - 2  # 与前后两个移动段合并
    assert all(s["type"] != "uncertain" for s in segs)
    # 移动段改停驻:范围超界应提示但保留
    mv = next(s for s in segs if s["type"] == "move" and not s["overridden"])
    segs = segmenter.override_segment(segs, flt, mv["id"], "stay", P)
    tgt = next(s for s in segs if s["overridden"] and s["type"] == "stay")
    assert tgt["warnings"], "不满足判定条件必须提示"
    assert tgt["type"] == "stay", "用户决定必须保留"


if __name__ == "__main__":
    test_drift_excluded_and_low_acc_kept()
    test_alternating_and_uncertain()
    test_stay_requires_duration_and_extent()
    test_override_merge_and_validity()
    print("全部测试通过")
