# -*- coding: utf-8 -*-
"""核心推演引擎：位置对象、来源主张、冲突检测、范围查找与增量更新。

设计要点：
- 每个位置对象可携带多条来源主张(claim)，任何字段矛盾都保留全部来源并标记，
  绝不静默择一；未经裁决的不可信对象不参与邻近排序。
- 每个查找请求独立评估，产出命中(按距离排序)、排除、无法判定三类结论，
  每条结论都附带可追溯的判定依据。
- 对象被修正/撤回/裁决后，只重推结论实际受影响的查找，并提供与整体重推
  的一致性校验。
"""
import json
import math
import uuid
from datetime import datetime

BOUNDARY_EPS = 1e-6   # 边界判定容差（坐标单位）
COORD_EPS = 1e-9      # 坐标一致性容差
FIELDS = ("lat", "lon", "category", "valid_from", "valid_to")


def new_id(prefix):
    return "%s-%s" % (prefix, uuid.uuid4().hex[:8])


def parse_time(value):
    if value in (None, ""):
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)


def fmt_time(value):
    return value.isoformat() if value else None


def norm_number(value):
    if value in (None, ""):
        return None
    return float(value)


def make_claim(object_id, source=None, lat=None, lon=None, category=None,
               valid_from=None, valid_to=None, note="", claim_id=None, timestamp=None):
    return {
        "claim_id": claim_id or new_id("clm"),
        "object_id": object_id,
        "source": source or "未标注来源",
        "timestamp": timestamp or datetime.now().isoformat(timespec="seconds"),
        "lat": norm_number(lat),
        "lon": norm_number(lon),
        "category": category or None,
        "valid_from": fmt_time(parse_time(valid_from)),
        "valid_to": fmt_time(parse_time(valid_to)),
        "note": note or "",
        "retracted": False,
    }


def _distinct(values):
    seen, out = set(), []
    for v in values:
        key = round(v, 9) if isinstance(v, float) else v
        if key not in seen:
            seen.add(key)
            out.append(v)
    return out


def resolve_field(obj, field):
    """解析单个字段，返回 (status, value, basis)。
    status: adjudicated / consistent / missing / conflict。"""
    adj = obj["adjudications"].get(field)
    if adj:
        if adj.get("claim_id"):
            claim = next((c for c in obj["claims"] if c["claim_id"] == adj["claim_id"]), None)
            if claim and not claim["retracted"]:
                return "adjudicated", claim[field], {
                    "by": adj.get("by"), "rationale": adj.get("rationale"),
                    "claim_id": claim["claim_id"], "source": claim["source"]}
        elif adj.get("value") is not None:
            return "adjudicated", adj["value"], {
                "by": adj.get("by"), "rationale": adj.get("rationale"), "value": adj["value"]}
    active = [c for c in obj["claims"] if not c["retracted"]]
    values = _distinct([c[field] for c in active if c[field] is not None])
    if not values:
        return "missing", None, {}
    if len(values) == 1:
        return "consistent", values[0], {}
    return "conflict", None, {
        "candidates": [{"value": c[field], "source": c["source"], "claim_id": c["claim_id"]}
                       for c in active if c[field] is not None]}


def analyze_object(obj):
    """计算对象各字段的解析状态、问题清单与整体可信度。"""
    analysis = {"fields": {}, "issues": []}
    for field in FIELDS:
        status, value, basis = resolve_field(obj, field)
        analysis["fields"][field] = {"status": status, "value": value, "basis": basis}
        if status == "conflict":
            analysis["issues"].append({"field": field, "kind": "conflict",
                "message": "字段 %s 存在互相矛盾的多方来源，已保留全部来源并标记不可信" % field})
        elif status == "missing" and field in ("lat", "lon"):
            analysis["issues"].append({"field": field, "kind": "missing", "message": "坐标缺失"})
    lat = analysis["fields"]["lat"]["value"]
    lon = analysis["fields"]["lon"]["value"]
    lat_ok = analysis["fields"]["lat"]["status"] in ("consistent", "adjudicated") and lat is not None
    lon_ok = analysis["fields"]["lon"]["status"] in ("consistent", "adjudicated") and lon is not None
    if lat_ok and lon_ok and not (-90 <= lat <= 90 and -180 <= lon <= 180):
        analysis["issues"].append({"field": "lat/lon", "kind": "out_of_bounds",
            "message": "坐标越界 (lat=%s, lon=%s)，超出合法经纬度范围" % (lat, lon)})
    vf = analysis["fields"]["valid_from"]["value"]
    vt = analysis["fields"]["valid_to"]["value"]
    if vf and vt and parse_time(vf) > parse_time(vt):
        analysis["issues"].append({"field": "validity", "kind": "inverted",
            "message": "有效期起点晚于终点，区间自相矛盾"})
    oob = any(i["kind"] == "out_of_bounds" for i in analysis["issues"])
    analysis["trusted_coords"] = lat_ok and lon_ok and not oob
    analysis["has_conflict"] = any(i["kind"] == "conflict" for i in analysis["issues"])
    return analysis


# ---------------- 范围形状 ----------------

def shape_reference_point(shape):
    if shape["type"] == "circle":
        return shape["cx"], shape["cy"]
    return ((shape["minx"] + shape["maxx"]) / 2.0, (shape["miny"] + shape["maxy"]) / 2.0)


def point_in_shape(x, y, shape):
    """返回 (inside, on_boundary, distance_to_reference)。"""
    if shape["type"] == "circle":
        dist = math.hypot(x - shape["cx"], y - shape["cy"])
        r = shape["radius"]
        on_boundary = abs(dist - r) <= BOUNDARY_EPS
        return dist <= r + BOUNDARY_EPS, on_boundary, dist
    minx, maxx = sorted([shape["minx"], shape["maxx"]])
    miny, maxy = sorted([shape["miny"], shape["maxy"]])
    inside = (minx - BOUNDARY_EPS <= x <= maxx + BOUNDARY_EPS and
              miny - BOUNDARY_EPS <= y <= maxy + BOUNDARY_EPS)
    on_boundary = inside and any(abs(v - e) <= BOUNDARY_EPS for v, e in
                                 ((x, minx), (x, maxx), (y, miny), (y, maxy)))
    refx, refy = (minx + maxx) / 2.0, (miny + maxy) / 2.0
    return inside, on_boundary, math.hypot(x - refx, y - refy)


def _bbox(s):
    if s["type"] == "circle":
        return (s["cx"] - s["radius"], s["cy"] - s["radius"],
                s["cx"] + s["radius"], s["cy"] + s["radius"])
    return (min(s["minx"], s["maxx"]), min(s["miny"], s["maxy"]),
            max(s["minx"], s["maxx"]), max(s["miny"], s["maxy"]))


def shapes_overlap(a, b):
    ax1, ay1, ax2, ay2 = _bbox(a)
    bx1, by1, bx2, by2 = _bbox(b)
    if ax2 < bx1 or bx2 < ax1 or ay2 < by1 or by2 < ay1:
        return False
    if a["type"] == "circle" and b["type"] == "circle":
        return math.hypot(a["cx"] - b["cx"], a["cy"] - b["cy"]) <= a["radius"] + b["radius"] + BOUNDARY_EPS
    if a["type"] == "circle" or b["type"] == "circle":
        c, r = (a, b) if a["type"] == "circle" else (b, a)
        rx1, ry1, rx2, ry2 = _bbox(r)
        nx = min(max(c["cx"], rx1), rx2)
        ny = min(max(c["cy"], ry1), ry2)
        return math.hypot(c["cx"] - nx, c["cy"] - ny) <= c["radius"] + BOUNDARY_EPS
    return True


# ---------------- 单对象决策 ----------------

def decide_object(obj, analysis, query):
    """对单个对象给出针对某查找的决策：hit / excluded / undecidable，附依据。"""
    reasons, flags = [], []
    active = [c for c in obj["claims"] if not c["retracted"]]
    if not active:
        return {"bucket": "excluded", "flags": ["retracted"],
                "reasons": ["全部来源已撤回，对象不再参与推演"]}
    f = analysis["fields"]
    cats = (query.get("filters") or {}).get("categories") or []
    if cats:
        st = f["category"]["status"]
        if st == "conflict":
            return {"bucket": "undecidable", "flags": ["category_conflict"],
                    "reasons": ["类别来源互相矛盾，与过滤条件 %s 冲突，待裁决后才能判定" % cats]}
        if st == "missing":
            return {"bucket": "undecidable", "flags": ["category_missing"],
                    "reasons": ["类别缺失，无法与过滤条件 %s 匹配" % cats]}
        if f["category"]["value"] not in cats:
            return {"bucket": "excluded", "flags": [],
                    "reasons": ["类别 '%s' 不在过滤范围 %s 内" % (f["category"]["value"], cats)]}
        reasons.append("类别 '%s' 匹配过滤条件" % f["category"]["value"])
    active_at = (query.get("filters") or {}).get("active_at")
    if active_at:
        if "conflict" in (f["valid_from"]["status"], f["valid_to"]["status"]):
            return {"bucket": "undecidable", "flags": ["validity_conflict"],
                    "reasons": ["有效期来源互相矛盾，无法判定在 %s 是否有效" % active_at]}
        vf, vt = f["valid_from"]["value"], f["valid_to"]["value"]
        t = parse_time(active_at)
        if vf and t < parse_time(vf):
            return {"bucket": "excluded", "flags": [],
                    "reasons": ["%s 尚未生效（生效起点 %s）" % (active_at, vf)]}
        if vt and t > parse_time(vt):
            return {"bucket": "excluded", "flags": [],
                    "reasons": ["%s 已过有效期（终点 %s）" % (active_at, vt)]}
        reasons.append("在有效期 [%s, %s] 内" % (vf or "-∞", vt or "+∞"))
    if not analysis["trusted_coords"]:
        msgs = [i["message"] for i in analysis["issues"] if i["field"] in ("lat", "lon", "lat/lon")]
        return {"bucket": "undecidable", "flags": ["coords_untrusted"],
                "reasons": (msgs or ["坐标不可信"]) + ["坐标不可信的对象不参与邻近排序"]}
    x, y = f["lon"]["value"], f["lat"]["value"]
    inside, on_boundary, dist = point_in_shape(x, y, query["shape"])
    if not inside:
        return {"bucket": "excluded", "flags": [], "distance": dist,
                "reasons": reasons + ["位于范围外（距参考点 %.4f）" % dist]}
    if on_boundary:
        flags.append("on_boundary")
        reasons.append("恰好落在范围边界上（容差 %g），按包含处理并标记歧义" % BOUNDARY_EPS)
    basis = f["lon"].get("basis") or {}
    if basis.get("rationale"):
        reasons.append("坐标采信来源：%s（%s：%s）" % (basis.get("source", "人工录入"),
                       basis.get("by", "裁决"), basis.get("rationale")))
    reasons.append("坐标 (%.6f, %.6f) 落入范围内，距参考点 %.4f" % (x, y, dist))
    return {"bucket": "hit", "reasons": reasons, "flags": flags, "distance": dist}


def _decision_signature(d):
    return {"bucket": d["bucket"], "flags": sorted(d["flags"]),
            "distance": round(d.get("distance") or 0.0, 9)}


def evaluate_query(query, objects, analyses):
    hits, excluded, undecidable = [], [], []
    decisions = {}
    for oid, obj in objects.items():
        d = decide_object(obj, analyses[oid], query)
        decisions[oid] = _decision_signature(d)
        entry = {"object_id": oid, "reasons": d["reasons"], "flags": d["flags"]}
        if d["bucket"] == "hit":
            entry["distance"] = d["distance"]
            hits.append(entry)
        elif d["bucket"] == "excluded":
            excluded.append(entry)
        else:
            undecidable.append(entry)
    hits.sort(key=lambda h: (h["distance"], h["object_id"]))
    ambiguities = []
    for i in range(1, len(hits)):
        if abs(hits[i]["distance"] - hits[i - 1]["distance"]) <= BOUNDARY_EPS:
            ambiguities.append({"kind": "distance_tie",
                "message": "对象 %s 与 %s 距离并列（%.6f），按对象标识稳定排序" % (
                    hits[i - 1]["object_id"], hits[i]["object_id"], hits[i]["distance"])})
    for h in hits:
        if "on_boundary" in h["flags"]:
            ambiguities.append({"kind": "on_boundary",
                "message": "对象 %s 恰好落在范围边界上，判定依据见命中明细" % h["object_id"]})
    return {"query_id": query["query_id"], "hits": hits, "excluded": excluded,
            "undecidable": undecidable, "ambiguities": ambiguities,
            "decisions": decisions,
            "evaluated_at": datetime.now().isoformat(timespec="seconds")}


def _result_signature(result):
    r = {k: result[k] for k in ("hits", "excluded", "undecidable", "ambiguities", "decisions")}
    return json.dumps(r, sort_keys=True, ensure_ascii=False)


class Engine:
    def __init__(self):
        self.objects = {}   # object_id -> {"object_id", "claims": [], "adjudications": {}}
        self.queries = {}   # query_id -> query
        self.results = {}   # query_id -> 评估结果
        self.log = []

    def _log(self, message):
        self.log.append({"time": datetime.now().isoformat(timespec="seconds"), "message": message})

    def analyses(self):
        return {oid: analyze_object(o) for oid, o in self.objects.items()}

    # ---- 导入与整体重推 ----
    def import_data(self, objects=None, queries=None, mode="merge"):
        if mode == "replace":
            self.objects, self.queries, self.results = {}, {}, {}
        for o in objects or []:
            oid = o["object_id"]
            obj = self.objects.setdefault(oid, {"object_id": oid, "claims": [], "adjudications": {}})
            for c in o.get("claims", []):
                obj["claims"].append(make_claim(oid, **c))
            for k, v in (o.get("adjudications") or {}).items():
                obj["adjudications"][k] = v
        for q in queries or []:
            nq = self._norm_query(q)
            self.queries[nq["query_id"]] = nq
        self.recompute_all()
        self._log("导入完成：对象 %d 个，查找 %d 个（模式 %s）"
                  % (len(objects or []), len(queries or []), mode))

    def _norm_query(self, q):
        q = dict(q)
        q.setdefault("query_id", new_id("qry"))
        q.setdefault("name", q["query_id"])
        q.setdefault("filters", {})
        q.setdefault("expected_basis", "")
        return q

    def recompute_all(self):
        analyses = self.analyses()
        self.results = {qid: evaluate_query(q, self.objects, analyses)
                        for qid, q in self.queries.items()}

    # ---- 增量更新：只重推结论实际受影响的查找 ----
    def _propagate(self, object_id):
        analyses = self.analyses()
        affected = []
        for qid, query in self.queries.items():
            old = self.results.get(qid)
            old_dec = old["decisions"].get(object_id) if old else None
            new_dec = _decision_signature(decide_object(self.objects[object_id],
                                                        analyses[object_id], query))
            if old is None or old_dec != new_dec:
                self.results[qid] = evaluate_query(query, self.objects, analyses)
                affected.append(qid)
        return affected

    def add_claim(self, object_id, **kwargs):
        obj = self.objects.setdefault(object_id, {"object_id": object_id, "claims": [], "adjudications": {}})
        claim = make_claim(object_id, **kwargs)
        obj["claims"].append(claim)
        affected = self._propagate(object_id)
        self._log("对象 %s 新增来源「%s」，受影响查找：%s"
                  % (object_id, claim["source"], "、".join(affected) or "无"))
        return claim, affected

    def retract_claim(self, claim_id):
        for oid, obj in self.objects.items():
            for c in obj["claims"]:
                if c["claim_id"] == claim_id and not c["retracted"]:
                    c["retracted"] = True
                    affected = self._propagate(oid)
                    self._log("来源 %s（%s）已撤回，受影响查找：%s"
                              % (claim_id, c["source"], "、".join(affected) or "无"))
                    return affected
        raise KeyError("未找到来源 %s" % claim_id)

    def adjudicate(self, object_id, field, rationale, by="人工裁决", claim_id=None, value=None):
        if field not in FIELDS:
            raise ValueError("未知字段 %s" % field)
        obj = self.objects[object_id]
        obj["adjudications"][field] = {
            "claim_id": claim_id, "value": value, "rationale": rationale,
            "by": by, "time": datetime.now().isoformat(timespec="seconds")}
        affected = self._propagate(object_id)
        self._log("对象 %s 字段 %s 经%s裁决（%s），受影响查找：%s"
                  % (object_id, field, by, rationale, "、".join(affected) or "无"))
        return affected

    def upsert_query(self, q):
        q = self._norm_query(q)
        self.queries[q["query_id"]] = q
        self.results[q["query_id"]] = evaluate_query(q, self.objects, self.analyses())
        self._log("查找 %s（%s）已保存并重推" % (q["query_id"], q.get("name", "")))
        return q["query_id"]

    def delete_query(self, query_id):
        self.queries.pop(query_id, None)
        self.results.pop(query_id, None)
        self._log("查找 %s 已删除" % query_id)

    # ---- 一致性校验：增量结果必须与整体重推一致 ----
    def consistency_check(self):
        analyses = self.analyses()
        mismatched = []
        for qid, q in self.queries.items():
            full = evaluate_query(q, self.objects, analyses)
            cur = self.results.get(qid)
            if cur is None or _result_signature(full) != _result_signature(cur):
                mismatched.append(qid)
        orphan = [qid for qid in self.results if qid not in self.queries]
        return {"consistent": not mismatched and not orphan,
                "mismatched": mismatched, "orphan_results": orphan}

    def overlap_report(self):
        report = []
        qlist = list(self.queries.values())
        for i in range(len(qlist)):
            for j in range(i + 1, len(qlist)):
                a, b = qlist[i], qlist[j]
                if shapes_overlap(a["shape"], b["shape"]):
                    ha = {h["object_id"] for h in self.results.get(a["query_id"], {}).get("hits", [])}
                    hb = {h["object_id"] for h in self.results.get(b["query_id"], {}).get("hits", [])}
                    report.append({"queries": [a["query_id"], b["query_id"]],
                        "message": "范围重叠：%s 与 %s" % (a.get("name"), b.get("name")),
                        "shared_hits": sorted(ha & hb)})
        return report

    def state(self):
        analyses = self.analyses()
        return {
            "objects": [{"object_id": oid, "claims": o["claims"],
                         "adjudications": o["adjudications"], "analysis": analyses[oid]}
                        for oid, o in self.objects.items()],
            "queries": list(self.queries.values()),
            "results": self.results,
            "overlaps": self.overlap_report(),
            "log": self.log[-50:],
        }
