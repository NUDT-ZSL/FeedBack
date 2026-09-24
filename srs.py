"""遗忘曲线与复习调度核心逻辑（纯本地、无第三方依赖）。

模型说明：
- 每个条目有掌握度 mastery(0~1)、重要度 importance(1~5)、
  复习间隔 interval_days、上次复习时间 last_review、连续对错 streak。
- 记忆保持率按指数遗忘曲线 R(t) = exp(-t / S) 估计，
  稳定度 S 由复习间隔反推：R(interval) = 阈值 0.85。
- 今日优先级 = 重要度 * (1 - 当前保持率) + 逾期加成，越高越先复习。
"""
import math
import uuid
from datetime import date, datetime, timedelta

RETENTION_THRESHOLD = 0.85  # 保持率低于该值即视为"到期该复习"
MAX_INTERVAL = 365.0
MIN_INTERVAL = 0.5


def today_str():
    return date.today().isoformat()


def _parse_day(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def stability(interval_days):
    """由复习间隔反推记忆稳定度，使 R(interval)=阈值。"""
    return max(interval_days, MIN_INTERVAL) / -math.log(RETENTION_THRESHOLD)


def retention(item, on_day=None):
    """条目在指定日期（默认今天）的记忆保持率。"""
    on_day = on_day or date.today()
    last = _parse_day(item["last_review"])
    elapsed = max((on_day - last).days, 0)
    return math.exp(-elapsed / stability(item["interval_days"]))


def days_until_due(item, on_day=None):
    """距到期还剩几天（负数表示已逾期）。"""
    on_day = on_day or date.today()
    last = _parse_day(item["last_review"])
    elapsed = (on_day - last).days
    return item["interval_days"] - elapsed


def next_review_date(item):
    return (_parse_day(item["last_review"]) +
            timedelta(days=round(item["interval_days"]))).isoformat()


def priority(item, on_day=None):
    """今日复习优先级：重要度加权的遗忘程度 + 逾期加成。"""
    r = retention(item, on_day)
    overdue_bonus = max(0.0, -days_until_due(item, on_day)) * 0.02
    return item["importance"] * (1.0 - r) + overdue_bonus


def make_item(title, content="", mastery=0.3, importance=3,
              last_review=None, interval_days=None, streak=0):
    mastery = min(max(float(mastery), 0.0), 1.0)
    importance = int(min(max(importance, 1), 5))
    if interval_days is None:
        interval_days = 1.0 + 9.0 * mastery  # 初始间隔随掌握度 1~10 天
    return {
        "id": uuid.uuid4().hex[:8],
        "title": title,
        "content": content,
        "mastery": round(mastery, 3),
        "importance": importance,
        "last_review": last_review or today_str(),
        "interval_days": round(float(interval_days), 2),
        "streak": int(streak),
    }

def apply_review(item, correct, on_day=None):
    """根据作答结果更新条目，返回 (条目, 可解释的原因列表)。"""
    on_day = on_day or date.today()
    reasons = []
    old_mastery = item["mastery"]
    old_interval = item["interval_days"]

    if correct:
        item["streak"] = item["streak"] + 1 if item["streak"] > 0 else 1
        item["mastery"] = round(old_mastery + (1 - old_mastery) * 0.25, 3)
        reasons.append(
            "答对：掌握度 %.2f -> %.2f（向 1 靠近 25%%）" % (old_mastery, item["mastery"]))
        # 连续答对加速间隔增长：基础 1.8 倍，每多连对一次 +0.3，封顶 3.3
        mult = min(1.8 + 0.3 * (item["streak"] - 1), 3.3)
        if item["streak"] >= 2:
            reasons.append("已连续答对 %d 次，间隔增长系数提升至 %.1f" % (item["streak"], mult))
        else:
            reasons.append("间隔按基础系数 %.1f 增长" % mult)
        item["interval_days"] = round(min(old_interval * mult, MAX_INTERVAL), 2)
    else:
        item["streak"] = item["streak"] - 1 if item["streak"] < 0 else -1
        item["mastery"] = round(old_mastery * 0.6, 3)
        reasons.append(
            "答错：掌握度 %.2f -> %.2f（打 6 折）" % (old_mastery, item["mastery"]))
        # 连续答错更快压缩间隔：基础 0.5 倍，每多连错一次再减 0.1，最低 0.2
        mult = max(0.5 - 0.1 * (-item["streak"] - 1), 0.2)
        if item["streak"] <= -2:
            reasons.append("已连续答错 %d 次，间隔压缩系数降至 %.1f" % (-item["streak"], mult))
        else:
            reasons.append("间隔按系数 %.1f 压缩" % mult)
        item["interval_days"] = round(max(old_interval * mult, MIN_INTERVAL), 2)

    item["last_review"] = on_day.isoformat()
    reasons.append("复习间隔 %.1f -> %.1f 天，下次复习：%s"
                   % (old_interval, item["interval_days"], next_review_date(item)))
    return item, reasons


def apply_manual_edit(item, changes):
    """手动修改条目字段，仅重算该条目的安排，返回原因列表。"""
    reasons = []
    if "mastery" in changes:
        old_m = item["mastery"]
        new_m = min(max(float(changes["mastery"]), 0.0), 1.0)
        if new_m != old_m:
            # 掌握度变化时按比例重估间隔，保持调度自洽
            scale = (new_m + 0.1) / (old_m + 0.1)
            old_i = item["interval_days"]
            item["interval_days"] = round(
                min(max(old_i * scale, MIN_INTERVAL), MAX_INTERVAL), 2)
            item["mastery"] = round(new_m, 3)
            reasons.append(
                "掌握度 %.2f -> %.2f，间隔按比例 %.2f 重估：%.1f -> %.1f 天"
                % (old_m, new_m, scale, old_i, item["interval_days"]))
    if "importance" in changes:
        item["importance"] = int(min(max(changes["importance"], 1), 5))
        reasons.append("重要度调整为 %d" % item["importance"])
    if "last_review" in changes:
        _parse_day(changes["last_review"])  # 校验日期格式
        item["last_review"] = changes["last_review"]
        reasons.append("上次复习时间改为 %s" % item["last_review"])
    if "interval_days" in changes:
        item["interval_days"] = round(
            min(max(float(changes["interval_days"]), MIN_INTERVAL), MAX_INTERVAL), 2)
        reasons.append("复习间隔直接指定为 %.1f 天" % item["interval_days"])
    if "title" in changes:
        item["title"] = str(changes["title"])
    if "content" in changes:
        item["content"] = str(changes["content"])
    if "streak" in changes:
        item["streak"] = int(changes["streak"])
    reasons.append("已重新推导该条目：当前保持率 %.2f，下次复习 %s"
                   % (retention(item), next_review_date(item)))
    return item, reasons


def today_queue(items, on_day=None):
    """今日复习队列：到期条目按优先级降序。"""
    on_day = on_day or date.today()
    due = [it for it in items if days_until_due(it, on_day) <= 0]
    due.sort(key=lambda it: priority(it, on_day), reverse=True)
    return due


def describe(item, on_day=None):
    """供前端展示的派生信息。"""
    d = dict(item)
    d["retention"] = round(retention(item, on_day), 3)
    d["days_until_due"] = round(days_until_due(item, on_day), 1)
    d["next_review"] = next_review_date(item)
    d["priority"] = round(priority(item, on_day), 3)
    return d
