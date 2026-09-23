"""生成带已知异常、缺失与重复的示例运营数据。"""
from __future__ import annotations

import io
import numpy as np
import pandas as pd


def generate(seed: int = 42):
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2026-06-01", "2026-08-31", freq="D")

    def base(level, noise, n=len(dates)):
        return level + rng.normal(0, noise, n) + np.sin(np.arange(n) / 7) * noise * 1.2

    dau = base(52000, 700)
    dau[45:50] -= 7500          # 7/16-7/20 服务端故障导致 DAU 下跌
    dau[70:73] += 8000          # 8/11-8/13 投放活动带来上涨
    orders = base(8300, 220)
    orders[45:50] -= 1800       # 同期订单下跌
    orders[70:73] += 1300
    pay_rate = base(0.118, 0.003)
    pay_rate[58:62] += 0.025    # 7/29-8/1 优惠券活动拉升付费率

    rows = []
    for i, d in enumerate(dates):
        if d.strftime("%m-%d") in ("07-18", "07-19"):
            continue  # DAU 缺失两天
        rows.append((d, "DAU", round(dau[i], 0)))
        rows.append((d, "订单量", round(orders[i], 0)))
        rows.append((d, "付费率", round(pay_rate[i], 4)))
    rows.append((pd.Timestamp("2026-07-20"), "DAU", round(dau[49] * 1.01, 0)))  # 重复上报
    rows.append((pd.Timestamp("2026-08-12"), "订单量", round(orders[71] * 0.98, 0)))

    mbuf = io.StringIO()
    mbuf.write("date,metric,value\n")
    for d, m, v in rows:
        mbuf.write(f"{d:%Y-%m-%d},{m},{v}\n")

    events = [
        ("E01", "2026-06-12", "2026-06-12", "版本发布", "v2.3 灰度发布", "", ""),
        ("E02", "2026-07-16", "2026-07-20", "服务端故障", "核心机房网络中断", "DAU", "down"),
        ("E03", "2026-07-18", "2026-07-18", "竞品活动", "竞品大规模补贴", "", ""),
        ("E04", "2026-07-29", "2026-08-01", "优惠券活动", "满减券发放", "付费率", "up"),
        ("E05", "2026-08-10", "2026-08-14", "投放活动", "信息流广告加投", "DAU", "up"),
        ("E06", "2026-08-11", "2026-08-11", "版本发布", "v2.4 全量发布", "", ""),
    ]
    ebuf = io.StringIO()
    ebuf.write("event_id,date,end_date,event_type,description,metric,direction\n")
    for e in events:
        ebuf.write(",".join(e) + "\n")
    return mbuf.getvalue(), ebuf.getvalue()
