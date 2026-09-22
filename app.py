# -*- coding: utf-8 -*-
"""
用户反馈聚类与需求线索生成系统
流程: 导入 -> 自动聚类 -> 人工修订 -> 生成需求线索
一致性保证: 聚类结果不作为独立可变状态保存, 每次操作后都由
(反馈全集 + 人工约束) 从头全量重算, 因此不存在残留旧归属或遗漏。
"""
import json
import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")   # 避免 torch OMP 冲突

import re
import time
from collections import defaultdict

import numpy as np
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static")

SIM_THRESHOLD = 0.60          # 语义相似度判定"相近"的阈值

# 语义向量模型(本地缓存的 BAAI/bge-small-zh-v1.5); 加载失败时回退 TF-IDF
_MODEL = None
_MODEL_TRIED = False


def get_model():
    global _MODEL, _MODEL_TRIED
    if not _MODEL_TRIED:
        _MODEL_TRIED = True
        try:
            from sentence_transformers import SentenceTransformer
            _MODEL = SentenceTransformer("BAAI/bge-small-zh-v1.5")
            print("[init] 语义向量模型加载成功")
        except Exception as e:
            print("[init] 向量模型不可用, 回退 TF-IDF:", e)
    return _MODEL
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")

# ---------------------------------------------------------------------------
# 全局状态(唯一事实来源): 反馈列表 + 人工约束 + 决策日志
# 聚类结果永远由 recluster() 现算, 不持久化, 从根本上保证一致性(需求4)
# ---------------------------------------------------------------------------
STATE = {
    "feedbacks": [],          # [{"id": int, "text": str}]
    "must_link": [],          # [[a, b], ...] 必须同簇(人工合并/移入/冲突决策)
    "cannot_link": [],        # [[a, b], ...] 必须不同簇(移出/拆分/冲突决策)
    "decisions": [],          # 决策日志
    "next_id": 1,
}


def _pair(a, b):
    return (min(a, b), max(a, b))


def log_decision(kind, detail):
    STATE["decisions"].append({
        "time": time.strftime("%H:%M:%S"),
        "kind": kind,
        "detail": detail,
    })


def add_constraint(bucket, a, b):
    p = [min(a, b), max(a, b)]
    other = "cannot_link" if bucket == "must_link" else "must_link"
    if p in STATE[other]:
        STATE[other].remove(p)          # 新决策覆盖旧决策
    if p not in STATE[bucket] and a != b:
        STATE[bucket].append(p)


# ---------------------------------------------------------------------------
# 文本相似度: 字符级 + 词级 TF-IDF, 余弦相似度(对中文短文本较稳健)
# ---------------------------------------------------------------------------
def tokenize(text):
    text = text.lower()
    words = re.findall(r"[a-z0-9]+", text)
    chars = [c for c in text if not c.isspace()]
    bigrams = ["".join(chars[i:i + 2]) for i in range(len(chars) - 1)]
    return words + bigrams + chars


def build_vectors(texts):
    docs = [tokenize(t) for t in texts]
    df = defaultdict(int)
    for d in docs:
        for tok in set(d):
            df[tok] += 1
    n = len(docs)
    vecs = []
    for d in docs:
        tf = defaultdict(float)
        for tok in d:
            tf[tok] += 1.0
        v = {}
        for tok, c in tf.items():
            idf = np.log((1 + n) / (1 + df[tok])) + 1.0
            v[tok] = (c / max(1, len(d))) * idf
        vecs.append(v)
    return vecs


def cosine(v1, v2):
    if len(v1) > len(v2):
        v1, v2 = v2, v1
    dot = sum(w * v2.get(k, 0.0) for k, w in v1.items())
    n1 = np.sqrt(sum(w * w for w in v1.values()))
    n2 = np.sqrt(sum(w * w for w in v2.values()))
    if n1 == 0 or n2 == 0:
        return 0.0
    return dot / (n1 * n2)


def similarity_matrix(ids):
    text_of = {f["id"]: f["text"] for f in STATE["feedbacks"]}
    texts = [text_of[i] for i in ids]
    model = get_model()
    if model is not None:
        emb = model.encode(texts, normalize_embeddings=True)
        sim = np.asarray(emb @ emb.T, dtype=float)
        np.fill_diagonal(sim, 1.0)
        return sim, None
    vecs = build_vectors(texts)
    n = len(ids)
    sim = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            sim[i][j] = sim[j][i] = cosine(vecs[i], vecs[j])
    return sim, vecs


# ---------------------------------------------------------------------------
# 全量重算: 相似度边 + must-link 边, 再按 cannot-link 分裂, 连通分量即簇
# ---------------------------------------------------------------------------
def recluster():
    ids = [f["id"] for f in STATE["feedbacks"]]
    if not ids:
        return [], [], sim_empty()
    sim, vecs = similarity_matrix(ids)
    idx = {fid: k for k, fid in enumerate(ids)}
    cannot = {tuple(p) for p in STATE["cannot_link"]
              if p[0] in idx and p[1] in idx}

    parent = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    # 1) 自动聚类: 层次聚类(average linkage), cannot-link 对先置为不相似
    masked = sim.copy()
    for a, b in cannot:
        masked[idx[a]][idx[b]] = masked[idx[b]][idx[a]] = 0.0
    labels = agglomerative(masked)
    for k, fid in enumerate(ids):
        for k2 in range(k + 1, len(ids)):
            if labels[k] == labels[k2]:
                union(fid, ids[k2])
    # 2) must-link 约束(人工合并/移入, 优先级最高)
    for a, b in STATE["must_link"]:
        if a in idx and b in idx:
            union(a, b)

    groups = defaultdict(list)
    for i in ids:
        groups[find(i)].append(i)

    # 3) cannot-link 分裂: 若同一连通分量内存在必须分开的对, 做约束传播拆分
    clusters = []
    for members in groups.values():
        clusters.extend(split_by_cannot(members, cannot))

    # 4) 生成每簇代表描述(medoid: 与簇内成员平均相似度最高的反馈)
    result = []
    for members in clusters:
        rep = medoid(members, ids, sim, idx)
        result.append({"members": sorted(members), "rep": rep})
    result.sort(key=lambda c: -len(c["members"]))

    conflicts = detect_conflicts(result, ids, sim, idx, cannot)
    return result, conflicts, (sim, ids, idx)


def sim_empty():
    return (np.zeros((0, 0)), [], {})


def agglomerative(sim):
    """average-linkage 层次聚类; sklearn 不可用时退化为阈值连通分量。"""
    n = sim.shape[0]
    try:
        from sklearn.cluster import AgglomerativeClustering
        dist = np.clip(1.0 - sim, 0.0, 2.0)
        return AgglomerativeClustering(
            n_clusters=None, metric="precomputed", linkage="average",
            distance_threshold=1.0 - SIM_THRESHOLD).fit_predict(dist)
    except Exception:
        labels = list(range(n))
        for i in range(n):
            for j in range(i + 1, n):
                if sim[i][j] >= SIM_THRESHOLD:
                    labels[j] = labels[i]
        return labels


def split_by_cannot(members, cannot):
    """在同一连通分量内, 按 cannot-link 约束做图着色式拆分, 保证约束被满足。"""
    if len(members) <= 1:
        return [members]
    bins = []           # 每个 bin 是一个列表, bin 内任意两者无 cannot-link
    for m in members:
        placed = False
        for b in bins:
            if all(_pair(m, x) not in cannot for x in b):
                b.append(m)
                placed = True
                break
        if not placed:
            bins.append([m])
    return bins


def medoid(members, ids, sim, idx):
    if len(members) == 1:
        return members[0]
    best, best_score = members[0], -1.0
    for m in members:
        score = sum(sim[idx[m]][idx[o]] for o in members if o != m)
        if score > best_score:
            best, best_score = m, score
    return best


def detect_conflicts(clusters, ids, sim, idx, cannot):
    """相似度达阈值却被分在不同簇、且尚无人工 cannot-link 决策的反馈对。"""
    cluster_of = {}
    for ci, c in enumerate(clusters):
        for m in c["members"]:
            cluster_of[m] = ci
    conflicts = []
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            if (sim[i][j] >= SIM_THRESHOLD
                    and cluster_of.get(a) != cluster_of.get(b)
                    and _pair(a, b) not in cannot):
                conflicts.append({"a": a, "b": b, "sim": round(float(sim[i][j]), 3)})
    conflicts.sort(key=lambda c: -c["sim"])
    return conflicts


def verify_consistency(clusters):
    """校验: 每条反馈恰好归属一个簇(无残留、无遗漏)。"""
    all_ids = sorted(f["id"] for f in STATE["feedbacks"])
    assigned = sorted(m for c in clusters for m in c["members"])
    return assigned == all_ids


# ---------------------------------------------------------------------------
# 视图组装
# ---------------------------------------------------------------------------
def build_state():
    clusters, conflicts, _ = recluster()
    text_of = {f["id"]: f["text"] for f in STATE["feedbacks"]}
    cluster_views = []
    for ci, c in enumerate(clusters):
        members = [{"id": m, "text": text_of[m]} for m in c["members"]]
        cluster_views.append({
            "id": ci,
            "size": len(members),
            "representative": text_of[c["rep"]],
            "members": members,
        })
    # 需求线索: 由最终聚类结果直接派生, 按簇规模降序
    leads = [{
        "cluster_id": c["id"],
        "title": c["representative"][:60],
        "size": c["size"],
        "feedback_ids": [m["id"] for m in c["members"]],
    } for c in cluster_views]
    leads.sort(key=lambda l: (-l["size"], l["cluster_id"]))
    return {
        "feedbacks": STATE["feedbacks"],
        "clusters": cluster_views,
        "conflicts": conflicts,
        "leads": leads,
        "decisions": STATE["decisions"][-50:],
        "consistent": verify_consistency(clusters),
        "threshold": SIM_THRESHOLD,
    }


def save_state():
    try:
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(STATE, f, ensure_ascii=False, indent=1)
    except OSError:
        pass


def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                STATE.update(json.load(f))
        except (OSError, ValueError):
            pass


def cluster_membership():
    clusters, _, _ = recluster()
    m = {}
    for ci, c in enumerate(clusters):
        for fid in c["members"]:
            m[fid] = set(c["members"])
    return m


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/state")
def get_state():
    return jsonify(build_state())


@app.route("/api/import", methods=["POST"])
def import_feedback():
    """支持粘贴文本(text 字段, 每行一条)或上传文件(file)。"""
    raw = ""
    if "file" in request.files:
        raw = request.files["file"].read().decode("utf-8", errors="replace")
    elif request.is_json:
        raw = request.json.get("text", "")
    lines = []
    for line in raw.splitlines():
        line = re.sub(r"^\s*(?:[-*\u2022]|\d+[.、)])\s*", "", line).strip()
        if line:
            lines.append(line)
    for line in lines:
        STATE["feedbacks"].append({"id": STATE["next_id"], "text": line})
        STATE["next_id"] += 1
    log_decision("import", "导入 %d 条反馈" % len(lines))
    save_state()
    return jsonify(build_state())


@app.route("/api/move", methods=["POST"])
def move_feedback():
    """把反馈移入目标簇(或移出为新簇), 通过约束+全量重算生效。"""
    d = request.json
    fid = int(d["feedback_id"])
    target = d["target_cluster_id"]      # int 或 "new"
    membership = cluster_membership()
    old = membership.get(fid, {fid}) - {fid}
    for other in old:                    # 与原簇成员解绑
        add_constraint("cannot_link", fid, other)
    if target != "new":
        clusters, _, _ = recluster()
        for other in clusters[int(target)]["members"]:
            add_constraint("must_link", fid, other)
    log_decision("move", "反馈 #%d 移动到 %s" % (fid, target))
    save_state()
    return jsonify(build_state())


@app.route("/api/merge", methods=["POST"])
def merge_clusters():
    d = request.json
    cids = [int(x) for x in d["cluster_ids"]]
    clusters, _, _ = recluster()
    members = []
    for ci in cids:
        members.extend(clusters[ci]["members"])
    for i in range(len(members)):
        for j in range(i + 1, len(members)):
            add_constraint("must_link", members[i], members[j])
    log_decision("merge", "合并簇 %s (共 %d 条反馈)" % (cids, len(members)))
    save_state()
    return jsonify(build_state())


@app.route("/api/split", methods=["POST"])
def split_cluster():
    """把簇内选中的反馈拆出为新簇。"""
    d = request.json
    cid = int(d["cluster_id"])
    picked = set(int(x) for x in d["feedback_ids"])
    clusters, _, _ = recluster()
    rest = set(clusters[cid]["members"]) - picked
    for a in picked:
        for b in rest:
            add_constraint("cannot_link", a, b)
    pl = sorted(picked)
    for i in range(len(pl)):             # 拆出的成员彼此保持同簇
        for j in range(i + 1, len(pl)):
            add_constraint("must_link", pl[i], pl[j])
    log_decision("split", "从簇 #%d 拆出 %d 条反馈" % (cid, len(picked)))
    save_state()
    return jsonify(build_state())


@app.route("/api/resolve_conflict", methods=["POST"])
def resolve_conflict():
    """冲突决策: action=merge 保留同簇 / separate 保持分开, 均记录日志。"""
    d = request.json
    a, b = int(d["a"]), int(d["b"])
    if d["action"] == "merge":
        add_constraint("must_link", a, b)
        detail = "冲突: 判定 #%d 与 #%d 应同簇" % (a, b)
    else:
        add_constraint("cannot_link", a, b)
        detail = "冲突: 判定 #%d 与 #%d 保持分开" % (a, b)
    log_decision("conflict", detail)
    save_state()
    return jsonify(build_state())


@app.route("/api/reset", methods=["POST"])
def reset():
    STATE["feedbacks"] = []
    STATE["must_link"] = []
    STATE["cannot_link"] = []
    STATE["decisions"] = []
    STATE["next_id"] = 1
    save_state()
    return jsonify(build_state())


if __name__ == "__main__":
    load_state()
    app.run(host="127.0.0.1", port=5050, debug=False)
