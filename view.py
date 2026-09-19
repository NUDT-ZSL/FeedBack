"""Build the full UI-facing state: groups with members, representative
description, similarity evidence and boundary-pair warnings."""
from clustering import describe_cluster


def build_state(store):
    groups, auto, vs, idx, ids, texts = store.compute_groups()
    member_set = [set(g) for g in groups]
    gid_of = {}
    for n, g in enumerate(groups):
        for m in g:
            gid_of[m] = n

    out_groups = []
    for n, members in enumerate(groups):
        desc = describe_cluster(members, vs, idx, texts)
        # pairwise evidence inside the group (top-5 strongest pairs)
        pairs = []
        for a_i in range(len(members)):
            for b_i in range(a_i + 1, len(members)):
                a, b = members[a_i], members[b_i]
                pairs.append({
                    "a": a, "b": b,
                    "similarity": round(vs.similarity(idx[a], idx[b]), 4),
                    "common_terms": vs.common_terms(idx[a], idx[b]),
                })
        pairs.sort(key=lambda p: (-p["similarity"], p["a"], p["b"]))
        # auto merge history relevant to this group
        merges = [m for m in auto["merge_log"]
                  if all(x in member_set[n] for part in m["merged"]
                         for x in part)]
        pinned = [m for m in members if m in store.pins]
        out_groups.append({
            "gid": n,
            "members": [store.items[m] for m in members],
            "representative": desc["representative"],
            "keywords": desc["keywords"],
            "evidence": {
                "top_pairs": pairs[:5],
                "merge_log": merges,
                "manually_pinned": sorted(pinned),
            },
        })

    # boundary pairs mapped onto final groups
    boundary = []
    for bp in auto["boundary_pairs"]:
        ga = gid_of.get(bp["a"][0])
        gb = gid_of.get(bp["b"][0])
        if ga is None or gb is None or ga == gb:
            continue
        boundary.append({
            "group_a": ga, "group_b": gb,
            "similarity": bp["similarity"],
            "threshold": bp["threshold"],
            "evidence": bp["evidence"],
            "note": "相似度 %.3f 接近阈值 %.2f，归并判定处于边界，"
                    "已保留依据供人工确认" % (bp["similarity"],
                                              bp["threshold"]),
        })

    return {
        "threshold": store.threshold,
        "item_count": len(store.items),
        "groups": out_groups,
        "boundary_pairs": boundary,
        "ops": store.ops[-50:],
    }
