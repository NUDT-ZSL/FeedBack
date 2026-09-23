"""运营指标数据清洗与异常区段检测。"""
from __future__ import annotations

import io
import numpy as np
import pandas as pd


def _norm_col(name: str) -> str:
    mapping = {
        "日期": "date", "day": "date", "ds": "date",
        "指标": "metric", "指标名": "metric", "metric_name": "metric", "kpi": "metric",
        "值": "value", "数值": "value", "val": "value",
        "事件编号": "event_id", "id": "event_id",
        "事件类型": "event_type", "type": "event_type", "类别": "event_type",
        "描述": "description", "说明": "description", "desc": "description",
        "结束日期": "end_date", "end": "end_date",
        "方向": "direction", "影响方向": "direction",
    }
    key = str(name).strip().lower()
    return mapping.get(key, key)


def load_metrics(csv_text: str):
    """解析指标 CSV，返回 (DataFrame[date,metric,value], issues)。"""
    df = pd.read_csv(io.StringIO(csv_text))
    df.columns = [_norm_col(c) for c in df.columns]
    required = {"date", "metric", "value"}
    missing_cols = required - set(df.columns)
    if missing_cols:
        raise ValueError("指标数据缺少必要列: " + ", ".join(sorted(missing_cols)))
    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    df["metric"] = df["metric"].astype(str).str.strip()
    df["value"] = pd.to_numeric(df["value"], errors="coerce")

    issues = []
    bad = df[df["value"].isna()]
    if len(bad):
        issues.append({
            "kind": "invalid_value",
            "scope": "指标数据",
            "detail": f"{len(bad)} 行数值无法解析，已剔除",
            "dates": sorted(bad["date"].dt.strftime("%Y-%m-%d").unique().tolist()),
        })
    df = df.dropna(subset=["value"])

    dup_mask = df.duplicated(subset=["date", "metric"], keep=False)
    if dup_mask.any():
        dups = df[dup_mask]
        per_metric = dups.groupby("metric")["date"].agg(
            lambda s: sorted(s.dt.strftime("%Y-%m-%d").unique().tolist()))
        for metric, dates in per_metric.items():
            issues.append({
                "kind": "duplicate",
                "scope": metric,
                "detail": f"{metric} 存在 {len(dates)} 天的重复上报，已按当日均值合并；"
                          "若重复值差异较大，当日基线可信度下降",
                "dates": dates,
            })
    df = df.groupby(["date", "metric"], as_index=False)["value"].mean()
    return df.sort_values(["metric", "date"]).reset_index(drop=True), issues


def load_events(csv_text: str):
    """解析事件 CSV，返回 (DataFrame, issues)。"""
    df = pd.read_csv(io.StringIO(csv_text))
    df.columns = [_norm_col(c) for c in df.columns]
    if "date" not in df.columns or "event_type" not in df.columns:
        raise ValueError("事件数据至少需要 date 与 event_type 两列")
    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    if "end_date" in df.columns:
        df["end_date"] = pd.to_datetime(df["end_date"], errors="coerce").dt.normalize()
        df["end_date"] = df["end_date"].fillna(df["date"])
    else:
        df["end_date"] = df["date"]
    for col, default in [("event_id", None), ("description", ""), ("metric", ""), ("direction", "")]:
        if col not in df.columns:
            df[col] = default
    if df["event_id"].isna().any():
        df["event_id"] = [f"E{i+1:03d}" for i in range(len(df))]
    df["event_type"] = df["event_type"].astype(str).str.strip()
    df["metric"] = df["metric"].fillna("").astype(str).str.strip()
    df["direction"] = df["direction"].fillna("").astype(str).str.strip().str.lower()
    return df.sort_values("date").reset_index(drop=True), []


def build_series(metrics_df: pd.DataFrame):
    """按指标构建完整日序列，插值缺失并记录缺失信息。"""
    series, issues = {}, []
    for metric, g in metrics_df.groupby("metric"):
        g = g.set_index("date").sort_index()
        full_idx = pd.date_range(g.index.min(), g.index.max(), freq="D")
        full = g.reindex(full_idx)
        missing_dates = full[full["value"].isna()].index
        full["is_missing"] = full["value"].isna()
        full["value"] = full["value"].interpolate(limit_direction="both")
        full.index.name = "date"
        if len(missing_dates):
            issues.append({
                "kind": "missing",
                "scope": metric,
                "detail": f"{metric} 缺失 {len(missing_dates)} 天，已线性插值用于检测；"
                          "覆盖缺失日的异常区段其起止边界与偏离度为估计值",
                "dates": [d.strftime("%Y-%m-%d") for d in missing_dates],
            })
        series[metric] = full[["value", "is_missing"]]
    return series, issues


def detect_segments(series: dict, z_thresh: float = 3.0, window: int = 21):
    """滞后滚动中位数 + MAD 稳健 z 分数检测异常，合并为区段。"""
    segments = []
    for metric, df in series.items():
        vals = df["value"]
        med = vals.rolling(window, min_periods=max(window // 2, 3)).median()
        mad = (vals - med).abs().rolling(window, min_periods=max(window // 2, 3)).median()
        mad_floor = 0.5 * float(vals.std())
        mad = mad.replace(0, np.nan).clip(lower=mad_floor)
        z = 0.6745 * (vals - med) / mad
        z = z.fillna(0.0)
        df["z"] = z
        df["baseline"] = med.ffill().bfill()
        df["pct_dev"] = np.where(df["baseline"] != 0,
                                 (df["value"] - df["baseline"]) / df["baseline"], 0.0)
        flag = (z.abs() >= z_thresh).to_numpy()
        idx = np.where(flag)[0]
        groups, cur = [], []
        for i in idx:  # 合并连续异常点（允许 1 天间隔）
            if cur and i - cur[-1] > 2:
                groups.append(cur)
                cur = []
            cur.append(i)
        if cur:
            groups.append(cur)
        for gi, grp in enumerate(groups):
            seg_dates = df.index[grp[0]:grp[-1] + 1]
            sub = df.iloc[grp[0]:grp[-1] + 1]
            peak_i = sub["z"].abs().idxmax()
            direction = "up" if sub.loc[peak_i, "z"] > 0 else "down"
            segments.append({
                "id": f"{metric}#{gi}",
                "metric": metric,
                "start": seg_dates[0].strftime("%Y-%m-%d"),
                "end": seg_dates[-1].strftime("%Y-%m-%d"),
                "direction": direction,
                "peak_z": round(float(sub["z"].abs().max()), 2),
                "mean_pct_dev": round(float(sub["pct_dev"].mean() * 100), 2),
                "covers_missing": bool(sub["is_missing"].any()),
            })
    return segments
