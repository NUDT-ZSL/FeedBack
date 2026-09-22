# -*- coding: utf-8 -*-
"""用户反馈聚类核心引擎。

设计原则：系统的唯一真源是「反馈列表 + 决策日志」。
任何人工修订（移动 / 合并 / 拆分 / 冲突裁决）都会被翻译成
must-link / cannot-link 约束追加到决策日志，随后调用
recompute() 从头全量重算。因此界面展示的结果与全量重算
结果在构造上必然一致，不会残留旧归属或遗漏反馈（需求 4）。
"""
from __future__ import annotations

import itertools
import os

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

MAX_LABEL_LEN = 40
_EMB_MODEL_NAME = os.environ.get("FEEDBACK_EMB_MODEL", "BAAI/bge-small-zh-v1.5")
_emb_model = "unloaded"
_emb_cache = {}


def _get_emb_model():
    """懒加载中文句向量模型；加载失败返回 None，走 TF-IDF 兜底。"""
    global _emb_model
    if _emb_model == "unloaded":
        try:
            from sentence_transformers import SentenceTransformer
            _emb_model = SentenceTransformer(_EMB_MODEL_NAME)
        except Exception:
            _emb_model = None
    return _emb_model


def _embed(texts):
    model = _get_emb_model()
    if model is None:
        return None
    todo = [t for t in dict.fromkeys(texts) if t not in _emb_cache]
    if todo:
        vecs = model.encode(todo, normalize_embeddings=True,
                            show_progress_bar=False)
        for t, v in zip(todo, vecs):
            _emb_cache[t] = np.asarray(v, dtype=np.float64)
    return np.vstack([_emb_cache[t] for t in texts])


def _keyword_vectorizer(texts):
    # 字符 n-gram，用于簇关键词提取与兜底相似度
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 3), min_df=1)
    return vec, vec.fit_transform(texts)


def _keyword_matrix(texts):
    """簇关键词的向量空间：优先 jieba 词级（可读性好），缺失时字符 n-gram。"""
    try:
        import jieba
        seg = [" ".join(jieba.lcut(t)) for t in texts]
        vec = TfidfVectorizer(token_pattern=r"(?u)\b\w\w+\b")
        return vec, vec.fit_transform(seg)
    except Exception:
        return _keyword_vectorizer(texts)


def _similarity(texts):
    """返回 (相似度矩阵, 聚类阈值, 冲突阈值, 后端名)。
    优先句向量，失败时 TF-IDF 兜底。

    阈值自适应：pairwise 相似度均值 + k*标准差，并夹在合理区间，
    避免不同数据集基线相似度差异导致过度合并或过度拆分。
    冲突阈值高于聚类阈值（均值 + 1.5*标准差），只把「明显相似
    却被分开」的反馈对提交人工裁决，避免冲突面板被弱相似对淹没。
    """
    emb = _embed(texts)
    if emb is not None:
        sim = emb @ emb.T
        lo, hi, k = 0.50, 0.80, 0.7
        backend = "embedding"
    else:
        _, mat = _keyword_vectorizer(texts)
        arr = mat.toarray().astype(np.float64)
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        arr = arr / norms
        sim = arr @ arr.T
        lo, hi, k = 0.10, 0.50, 1.0
        backend = "tfidf"
    n = len(texts)
    if n < 2:
        return sim, hi, hi, backend
    off = [sim[i, j] for i in range(n) for j in range(i + 1, n)]
    mu, sd = float(np.mean(off)), float(np.std(off))
    th = min(max(mu + k * sd, lo), hi)
    conflict_th = min(max(mu + 1.5 * sd, th + 0.02), 0.95)
    return sim, th, conflict_th, backend


class _UnionFind:
    def __init__(self, ids):
        self.parent = {i: i for i in ids}

    def find(self, x):
        p = self.parent
        while p[x] != x:
            p[x] = p[p[x]]
            x = p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if rb < ra:
            ra, rb = rb, ra
        self.parent[rb] = ra


def recompute(feedbacks, decisions):
    """从反馈列表 + 决策日志全量重算聚类结果（确定性）。"""
    text_of = {f["id"]: f["text"] for f in feedbacks}
    ids = sorted(text_of)
    if not ids:
        return {"clusters": [], "assignment": {}, "conflicts": [],
                "meta": {"backend": "none", "threshold": None}}

    index = {fid: i for i, fid in enumerate(ids)}
    texts = [text_of[fid] for fid in ids]
    sim, sim_threshold, conflict_threshold, backend = _similarity(texts)
    vec, mat = _keyword_matrix(texts)

    must = [(d["a"], d["b"]) for d in decisions
            if d["type"] == "must_link" and d["a"] in text_of and d["b"] in text_of]
    cannot = {frozenset((d["a"], d["b"])) for d in decisions
              if d["type"] == "cannot_link" and d["a"] in text_of and d["b"] in text_of}

    # 1) must-link 连通组作为初始单元
    uf = _UnionFind(ids)
    for a, b in must:
        uf.union(a, b)
    groups = {}
    for fid in ids:
        groups.setdefault(uf.find(fid), []).append(fid)
    units = sorted((sorted(m) for m in groups.values()), key=lambda m: m[0])

    def blocked(u, v):
        return any(frozenset((a, b)) in cannot for a in u for b in v)

    def linkage(u, v):
        return float(np.mean([sim[index[a], index[b]] for a in u for b in v]))

    # 2) 约束凝聚聚类：每轮合并平均相似度最高且未被 cannot-link 阻断的单元
    while True:
        best, bi, bj = sim_threshold, -1, -1
        for i in range(len(units)):
            for j in range(i + 1, len(units)):
                if blocked(units[i], units[j]):
                    continue
                s = linkage(units[i], units[j])
                if s > best:
                    best, bi, bj = s, i, j
        if bi < 0:
            break
        units[bi] = sorted(units[bi] + units[bj])
        del units[bj]

    units.sort(key=lambda m: m[0])

    # 3) 生成簇描述：medoid 代表句 + 质心高权重 n-gram 关键词
    feature_names = np.array(vec.get_feature_names_out())
    clusters, assignment = [], {}
    for n, members in enumerate(units, start=1):
        cid = "C%d" % n
        for m in members:
            assignment[m] = cid
        mi = [index[m] for m in members]
        medoid = members[int(np.argmax(sim[np.ix_(mi, mi)].mean(axis=1)))] \
            if len(members) > 1 else members[0]
        centroid = np.asarray(mat[mi].mean(axis=0)).ravel()
        top = centroid.argsort()[::-1]
        keywords = [feature_names[t] for t in top if centroid[t] > 0][:5]
        label = text_of[medoid]
        if len(label) > MAX_LABEL_LEN:
            label = label[:MAX_LABEL_LEN] + "…"
        clusters.append({
            "id": cid, "size": len(members), "member_ids": members,
            "label": label, "keywords": keywords,
        })

    # 4) 冲突检测：相似度达阈值却分属不同簇、且尚无裁决记录的反馈对
    conflicts = []
    for a, b in itertools.combinations(ids, 2):
        if assignment[a] == assignment[b] or frozenset((a, b)) in cannot:
            continue
        s = float(sim[index[a], index[b]])
        if s >= conflict_threshold:
            conflicts.append({
                "a": a, "b": b, "text_a": text_of[a], "text_b": text_of[b],
                "cluster_a": assignment[a], "cluster_b": assignment[b],
                "similarity": round(s, 4),
            })
    conflicts.sort(key=lambda c: (-c["similarity"], c["a"], c["b"]))
    return {"clusters": clusters, "assignment": assignment,
            "conflicts": conflicts,
            "meta": {"backend": backend,
                     "threshold": round(float(sim_threshold), 4),
                     "conflict_threshold": round(float(conflict_threshold), 4)}}


def build_leads(clusters):
    """由最终聚类结果生成需求线索列表，按簇规模降序（需求 6）。"""
    leads = []
    ordered = sorted(clusters, key=lambda c: (-c["size"], c["id"]))
    for i, c in enumerate(ordered, start=1):
        leads.append({
            "lead_id": "L%d" % i,
            "cluster_id": c["id"],
            "title": c["label"],
            "keywords": c["keywords"],
            "size": c["size"],
            "feedback_ids": c["member_ids"],
        })
    return leads


# ---------- 人工操作 -> 约束决策 的翻译 ----------

def _cluster_of(result, cluster_id):
    return next(c for c in result["clusters"] if c["id"] == cluster_id)


def _rep(cluster):
    """簇代表元：取最小 id，保证确定性。"""
    return min(cluster["member_ids"])


def decisions_for_move(result, feedback_id, target_cluster_id):
    """移动反馈到目标簇（target_cluster_id 为 "new" 表示移出成新簇）。"""
    out = []
    cur = result["assignment"].get(feedback_id)
    if cur:
        for m in _cluster_of(result, cur)["member_ids"]:
            if m != feedback_id:
                out.append(("cannot_link", feedback_id, m))
    if target_cluster_id and target_cluster_id != "new":
        tgt = _cluster_of(result, target_cluster_id)
        out.append(("must_link", feedback_id, _rep(tgt)))
    return out


def decisions_for_merge(result, cluster_a, cluster_b):
    ca, cb = _cluster_of(result, cluster_a), _cluster_of(result, cluster_b)
    return [("must_link", _rep(ca), _rep(cb))]


def decisions_for_split(result, cluster_id, subset_ids):
    """把簇内指定子集拆出为新簇。"""
    members = _cluster_of(result, cluster_id)["member_ids"]
    picked = set(subset_ids)
    subset = [m for m in members if m in picked]
    rest = [m for m in members if m not in picked]
    out = [("cannot_link", s, r) for s in subset for r in rest]
    for s in subset[1:]:
        out.append(("must_link", subset[0], s))
    return out
