"""Deterministic constrained clustering.

Pipeline (fully deterministic, order-independent):
1. Compute pairwise cosine similarities on TF-IDF vectors.
2. Apply must-link constraints (union first).
3. Greedily merge remaining pairs sorted by (-similarity, idA, idB),
   skipping merges that would violate a cannot-link constraint.
4. Record evidence for every pair inside the borderline band around
   the threshold, so near-boundary decisions stay inspectable and
   stable instead of jumping when the threshold shifts slightly.

Manual operations (move / merge / split) are stored as must-link and
cannot-link constraint *sets*, and the visible grouping is always the
output of this recompute. Replaying the same constraint set in any
order yields the same grouping.
"""
from __future__ import annotations

from . import similarity
from .models import Cluster, Evidence

DEFAULT_THRESHOLD = 0.10
DEFAULT_BAND = 0.05


def _pair_key(a: str, b: str):
    return (a, b) if a < b else (b, a)


class _UnionFind:
    def __init__(self, ids):
        self.parent = {i: i for i in ids}

    def find(self, x):
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        # Deterministic: smaller id always becomes the root.
        if rb < ra:
            ra, rb = rb, ra
        self.parent[rb] = ra
        return True


def cluster_feedback(feedbacks, threshold=DEFAULT_THRESHOLD, band=DEFAULT_BAND,
                     must_link=None, cannot_link=None):
    """Return (clusters, evidence) for the given feedback list.

    must_link / cannot_link: iterables of (idA, idB) pairs.
    """
    must = set()
    for a, b in (must_link or []):
        if a != b:
            must.add(_pair_key(a, b))
    cannot = set()
    for a, b in (cannot_link or []):
        if a != b:
            cannot.add(_pair_key(a, b))
    # Cannot-link always wins over must-link (deterministic precedence).
    must -= cannot

    items = sorted(feedbacks, key=lambda f: f.id)
    ids = [f.id for f in items]
    id_set = set(ids)
    texts = [f.text for f in items]
    vectors = similarity.build_vectors(texts)
    vec_by_id = dict(zip(ids, vectors))

    sims = {}
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            sims[(ids[i], ids[j])] = similarity.cosine(vectors[i], vectors[j])

    uf = _UnionFind(ids)
    evidence = []

    def blocked(group_a, group_b):
        for x in group_a:
            for y in group_b:
                if _pair_key(x, y) in cannot:
                    return True
        return False

    def members():
        groups = {}
        for i in ids:
            groups.setdefault(uf.find(i), []).append(i)
        return groups

    # 1) must-link first, honoring cannot-link between components.
    for a, b in sorted(must):
        if a not in id_set or b not in id_set:
            continue
        groups = members()
        ga = groups.get(uf.find(a), [a])
        gb = groups.get(uf.find(b), [b])
        if not blocked(ga, gb):
            uf.union(a, b)

    # 2) similarity-driven merges in a fixed deterministic order.
    order = sorted(sims.items(), key=lambda kv: (-kv[1], kv[0][0], kv[0][1]))
    for (a, b), sim in order:
        if sim < threshold:
            continue
        if _pair_key(a, b) in cannot:
            continue
        if uf.find(a) == uf.find(b):
            continue
        groups = members()
        if blocked(groups[uf.find(a)], groups[uf.find(b)]):
            continue
        uf.union(a, b)

    groups = members()

    # 3) evidence for borderline pairs and constraint-driven decisions.
    lo, hi = threshold - band, threshold + band
    for (a, b), sim in sorted(sims.items()):
        key = (a, b)
        in_band = lo <= sim <= hi
        forced = key in must
        banned = key in cannot
        if not (in_band or forced or banned):
            continue
        merged = uf.find(a) == uf.find(b)
        if banned:
            reason = "cannot_link"
        elif forced:
            reason = "must_link"
        elif sim >= threshold:
            reason = "auto"
        else:
            reason = "below_threshold"
        evidence.append(Evidence(
            a=a, b=b, similarity=round(sim, 4),
            decision="merged" if merged else "kept_separate",
            reason=reason,
            shared_terms=similarity.shared_terms(vec_by_id[a], vec_by_id[b]),
            borderline=in_band and not (forced or banned),
        ))

    clusters = []
    for root in sorted(groups):
        member_ids = sorted(groups[root])
        clusters.append(_build_cluster(member_ids, items, vec_by_id, sims))
    return clusters, evidence


def _build_cluster(member_ids, items, vec_by_id, sims) -> Cluster:
    """Representative = medoid; label from strongest shared terms."""
    text_by_id = {f.id: f.text for f in items}

    def sim(a, b):
        if a == b:
            return 1.0
        return sims.get(_pair_key(a, b), 0.0)

    best, best_score = member_ids[0], -1.0
    for cand in member_ids:
        score = sum(sim(cand, other) for other in member_ids) / len(member_ids)
        if score > best_score or (score == best_score and cand < best):
            best, best_score = cand, score

    # Cluster-level top terms: highest summed TF-IDF weight across members.
    totals = {}
    for mid in member_ids:
        for tok, w in vec_by_id[mid].items():
            totals[tok] = totals.get(tok, 0.0) + w
    ranked = sorted(totals.items(), key=lambda kv: (-kv[1], kv[0]))
    top_terms = []
    for tok, _ in ranked:
        readable = tok[2:] if tok[:2] in ("c:", "w:") else tok
        if readable not in top_terms:
            top_terms.append(readable)
        if len(top_terms) >= 8:
            break

    rep_text = text_by_id.get(best, "").strip()
    label = rep_text if len(rep_text) <= 40 else rep_text[:40] + "..."
    return Cluster(
        id="cl_" + best,
        member_ids=member_ids,
        label=label or "(empty)",
        representative_id=best,
        top_terms=top_terms,
    )
