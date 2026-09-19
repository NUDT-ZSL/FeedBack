"""Deterministic agglomerative clustering over a VectorSpace.

Properties:
- Average-linkage agglomerative merging with a similarity threshold.
- Fully deterministic: ties are broken by sorted item ids, so the same
  input always yields the same grouping regardless of insertion order.
- The full merge log is retained, and pairs of clusters whose
  similarity falls inside a "boundary band" just below the threshold
  are recorded with their evidence. This keeps borderline decisions
  explainable and prevents tiny threshold changes from silently
  flipping groups: the near-boundary pairs are always surfaced.
"""
from similarity import VectorSpace

BOUNDARY_BAND = 0.05  # similarities within this band below threshold


def _cluster_similarity(members_a, members_b, vs, id_to_idx):
    sims = [vs.similarity(id_to_idx[a], id_to_idx[b])
            for a in members_a for b in members_b]
    return sum(sims) / len(sims) if sims else 0.0


def cluster_items(item_ids, texts, threshold=0.35):
    """Cluster items deterministically.

    item_ids: list of stable string ids; texts: parallel list of text.
    Returns dict with clusters, merge_log and boundary_pairs.
    """
    vs = VectorSpace(texts)
    id_to_idx = {iid: i for i, iid in enumerate(item_ids)}
    # clusters: list of sorted tuples of item ids
    clusters = [(iid,) for iid in sorted(item_ids)]
    merge_log = []

    while True:
        best = None  # (sim, key, i, j)
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                sim = _cluster_similarity(clusters[i], clusters[j],
                                          vs, id_to_idx)
                key = (clusters[i][0], clusters[j][0])
                if best is None or (round(sim, 12), key) > \
                        (round(best[0], 12), best[1]):
                    # deterministic tie-break: higher sim, then the
                    # lexicographically smaller id pair wins
                    if best is None or sim > best[0] + 1e-12 or \
                            (abs(sim - best[0]) <= 1e-12 and key < best[1]):
                        best = (sim, key, i, j)
        if best is None or best[0] < threshold:
            break
        sim, _, i, j = best
        merged = tuple(sorted(clusters[i] + clusters[j]))
        merge_log.append({
            "merged": [list(clusters[i]), list(clusters[j])],
            "similarity": round(sim, 4),
            "evidence": vs.common_terms(id_to_idx[clusters[i][0]],
                                        id_to_idx[clusters[j][0]]),
        })
        clusters = [c for k, c in enumerate(clusters) if k not in (i, j)]
        clusters.append(merged)
        clusters.sort()

    clusters.sort()

    # Boundary pairs: final cluster pairs whose similarity lies in
    # [threshold - BAND, threshold + BAND). Kept as stable evidence so
    # borderline decisions never depend on silent threshold jitter.
    boundary = []
    lo = threshold - BOUNDARY_BAND
    for i in range(len(clusters)):
        for j in range(i + 1, len(clusters)):
            sim = _cluster_similarity(clusters[i], clusters[j],
                                      vs, id_to_idx)
            if lo <= sim < threshold + BOUNDARY_BAND:
                boundary.append({
                    "a": list(clusters[i]),
                    "b": list(clusters[j]),
                    "similarity": round(sim, 4),
                    "threshold": threshold,
                    "merged": sim >= threshold,
                    "evidence": vs.common_terms(id_to_idx[clusters[i][0]],
                                                id_to_idx[clusters[j][0]]),
                })
    boundary.sort(key=lambda p: (-p["similarity"], p["a"], p["b"]))

    return {"clusters": [list(c) for c in clusters],
            "merge_log": merge_log,
            "boundary_pairs": boundary,
            "vs": vs, "id_to_idx": id_to_idx}


def describe_cluster(members, vs, id_to_idx, texts):
    """Representative description: medoid text + top keywords."""
    idxs = [id_to_idx[m] for m in members]
    best, best_score = idxs[0], -1.0
    for i in idxs:
        score = sum(vs.similarity(i, j) for j in idxs if j != i)
        if score > best_score + 1e-12 or \
                (abs(score - best_score) <= 1e-12 and
                 texts[i] < texts[best]):
            best, best_score = i, score
    return {"representative": texts[best],
            "keywords": vs.keywords(idxs)}
