"""同源异常聚类：按园区 + 指标类型分组，把同一时段的异常聚成簇并给出贡献占比。"""
from __future__ import annotations

from collections import defaultdict

from .models import Cluster


def find_clusters(system, window: int) -> list[Cluster]:
    """把同一园区、同一指标类型、时间间距不超过 window 的异常聚成一簇。

    只有包含至少两个不同来源的簇才判定为“可能同源”。贡献占比按各来源在簇内
    异常的严重度（超出限值的倍数）之和归一化。
    """
    groups = defaultdict(list)  # (park, metric_type) -> [Anomaly]
    for sid, st in system._sources.items():
        for a in st.anomalies:
            groups[(st.park, st.metric_type)].append(a)

    clusters = []
    for (park, metric), items in groups.items():
        items.sort(key=lambda a: a.time)
        episode = []
        for a in items:
            if episode and a.time - episode[-1].time > window:
                clusters.extend(_emit(park, metric, episode))
                episode = []
            episode.append(a)
        clusters.extend(_emit(park, metric, episode))
    return clusters


def _emit(park, metric, episode) -> list[Cluster]:
    sources = {a.source_id for a in episode}
    if len(sources) < 2:
        return []
    severity = defaultdict(float)
    for a in episode:
        severity[a.source_id] += a.severity
    total = sum(severity.values())
    contributions = {sid: severity[sid] / total for sid in sorted(severity)}
    return [Cluster(
        park=park,
        metric_type=metric,
        start=min(a.time for a in episode),
        end=max(a.time for a in episode),
        contributions=contributions,
        anomaly_count=len(episode),
    )]
