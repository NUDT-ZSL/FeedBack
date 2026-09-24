# -*- coding: utf-8 -*-
"""离线字幕对齐推演引擎。

根据锚点与片段顺序推导每段相对媒体的偏移量，检测重叠、越界、
时长倒置、锚点缺失与锚点矛盾；矛盾双方依据均保留，由用户裁决。
支持仅重推受影响片段的增量更新，且结果与整体重推一致。
"""
import copy

TOL = 0.08          # 偏移一致性容差（秒）
OVERLAP_TOL = 0.05  # 相邻片段重叠容差（秒）


def new_state():
    return {"media": {"duration": 0.0, "fps": 25.0},
            "anchors": [], "segments": [], "decisions": {}}


def _resolve_anchors(state):
    """把锚点绑定到片段下标，返回 (bindings, warnings)。"""
    segments = state["segments"]
    id2i = {s["id"]: i for i, s in enumerate(segments)}
    bindings, warnings = [], []
    for a in state["anchors"]:
        idx = None
        sid = a.get("segment_id")
        if sid and sid in id2i:
            idx = id2i[sid]
        elif a.get("text_match"):
            for i, s in enumerate(segments):
                if a["text_match"] in (s.get("text") or ""):
                    idx = i
                    break
        if idx is None:
            warnings.append({"anchor_id": a.get("id"),
                             "reason": "锚点无法匹配任何片段"})
            continue
        bindings.append({"anchor": a, "seg_index": idx,
                         "offset": a["media_time"] - segments[idx]["start"]})
    bindings.sort(key=lambda b: b["seg_index"])
    for x, y in zip(bindings, bindings[1:]):
        if y["anchor"]["media_time"] < x["anchor"]["media_time"] - TOL:
            warnings.append({
                "anchor_id": y["anchor"].get("id"),
                "reason": "锚点媒体时刻(%.3f)早于前序锚点 %s(%.3f)，与片段顺序矛盾"
                          % (y["anchor"]["media_time"], x["anchor"].get("id"),
                             x["anchor"]["media_time"])})
    return bindings, warnings


def _build_pairs(segments, bindings):
    """为每个锚点绑定计算前/后区间的漂移速率（秒偏移/秒）。"""
    rates = []
    for x, y in zip(bindings, bindings[1:]):
        dt = segments[y["seg_index"]]["start"] - segments[x["seg_index"]]["start"]
        rates.append((y["offset"] - x["offset"]) / dt if dt > 1e-9 else 0.0)
    pairs = []
    for k, b in enumerate(bindings):
        pairs.append({"b": b,
                      "rate_after": rates[k] if k < len(rates) else None,
                      "rate_before": rates[k - 1] if k > 0 else None})
    return pairs


def _fallback_rate(pairs):
    rs = sorted(p["rate_after"] for p in pairs if p["rate_after"] is not None)
    return rs[len(rs) // 2] if rs else 0.0


def _interp_offset(segments, pairs, i, exclude=None):
    """由相邻锚点插值/外推片段 i 的偏移。

    返回 (offset, confidence, evidence)；无任何锚点时返回 None。
    """
    ps = [p for p in pairs if p["b"] is not exclude]
    if not ps:
        return None
    t = segments[i]["start"]
    before = [p for p in ps if p["b"]["seg_index"] <= i]
    after = [p for p in ps if p["b"]["seg_index"] >= i]
    if before and after:
        bx, by = before[-1]["b"], after[0]["b"]
        if bx["seg_index"] == by["seg_index"]:
            return (bx["offset"], "high",
                    [{"type": "anchor", "anchor_id": bx["anchor"].get("id"),
                      "detail": "片段绑定锚点，偏移 %.3fs" % bx["offset"]}])
        t0 = segments[bx["seg_index"]]["start"]
        t1 = segments[by["seg_index"]]["start"]
        w = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
        off = bx["offset"] + w * (by["offset"] - bx["offset"])
        return (off, "medium", [
            {"type": "anchor", "anchor_id": bx["anchor"].get("id"),
             "detail": "前锚点偏移 %.3fs" % bx["offset"]},
            {"type": "anchor", "anchor_id": by["anchor"].get("id"),
             "detail": "后锚点偏移 %.3fs" % by["offset"]},
            {"type": "interp",
             "detail": "两锚点间线性插值（权重 %.2f）" % w}])
    if before:
        p = before[-1]
        r = p["rate_before"] if p["rate_before"] is not None else _fallback_rate(ps)
        off = p["b"]["offset"] + r * (t - segments[p["b"]["seg_index"]]["start"])
        return (off, "low", [
            {"type": "anchor", "anchor_id": p["b"]["anchor"].get("id"),
             "detail": "最近前锚点偏移 %.3fs" % p["b"]["offset"]},
            {"type": "extrapolate",
             "detail": "以漂移速率 %.4f/s 向后外推" % r}])
    p = after[0]
    r = p["rate_after"] if p["rate_after"] is not None else _fallback_rate(ps)
    off = p["b"]["offset"] - r * (segments[p["b"]["seg_index"]]["start"] - t)
    return (off, "low", [
        {"type": "anchor", "anchor_id": p["b"]["anchor"].get("id"),
         "detail": "最近后锚点偏移 %.3fs" % p["b"]["offset"]},
        {"type": "extrapolate",
         "detail": "以漂移速率 %.4f/s 向前外推" % r}])


def _compute_segment(state, pairs, i):
    """计算单个片段的对齐结果（不含相邻重叠检测）。"""
    seg = state["segments"][i]
    res = {"id": seg["id"], "index": i, "source": seg.get("source", ""),
           "text": seg.get("text", ""),
           "raw_start": seg["start"], "raw_end": seg["end"],
           "offset": None, "aligned_start": None, "aligned_end": None,
           "confidence": "untrusted", "status": "untrusted",
           "evidence": [], "conflicts": [], "issues": [], "resolved": False}
    if seg["end"] <= seg["start"]:
        res["issues"].append("时长倒置：结束时刻(%.3f)不大于开始时刻(%.3f)"
                             % (seg["end"], seg["start"]))
        return res
    if not pairs:
        res["issues"].append("缺少锚点：无法确定相对媒体的绝对偏移")
        return res
    res["status"] = "ok"
    own = next((p["b"] for p in pairs if p["b"]["seg_index"] == i), None)
    decision = (state.get("decisions") or {}).get(seg["id"])
    interp_excl = (_interp_offset(state["segments"], pairs, i, exclude=own)
                   if own else None)
    if own and interp_excl and abs(own["offset"] - interp_excl[0]) > TOL:
        res["conflicts"].append({
            "type": "anchor_conflict",
            "detail": "锚点偏移与相邻锚点插值不一致（差异 %.3fs）"
                      % abs(own["offset"] - interp_excl[0]),
            "parties": [
                {"type": "anchor", "anchor_id": own["anchor"].get("id"),
                 "offset": own["offset"],
                 "detail": "锚点媒体时刻 %.3fs，隐含偏移 %.3fs"
                           % (own["anchor"]["media_time"], own["offset"])},
                {"type": "interp", "offset": interp_excl[0],
                 "detail": "由相邻锚点推得偏移 %.3fs" % interp_excl[0]}]})
    if decision:
        ch = decision.get("choice")
        res["resolved"] = True
        off = None
        if ch == "anchor" and own:
            off, conf = own["offset"], "high"
            ev = [{"type": "decision",
                   "detail": "用户裁决：采用锚点 %s" % own["anchor"].get("id")}]
        elif ch == "interp" and interp_excl:
            off, conf = interp_excl[0], "medium"
            ev = [{"type": "decision",
                   "detail": "用户裁决：采用相邻锚点插值"}] + interp_excl[2]
        elif ch == "custom" and decision.get("offset") is not None:
            off, conf = float(decision["offset"]), "high"
            ev = [{"type": "decision", "detail": "用户指定偏移 %.3fs" % off}]
        if off is not None:
            res["offset"], res["confidence"], res["evidence"] = off, conf, ev
    if res["offset"] is None:
        if own:
            res["offset"] = own["offset"]
            res["confidence"] = "high"
            res["evidence"] = [
                {"type": "anchor", "anchor_id": own["anchor"].get("id"),
                 "detail": "片段绑定锚点，偏移 %.3fs" % own["offset"]}]
        else:
            off, conf, ev = _interp_offset(state["segments"], pairs, i)
            res["offset"], res["confidence"] = off, conf
            res["evidence"] = ev
    res["aligned_start"] = seg["start"] + res["offset"]
    res["aligned_end"] = seg["end"] + res["offset"]
    dur = state["media"].get("duration") or 0.0
    if res["aligned_start"] < -TOL or (dur > 0 and res["aligned_end"] > dur + TOL):
        res["issues"].append("越界：对齐后区间 [%.3f, %.3f] 超出媒体范围 [0, %.3f]"
                             % (res["aligned_start"], res["aligned_end"], dur))
    return res


def _apply_overlaps(seg_results):
    """相邻片段对齐后重叠检测，双方均保留依据。"""
    for r in seg_results:
        r["conflicts"] = [c for c in r["conflicts"]
                          if c.get("type") != "overlap"]
    for a, b in zip(seg_results, seg_results[1:]):
        if a["aligned_end"] is None or b["aligned_start"] is None:
            continue
        if a["aligned_end"] > b["aligned_start"] + OVERLAP_TOL:
            ov = a["aligned_end"] - b["aligned_start"]
            a["conflicts"].append({
                "type": "overlap", "detail": "与后序片段重叠 %.3fs" % ov,
                "parties": [
                    {"type": "self",
                     "detail": "本段对齐后结束于 %.3fs" % a["aligned_end"]},
                    {"type": "neighbor", "segment_id": b["id"],
                     "detail": "相邻段对齐后开始于 %.3fs" % b["aligned_start"]}]})
            b["conflicts"].append({
                "type": "overlap", "detail": "与前序片段重叠 %.3fs" % ov,
                "parties": [
                    {"type": "self",
                     "detail": "本段对齐后开始于 %.3fs" % b["aligned_start"]},
                    {"type": "neighbor", "segment_id": a["id"],
                     "detail": "相邻段对齐后结束于 %.3fs" % a["aligned_end"]}]})


def _finalize(seg_results):
    for r in seg_results:
        if r["status"] == "untrusted":
            continue
        if r["conflicts"] and not r["resolved"]:
            r["status"] = "conflict"
        elif r["conflicts"] or r["issues"]:
            r["status"] = "warning"
        else:
            r["status"] = "ok"


def _trend(seg_results, bindings):
    """漂移累积趋势：相对首个锚点偏移的漂移量与逐段步进。"""
    base = bindings[0]["offset"] if bindings else 0.0
    out, prev_off = [], None
    for r in seg_results:
        off = r["offset"]
        drift = (off - base) if off is not None else None
        step = ((off - prev_off)
                if (off is not None and prev_off is not None) else None)
        out.append({"id": r["id"], "offset": off,
                    "drift": drift, "step": step})
        if off is not None:
            prev_off = off
    return out


def derive(state, prev=None, affected=None):
    """推导对齐结果。

    给定 prev 与 affected（下标集合）时仅重算受影响片段，
    其余片段沿用上次结果；否则全量推导。
    """
    segments = state["segments"]
    n = len(segments)
    bindings, warnings = _resolve_anchors(state)
    pairs = _build_pairs(segments, bindings)
    if prev is not None and affected is not None \
            and len(prev.get("segments", [])) == n:
        seg_results = copy.deepcopy(prev["segments"])
        for i in sorted(affected):
            seg_results[i] = _compute_segment(state, pairs, i)
    else:
        affected = set(range(n))
        seg_results = [_compute_segment(state, pairs, i) for i in range(n)]
    _apply_overlaps(seg_results)
    _finalize(seg_results)
    anchors_view = [{"id": b["anchor"].get("id"),
                     "seg_index": b["seg_index"],
                     "segment_id": segments[b["seg_index"]]["id"],
                     "media_time": b["anchor"]["media_time"],
                     "offset": b["offset"],
                     "note": b["anchor"].get("note", "")} for b in bindings]
    return {"media": state["media"], "segments": seg_results,
            "anchors": anchors_view, "warnings": warnings,
            "trend": _trend(seg_results, bindings),
            "affected": sorted(affected)}


def _binding_deps(segments, bindings, i, exclude=None):
    """片段 i 的偏移计算所依赖的锚点绑定下标集合。

    插值依赖两侧最近绑定；外推依赖最近绑定及其内侧区间（由相邻
    两个绑定决定，故两个绑定下标都计入依赖）。
    """
    n = len(bindings)
    ks = [k for k in range(n) if k != exclude]
    if not ks:
        return set()
    left = [k for k in ks if bindings[k]["seg_index"] <= i]
    right = [k for k in ks if bindings[k]["seg_index"] >= i]
    deps = set()
    if left and right:
        deps.add(left[-1])
        deps.add(right[0])
    elif left:
        deps.add(left[-1])
        if left[-1] - 1 >= 0:
            deps.add(left[-1] - 1)
    else:
        deps.add(right[0])
        if right[0] + 1 < n:
            deps.add(right[0] + 1)
    return deps


def _segment_deps(state, bindings):
    """每个片段结果依赖的绑定下标集合（含锚点交叉验证证据）。"""
    seg2bind = {b["seg_index"]: k for k, b in enumerate(bindings)}
    out = []
    for i in range(len(state["segments"])):
        deps = _binding_deps(state["segments"], bindings, i)
        if i in seg2bind:
            deps |= _binding_deps(state["segments"], bindings, i,
                                  exclude=seg2bind[i])
        out.append(deps)
    return out


def apply_change(state, prev, changed_segment_ids=(), changed_anchor_ids=(),
                 changed_decision_ids=()):
    """按变更精确定位受影响片段并增量重推，返回 (result, affected)。

    锚点 k 变更时，受影响片段为所有依赖该绑定的片段；
    片段时间修正若该段带锚点，则视同对应锚点变更，否则只影响本段；
    裁决只影响本段。锚点删除退化为全量。
    """
    segments = state["segments"]
    n = len(segments)
    id2i = {s["id"]: i for i, s in enumerate(segments)}
    bindings, _ = _resolve_anchors(state)
    bidx = {b["anchor"].get("id"): k for k, b in enumerate(bindings)}
    seg2bind = {b["seg_index"]: k for k, b in enumerate(bindings)}
    deps = _segment_deps(state, bindings)
    idxs = set()
    full = False

    def add_binding_impact(k):
        idxs.update(j for j in range(n) if k in deps[j])

    for aid in changed_anchor_ids:
        if aid in bidx:
            add_binding_impact(bidx[aid])
        else:
            full = True  # 锚点删除或无法定位：退化为全量
    for sid in changed_segment_ids:
        if sid not in id2i:
            full = True
            continue
        i = id2i[sid]
        if i in seg2bind:
            add_binding_impact(seg2bind[i])
        idxs.add(i)
    for sid in changed_decision_ids:
        if sid in id2i:
            idxs.add(id2i[sid])
        else:
            full = True
    if full or not idxs:
        idxs = set(range(n))
    result = derive(state, prev=prev, affected=idxs)
    return result, sorted(idxs)
