"""Local forgetting-curve scheduling logic.

The module deliberately has no GUI or third-party dependencies, so the review
rules can be tested independently and every recommendation can be explained.
"""

from __future__ import annotations

import csv
import json
import math
import os
import tempfile
import uuid
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any, Iterable


DATE_TIME_FORMAT = "%Y-%m-%d %H:%M"


def now_local() -> datetime:
    """Return local time; isolated as a function for tests and clarity."""
    return datetime.now().replace(second=0, microsecond=0)


def parse_datetime(value: Any, field_name: str = "时间") -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(second=0, microsecond=0)
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    text = str(value).strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("/", "-"))
    except ValueError as exc:
        raise ValueError(f"{field_name}必须是 YYYY-MM-DD 或 YYYY-MM-DD HH:MM 格式") from exc
    return parsed.replace(second=0, microsecond=0)


def format_datetime(value: datetime | None) -> str:
    return value.strftime(DATE_TIME_FORMAT) if value else ""


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


@dataclass
class ReviewItem:
    id: str
    title: str
    content: str = ""
    mastery: int = 50
    importance: int = 3
    last_reviewed: str | None = None
    next_review: str | None = None
    stability_days: float = 3.25
    correct_streak: int = 0
    wrong_streak: int = 0
    total_reviews: int = 0
    manual_next: bool = False
    notes: str = ""
    history: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


def target_retention(importance: int) -> float:
    """More important content is refreshed before retention falls too far."""
    importance = int(clamp(importance, 1, 5))
    return 0.75 + 0.035 * (importance - 1)


def initial_stability(mastery: int) -> float:
    """Estimated memory strength in days, inferred when no history exists."""
    mastery = int(clamp(mastery, 0, 100))
    return round(0.5 + 5.5 * mastery / 100, 3)


def retrievability(stability_days: float, elapsed_days: float) -> float:
    """Exponential forgetting curve: R = e^(-t/S)."""
    stability_days = max(0.05, float(stability_days))
    return math.exp(-max(0.0, float(elapsed_days)) / stability_days)


def recommended_interval_days(
    stability_days: float, importance: int, minimum: float = 0.2
) -> float:
    """Solve e^(-I/S)=target for the interval I."""
    target = target_retention(importance)
    interval = -max(0.05, stability_days) * math.log(target)
    return round(max(minimum, min(180.0, interval)), 2)


def _number(raw: dict[str, Any], key: str, default: float | None = None) -> float:
    if key not in raw or raw[key] in (None, ""):
        if default is None:
            raise ValueError(f"缺少字段：{key}")
        return default
    try:
        return float(raw[key])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} 必须是数字") from exc


def item_from_dict(raw: dict[str, Any], row_label: str = "条目") -> ReviewItem:
    if not isinstance(raw, dict):
        raise ValueError(f"{row_label}必须是对象")
    title = str(raw.get("title", "")).strip()
    if not title:
        raise ValueError(f"{row_label}缺少 title")
    mastery = int(round(clamp(_number(raw, "mastery", 50), 0, 100)))
    importance = int(round(clamp(_number(raw, "importance", 3), 1, 5)))
    last = parse_datetime(raw.get("last_reviewed"), "last_reviewed")
    due = parse_datetime(raw.get("next_review"), "next_review")
    stability = raw.get("stability_days")
    stability_value = (
        clamp(_number(raw, "stability_days"), 0.05, 365)
        if stability not in (None, "")
        else initial_stability(mastery)
    )
    timestamp = format_datetime(now_local())
    history = raw.get("history") if isinstance(raw.get("history"), list) else []
    if raw.get("next_review") in (None, ""):
        if last is None:
            due = now_local()
        else:
            due = _next_from_stability(stability_value, importance, last, 1 / 24)
    return ReviewItem(
        id=str(raw.get("id") or uuid.uuid4()),
        title=title,
        content=str(raw.get("content", "")),
        mastery=mastery,
        importance=importance,
        last_reviewed=format_datetime(last) if last else None,
        next_review=format_datetime(due) if due else None,
        stability_days=round(float(stability_value), 3),
        correct_streak=max(0, int(_number(raw, "correct_streak", 0))),
        wrong_streak=max(0, int(_number(raw, "wrong_streak", 0))),
        total_reviews=max(0, int(_number(raw, "total_reviews", 0))),
        manual_next=bool(raw.get("manual_next", False)),
        notes=str(raw.get("notes", "")),
        history=history,
        created_at=str(raw.get("created_at") or timestamp),
        updated_at=str(raw.get("updated_at") or timestamp),
    )


@dataclass
class ScheduleEntry:
    item: ReviewItem
    priority: float
    retention: float
    target: float
    elapsed_days: float
    overdue_days: float
    due_at: datetime
    completed_today: bool
    reason: str


def schedule_item(item: ReviewItem, current_time: datetime | None = None) -> ScheduleEntry:
    current_time = current_time or now_local()
    last = parse_datetime(item.last_reviewed, "last_reviewed")
    due = parse_datetime(item.next_review, "next_review") or last or current_time
    elapsed = max(0.0, (current_time - (last or current_time)).total_seconds() / 86400)
    retention = retrievability(item.stability_days, elapsed)
    target = target_retention(item.importance)
    overdue = max(0.0, (current_time - due).total_seconds() / 86400)
    gap = max(0.0, target - retention)
    unseen_bonus = 8 if last is None else 0
    priority = 100 * gap + 4 * (item.importance - 1) + 10 * overdue + unseen_bonus

    completed_today = bool(last and last.date() == current_time.date())
    reasons = [
        f"估计留存率 {retention:.0%}，目标 {target:.0%}",
        f"记忆强度 {item.stability_days:.1f} 天，距上次复习 {elapsed:.1f} 天",
    ]
    if overdue >= 0.05:
        reasons.append(f"已逾期 {overdue:.1f} 天")
    if last is None:
        reasons.append("尚未复习过，需要建立初始记忆")
    if item.importance >= 4:
        reasons.append(f"重要度 {item.importance}，采用更高目标留存率")
    reason = "；".join(reasons)
    return ScheduleEntry(
        item=item, priority=round(priority, 2), retention=retention, target=target,
        elapsed_days=elapsed, overdue_days=overdue, due_at=due,
        completed_today=completed_today, reason=reason,
    )


def build_schedule(
    items: Iterable[ReviewItem],
    current_time: datetime | None = None,
    include_completed: bool = False,
) -> list[ScheduleEntry]:
    """Rank today's queue. Higher forgetting risk and importance come first."""
    current_time = current_time or now_local()
    entries = [schedule_item(item, current_time) for item in items]
    day_end = datetime.combine(current_time.date(), time.max)
    due_today = [entry for entry in entries if entry.due_at <= day_end]
    if not include_completed:
        due_today = [entry for entry in due_today if not entry.completed_today]
    return sorted(
        due_today,
        key=lambda entry: (-entry.priority, entry.due_at, entry.item.title),
    )


def _next_from_stability(
    stability_days: float, importance: int, current_time: datetime, minimum: float
) -> datetime:
    interval_days = recommended_interval_days(stability_days, importance, minimum)
    return current_time + timedelta(days=interval_days)


def record_answer(
    item: ReviewItem,
    correct: bool,
    current_time: datetime | None = None,
    note: str = "",
) -> tuple[ReviewItem, dict[str, Any]]:
    """Apply one binary answer and return an explanation for the adjustment."""
    current_time = current_time or now_local()
    before_mastery = item.mastery
    before_stability = item.stability_days
    old_schedule = schedule_item(item, current_time)

    if correct:
        item.correct_streak += 1
        item.wrong_streak = 0
        mastery_gain = 7 + min(item.correct_streak, 5)
        item.mastery = int(round(clamp(item.mastery + mastery_gain, 0, 100)))
        growth = min(0.42, 0.22 + 0.07 * (item.correct_streak - 1))
        item.stability_days = round(clamp(item.stability_days * (1 + growth), 0.05, 365), 3)
        next_time = _next_from_stability(item.stability_days, item.importance, current_time, 0.5)
        trend = f"连续答对 {item.correct_streak} 次，强度增长 {growth:.0%}，复习频率降低、间隔拉长"
        change = f"掌握度 {before_mastery} → {item.mastery}；记忆强度 {before_stability:.1f} → {item.stability_days:.1f} 天"
    else:
        item.wrong_streak += 1
        item.correct_streak = 0
        mastery_loss = 8 + min(item.wrong_streak, 6)
        item.mastery = int(round(clamp(item.mastery - mastery_loss, 0, 100)))
        shrink = max(0.32, 0.58 - 0.08 * (item.wrong_streak - 1))
        item.stability_days = round(clamp(item.stability_days * shrink, 0.05, 365), 3)
        next_time = _next_from_stability(item.stability_days, item.importance, current_time, 1 / 24)
        trend = f"连续答错 {item.wrong_streak} 次，强度缩短为原来的 {shrink:.0%}，复习频率提高、间隔缩短"
        change = f"掌握度 {before_mastery} → {item.mastery}；记忆强度 {before_stability:.1f} → {item.stability_days:.1f} 天"

    item.last_reviewed = format_datetime(current_time)
    item.next_review = format_datetime(next_time)
    item.manual_next = False
    item.total_reviews += 1
    item.updated_at = format_datetime(current_time)
    interval_hours = (next_time - current_time).total_seconds() / 3600
    event = {
        "at": item.last_reviewed,
        "type": "answer",
        "result": "correct" if correct else "wrong",
        "mastery_before": before_mastery,
        "mastery_after": item.mastery,
        "stability_before": round(before_stability, 3),
        "stability_after": item.stability_days,
        "retention_before": round(old_schedule.retention, 3),
        "next_review": item.next_review,
        "interval_hours": round(interval_hours, 2),
        "note": note,
    }
    item.history.append(event)
    item.history = item.history[-100:]
    reason_parts = [
        f"作答前估计留存率 {old_schedule.retention:.0%}，目标 {old_schedule.target:.0%}",
        change,
        trend,
        f"按重要度 {item.importance} 的目标留存率，下次安排在 {item.next_review}（约 {interval_hours:.1f} 小时后）",
    ]
    return item, {"event": event, "reason": "。".join(reason_parts)}


def manually_update_item(
    item: ReviewItem,
    values: dict[str, Any],
    current_time: datetime | None = None,
) -> tuple[ReviewItem, dict[str, Any]]:
    """Apply an explicit user edit; only this item's derived schedule changes."""
    current_time = current_time or now_local()
    before = {
        "mastery": item.mastery,
        "importance": item.importance,
        "last_reviewed": item.last_reviewed,
        "next_review": item.next_review,
        "stability_days": item.stability_days,
    }
    changes: list[str] = []
    was_manual_next = item.manual_next

    if "title" in values:
        title = str(values["title"]).strip()
        if not title:
            raise ValueError("标题不能为空")
        item.title = title
    if "content" in values:
        item.content = str(values["content"])
    if "notes" in values:
        item.notes = str(values["notes"])

    mastery_changed = False
    importance_changed = False
    last_review_changed = False

    if "mastery" in values and values["mastery"] not in (None, ""):
        mastery = int(round(clamp(float(values["mastery"]), 0, 100)))
        if mastery != item.mastery:
            mastery_changed = True
            changes.append(f"掌握度 {item.mastery} → {mastery}")
            item.mastery = mastery
            # A direct mastery claim replaces uncertain answer-trend evidence.
            item.stability_days = initial_stability(mastery)
            item.correct_streak = 0
            item.wrong_streak = 0

    if "importance" in values and values["importance"] not in (None, ""):
        importance = int(round(clamp(float(values["importance"]), 1, 5)))
        if importance != item.importance:
            importance_changed = True
            changes.append(f"重要度 {item.importance} → {importance}")
            item.importance = importance

    if "last_reviewed" in values:
        last = parse_datetime(values.get("last_reviewed"), "上次复习时间")
        new_last = format_datetime(last) if last else None
        if new_last != item.last_reviewed:
            last_review_changed = True
            changes.append(f"上次复习时间 {item.last_reviewed or '无'} → {new_last or '无'}")
            item.last_reviewed = new_last

    explicit_next = "next_review" in values
    if explicit_next:
        due = parse_datetime(values.get("next_review"), "下次复习时间")
        new_next = format_datetime(due) if due else None
        item.next_review = new_next
        item.manual_next = was_manual_next if new_next == before["next_review"] else new_next is not None
        if item.next_review != before["next_review"]:
            changes.append(f"下次复习时间 {before['next_review'] or '自动'} → {item.next_review or '自动'}")

    schedule_input_changed = mastery_changed or importance_changed or last_review_changed
    if not item.manual_next and schedule_input_changed:
        anchor = parse_datetime(item.last_reviewed, "上次复习时间") or current_time
        item.next_review = format_datetime(
            _next_from_stability(item.stability_days, item.importance, anchor, 1 / 24)
        )
        changes.append(f"根据当前记忆强度重新推导下次时间为 {item.next_review}")
    elif item.manual_next:
        changes.append("保留你手动指定的下次复习时间")

    item.updated_at = format_datetime(current_time)
    event = {
        "at": item.updated_at,
        "type": "manual_edit",
        "before": before,
        "after": {
            "mastery": item.mastery,
            "importance": item.importance,
            "last_reviewed": item.last_reviewed,
            "next_review": item.next_review,
            "stability_days": item.stability_days,
        },
        "changes": changes,
    }
    item.history.append(event)
    item.history = item.history[-100:]
    return item, {"event": event, "reason": "；".join(changes) or "内容没有变化"}


FIELD_ALIASES = {
    "id": "id", "编号": "id",
    "title": "title", "标题": "title", "名称": "title",
    "content": "content", "内容": "content", "题干": "content",
    "mastery": "mastery", "掌握程度": "mastery", "掌握度": "mastery",
    "importance": "importance", "重要度": "importance",
    "last_reviewed": "last_reviewed", "上次复习时间": "last_reviewed",
    "next_review": "next_review", "下次复习时间": "next_review",
    "notes": "notes", "备注": "notes",
}


def rows_from_csv(path: str | Path) -> list[dict[str, Any]]:
    """Import UTF-8 CSV with either English or Chinese headers."""
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV 缺少表头")
        rows: list[dict[str, Any]] = []
        for index, raw in enumerate(reader, start=2):
            mapped = {
                FIELD_ALIASES[key.strip()]: value
                for key, value in raw.items()
                if key and key.strip() in FIELD_ALIASES
            }
            try:
                rows.append(asdict(item_from_dict(mapped, f"第 {index} 行")))
            except ValueError as exc:
                raise ValueError(f"CSV 第 {index} 行：{exc}") from exc
        return rows


def rows_from_json(path: str | Path) -> list[dict[str, Any]]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    raw_items = data.get("items", data) if isinstance(data, dict) else data
    if not isinstance(raw_items, list):
        raise ValueError("JSON 顶层必须是条目数组，或包含 items 数组")
    rows: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_items, start=1):
        try:
            rows.append(asdict(item_from_dict(raw, f"第 {index} 条")))
        except ValueError as exc:
            raise ValueError(f"JSON 第 {index} 条：{exc}") from exc
    return rows


def import_rows(path: str | Path) -> list[dict[str, Any]]:
    suffix = Path(path).suffix.lower()
    if suffix == ".csv":
        return rows_from_csv(path)
    if suffix == ".json":
        return rows_from_json(path)
    raise ValueError("仅支持导入 .csv 或 .json 文件")


class ReviewStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.items: dict[str, ReviewItem] = {}
        if self.path.exists():
            self.load()

    def load(self) -> None:
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        raw_items = payload.get("items", []) if isinstance(payload, dict) else payload
        self.items = {}
        for index, raw in enumerate(raw_items, start=1):
            item = item_from_dict(raw, f"存档第 {index} 条")
            self.items[item.id] = item

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "saved_at": format_datetime(now_local()),
            "items": [asdict(item) for item in self.items.values()],
        }
        fd, temporary_name = tempfile.mkstemp(
            prefix=self.path.name + ".", suffix=".tmp", dir=str(self.path.parent)
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            os.replace(temporary_name, self.path)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)

    def list_items(self) -> list[ReviewItem]:
        return list(self.items.values())

    def upsert_rows(
        self, rows: list[dict[str, Any]], replace: bool = False
    ) -> tuple[int, int]:
        incoming: dict[str, ReviewItem] = {}
        for raw in rows:
            item = item_from_dict(raw)
            incoming[item.id] = item
        if replace:
            self.items = incoming
        else:
            self.items.update(incoming)
        self.save()
        return len(incoming), len(self.items)

    def add_item(self, item: ReviewItem) -> None:
        self.items[item.id] = item
        self.save()

    def update_item(self, item: ReviewItem) -> None:
        self.items[item.id] = item
        self.save()

    def delete_item(self, item_id: str) -> None:
        self.items.pop(item_id, None)
        self.save()
