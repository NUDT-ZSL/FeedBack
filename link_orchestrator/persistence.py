"""单文件快照持久化与载入校验。

文件格式（JSON，UTF-8）::

    {
      "format": "link-orchestrator-snapshot",
      "version": 1,
      "clock": <int>,
      "class_order": [...],
      "links":     [ Link.to_dict() ... ],
      "sessions":  [ Session.to_dict() ... ],
      "reports":   { link_id: [ HealthReport.to_dict() ... ] },
      "migrations":[ MigrationRecord.to_dict() ... ],
      "conflicts": [ ConflictRecord.to_dict() ... ],
      "events":    [ EventEnvelope.to_dict() ... ],
      "counters":  {"event": n, "migration": n, "conflict": n},
      "checksum":  "<sha256 of canonical payload>"
    }

载入策略：先做完整结构/语义校验（校验和、标识唯一、字段完整、
容量不超限、迁移链来源合法、冲突与上报一致），再与事件日志从头
重放的结果逐项比对；任一步失败都抛 ``PersistenceError``，且目标
编排器（或调用方已有对象）的内存状态保持不变——成功前只构造
临时对象，成功后才返回。
"""

import os
import json
import hashlib
import tempfile
from collections import OrderedDict
from typing import Tuple, Dict, Any, List

from .errors import PersistenceError
from .models import (
    Link,
    Session,
    HealthReport,
    MigrationRecord,
    ConflictRecord,
    EventEnvelope,
)
from .orchestrator import LinkOrchestrator

FORMAT = "link-orchestrator-snapshot"
VERSION = 1
_TOP_KEYS = ("format", "version", "clock", "class_order", "links",
             "sessions", "reports", "migrations", "conflicts", "events",
             "counters", "checksum")


# ---------------------------------------------------------------------- #
# 写入
# ---------------------------------------------------------------------- #
def _payload(orch: LinkOrchestrator) -> Dict[str, Any]:
    return {
        "format": FORMAT,
        "version": VERSION,
        "clock": orch.clock,
        "class_order": list(orch.class_order),
        "links": [l.to_dict() for l in orch.all_links()],
        "sessions": [s.to_dict() for s in orch.all_sessions()],
        "reports": {
            lid: [r.to_dict() for r in sorted(orch.reports[lid], key=lambda r: r.seq)]
            for lid in sorted(orch.reports)
        },
        "migrations": [m.to_dict() for m in orch.migrations],
        "conflicts": [orch.conflicts[cid].to_dict() for cid in sorted(orch.conflicts)],
        "events": [e.to_dict() for e in orch.events],
        "counters": {
            "event": orch._event_seq,
            "migration": orch._migration_seq,
            "conflict": orch._conflict_seq,
        },
    }


def _canonical(payload: Dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def snapshot_dict(orch: LinkOrchestrator) -> Dict[str, Any]:
    """返回可 json 序列化的快照字典（含校验和）。"""
    payload = _payload(orch)
    out = dict(payload)
    out["checksum"] = hashlib.sha256(_canonical(payload)).hexdigest()
    return out


def save_state(path: str, orch: LinkOrchestrator) -> str:
    """原子写入快照文件（同目录临时文件 + os.replace）。返回路径。"""
    data = json.dumps(snapshot_dict(orch), ensure_ascii=False, indent=2,
                      sort_keys=True)
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".snap-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return path


# ---------------------------------------------------------------------- #
# 读取与校验
# ---------------------------------------------------------------------- #
def load_state_parts(path: str) -> Tuple[LinkOrchestrator, Dict[str, Any]]:
    """载入并返回 ``(编排器, 原始快照字典)``；失败抛 PersistenceError。"""
    raw = _read_raw(path)
    orch = _build_validated(raw)
    return orch, raw


def load_state(path: str) -> LinkOrchestrator:
    """从快照文件恢复编排器；文件损坏/字段缺失/语义非法一律报错。"""
    return load_state_parts(path)[0]


def load_state_into(path: str, orch: LinkOrchestrator) -> LinkOrchestrator:
    """把快照载入**已有**编排器对象。

    先在临时对象上完成全部校验与重放比对，成功后才整体替换 orch 的
    内部状态；任一步失败抛 PersistenceError，orch 的内存状态保持不变。
    """
    validated = _build_validated(_read_raw(path))
    orch.__dict__.clear()
    orch.__dict__.update(validated.__dict__)
    return orch


def _read_raw(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        raise PersistenceError(f"无法读取快照文件 {path!r}: {e}")
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as e:
        raise PersistenceError(
            f"快照文件不是合法 JSON（第 {e.lineno} 行第 {e.colno} 列: {e.msg}），"
            f"文件可能已损坏")
    if not isinstance(raw, dict):
        raise PersistenceError("快照顶层必须是 JSON 对象")
    return raw


def _require(obj, key, location, types):
    if key not in obj:
        raise PersistenceError(f"缺少必需字段 {key!r}", location)
    if not isinstance(obj[key], types):
        names = "/".join(getattr(t, "__name__", str(t)) for t in types)
        raise PersistenceError(
            f"字段 {key!r} 类型错误，应为 {names}，实际为 {type(obj[key]).__name__}",
            f"{location}.{key}")
    return obj[key]


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _build_validated(raw: Dict[str, Any]) -> LinkOrchestrator:
    # 所有校验都针对 raw；只有最终成功才返回构造好的编排器。
    fmt = raw.get("format")
    if fmt != FORMAT:
        raise PersistenceError(
            f"快照格式标识错误: 期望 {FORMAT!r}，实际 {fmt!r}", "format")
    ver = raw.get("version")
    if ver != VERSION:
        raise PersistenceError(f"快照版本不受支持: 期望 {VERSION}，实际 {ver}", "version")

    missing = [k for k in _TOP_KEYS if k not in raw]
    if missing:
        raise PersistenceError("快照缺少必需顶层字段: " + ", ".join(missing))

    stored_checksum = raw.get("checksum")
    if not isinstance(stored_checksum, str):
        raise PersistenceError("校验和必须是十六进制字符串", "checksum")
    payload = {k: raw[k] for k in _TOP_KEYS if k != "checksum"}
    actual = hashlib.sha256(_canonical(payload)).hexdigest()
    if actual != stored_checksum:
        raise PersistenceError(
            "快照校验和不匹配：文件内容已损坏或被篡改"
            f"（记录值 {stored_checksum[:12]}…，实算值 {actual[:12]}…）",
            "checksum")

    clock = raw["clock"]
    if not _is_int(clock) or clock < 0:
        raise PersistenceError("逻辑时钟必须是非负整数", "clock")
    class_order = raw["class_order"]
    if not isinstance(class_order, list) or not all(isinstance(c, str) and c for c in class_order) \
            or len(set(class_order)) != len(class_order):
        raise PersistenceError("class_order 必须是非空字符串组成的无重复列表", "class_order")

    links, link_ids = _validate_links(raw["links"])
    sessions, session_ids = _validate_sessions(raw["sessions"], link_ids, class_order)
    reports = _validate_reports(raw["reports"], link_ids, clock)
    migrations = _validate_migrations(raw["migrations"], link_ids, sessions, clock)
    conflicts = _validate_conflicts(raw["conflicts"], link_ids, reports, clock)
    counters = _validate_counters(raw["counters"])
    events = _validate_events(raw["events"], link_ids, session_ids, clock)

    # 容量不超限（按最终承载关系汇总）。
    inflight = {lid: 0 for lid in link_ids}
    for s in sessions.values():
        if s.current_link is not None:
            inflight[s.current_link] += s.bytes_sent
    for lid in link_ids:
        cap = links[lid].bandwidth
        if inflight[lid] > cap:
            raise PersistenceError(
                f"链路 {lid!r} 在途字节 {inflight[lid]} 超过带宽上限 {cap}，"
                f"超出 {inflight[lid] - cap} 字节",
                f"links[{lid}]")

    # 用校验过的数据直接构造编排器。
    orch = LinkOrchestrator()
    orch.class_order = list(class_order)
    orch.class_rank = {c: i for i, c in enumerate(class_order)}
    orch.links = OrderedDict((l.id, l) for l in
                             sorted(links.values(), key=lambda l: l.id))
    orch.reports = {lid: list(reports.get(lid, [])) for lid in orch.links}
    orch._last_report_time = {
        lid: (rs[-1].time if rs else None)
        for lid, rs in orch.reports.items()
    }
    orch.sessions = OrderedDict((s.id, s) for s in
                                sorted(sessions.values(), key=lambda s: s.id))
    orch.migrations = list(migrations)
    orch.conflicts = OrderedDict((c.id, c) for c in conflicts)
    orch.events = list(events)
    orch.clock = clock
    orch._event_seq, orch._migration_seq, orch._conflict_seq = counters

    # 冲突必须能由上报完整推导（双方来源、相反状态、有效状态一致）。
    _check_conflicts_derivable(orch)

    # 与事件日志从头重放逐项比对：任何不一致都说明快照不自洽。
    ref = orch.replay()
    sig_a, sig_b = orch._state_signature(), ref._state_signature()
    if sig_a != sig_b:
        for key in sorted(set(sig_a) | set(sig_b)):
            if sig_a.get(key) != sig_b.get(key):
                raise PersistenceError(
                    f"快照实体与事件重放结果在 {key} 上不一致，快照已损坏或被篡改："
                    f"记录 {sig_a.get(key)!r} ≠ 重放 {sig_b.get(key)!r}",
                    key)
    return orch


def _validate_links(data) -> Tuple[Dict[str, Link], set]:
    if not isinstance(data, list):
        raise PersistenceError("links 必须是列表", "links")
    links: Dict[str, Link] = {}
    for i, d in enumerate(data):
        loc = f"links[{i}]"
        if not isinstance(d, dict):
            raise PersistenceError("链路条目必须是对象", loc)
        lid = _require(d, "id", loc, (str,))
        if not lid:
            raise PersistenceError("链路标识不能为空", f"{loc}.id")
        if lid in links:
            raise PersistenceError(f"链路标识重复: {lid!r}", f"{loc}.id")
        prio = _require(d, "priority", loc, (int,))
        bw = _require(d, "bandwidth", loc, (int,))
        if isinstance(prio, bool) or not _is_int(prio):
            raise PersistenceError("优先级必须是整数", f"{loc}.priority")
        if isinstance(bw, bool) or not _is_int(bw) or bw <= 0:
            raise PersistenceError(
                f"带宽上限必须为正整数，实际为 {bw!r}", f"{loc}.bandwidth")
        created = d.get("created_at", 0)
        if not _is_int(created) or created < 0:
            raise PersistenceError("created_at 必须是非负整数", f"{loc}.created_at")
        init_avail = d.get("initially_available", True)
        if not isinstance(init_avail, bool):
            raise PersistenceError("initially_available 必须是布尔值",
                                   f"{loc}.initially_available")
        links[lid] = Link(id=lid, priority=prio, bandwidth=bw,
                          initially_available=init_avail, created_at=created)
    return links, set(links)


def _validate_sessions(data, link_ids: set, class_order) -> Tuple[Dict[str, Session], set]:
    if not isinstance(data, list):
        raise PersistenceError("sessions 必须是列表", "sessions")
    sessions: Dict[str, Session] = {}
    for i, d in enumerate(data):
        loc = f"sessions[{i}]"
        if not isinstance(d, dict):
            raise PersistenceError("会话条目必须是对象", loc)
        sid = _require(d, "id", loc, (str,))
        if not sid:
            raise PersistenceError("会话标识不能为空", f"{loc}.id")
        if sid in sessions:
            raise PersistenceError(f"会话标识重复: {sid!r}", f"{loc}.id")
        svc = _require(d, "service_class", loc, (str,))
        if not svc:
            raise PersistenceError("业务类别不能为空", f"{loc}.service_class")
        if svc not in class_order:
            raise PersistenceError(
                f"会话 {sid!r} 的业务类别 {svc!r} 未在 class_order 中登记",
                f"{loc}.service_class")
        sent = _require(d, "bytes_sent", loc, (int,))
        if not _is_int(sent) or sent < 0:
            raise PersistenceError("已发送字节数必须是非负整数", f"{loc}.bytes_sent")
        cur = d.get("current_link")
        if cur is not None:
            if not isinstance(cur, str) or cur not in link_ids:
                raise PersistenceError(
                    f"当前承载链路 {cur!r} 不存在", f"{loc}.current_link")
        ret = d.get("return_link")
        if ret is not None:
            if not isinstance(ret, str) or ret not in link_ids:
                raise PersistenceError(
                    f"回迁标记链路 {ret!r} 不存在", f"{loc}.return_link")
        created = d.get("created_at", 0)
        if not _is_int(created) or created < 0:
            raise PersistenceError("created_at 必须是非负整数", f"{loc}.created_at")
        sessions[sid] = Session(id=sid, service_class=svc, bytes_sent=sent,
                                current_link=cur, return_link=ret, created_at=created)
    return sessions, set(sessions)


def _validate_reports(data, link_ids: set, clock: int) -> Dict[str, List[HealthReport]]:
    if not isinstance(data, dict):
        raise PersistenceError("reports 必须是以链路标识为键的对象", "reports")
    out: Dict[str, List[HealthReport]] = {}
    for lid, lst in data.items():
        loc = f"reports[{lid}]"
        if lid not in link_ids:
            raise PersistenceError(f"上报引用了不存在的链路 {lid!r}", loc)
        if not isinstance(lst, list):
            raise PersistenceError("每个链路的上报必须是列表", loc)
        last_time = None
        seen = {}
        rs: List[HealthReport] = []
        for i, d in enumerate(lst):
            rloc = f"{loc}[{i}]"
            if not isinstance(d, dict):
                raise PersistenceError("上报条目必须是对象", rloc)
            t = _require(d, "time", rloc, (int,))
            if not _is_int(t) or t < 0:
                raise PersistenceError("上报时刻必须是非负整数", f"{rloc}.time")
            if t > clock:
                raise PersistenceError(
                    f"上报时刻 t={t} 超过逻辑时钟 {clock}", f"{rloc}.time")
            if last_time is not None and t < last_time:
                raise PersistenceError(
                    f"链路 {lid!r} 上报时刻倒退: t={t} 早于上一条 t={last_time}",
                    f"{rloc}.time")
            last_time = t
            src = _require(d, "source", rloc, (str,))
            if not src:
                raise PersistenceError("上报来源不能为空", f"{rloc}.source")
            if "available" not in d or not isinstance(d["available"], bool):
                raise PersistenceError("available 必须是布尔值", f"{rloc}.available")
            avail = d["available"]
            seq = d.get("seq", 0)
            if not _is_int(seq) or seq <= 0:
                raise PersistenceError("上报序号 seq 必须是正整数", f"{rloc}.seq")
            key = (t, src)
            if key in seen:
                prev = seen[key]
                if prev != avail:
                    raise PersistenceError(
                        f"同一来源 {src!r} 在 t={t} 对链路 {lid!r} 给出矛盾状态",
                        rloc)
                # 完全重复的 (时刻,来源,状态) 不允许出现在快照里（接收期已幂等丢弃）
                raise PersistenceError(
                    f"链路 {lid!r} 在 t={t} 存在来源 {src!r} 的重复上报，"
                    f"重复上报应已按幂等处理", rloc)
            seen[key] = avail
            rs.append(HealthReport(link_id=lid, time=t, available=avail,
                                   source=src, seq=seq))
        rs.sort(key=lambda r: (r.time, r.seq))
        out[lid] = rs
    return out


def _validate_migrations(data, link_ids, sessions: Dict[str, Session], clock: int) -> List[MigrationRecord]:
    if not isinstance(data, list):
        raise PersistenceError("migrations 必须是列表", "migrations")
    out: List[MigrationRecord] = []
    seqs = set()
    chains: Dict[str, str] = {}   # session -> 上一条记录的 to_link
    session_ids = set(sessions)
    for i, d in enumerate(data):
        loc = f"migrations[{i}]"
        if not isinstance(d, dict):
            raise PersistenceError("迁移条目必须是对象", loc)
        seq = _require(d, "seq", loc, (int,))
        if not _is_int(seq) or seq <= 0 or seq in seqs:
            raise PersistenceError("迁移序号必须是唯一正整数", f"{loc}.seq")
        seqs.add(seq)
        t = _require(d, "time", loc, (int,))
        if not _is_int(t) or t < 0 or t > clock:
            raise PersistenceError("迁移时刻必须是 0..clock 内的整数", f"{loc}.time")
        sid = _require(d, "session_id", loc, (str,))
        if sid not in session_ids:
            raise PersistenceError(f"迁移引用了不存在的会话 {sid!r}", f"{loc}.session_id")
        svc = _require(d, "service_class", loc, (str,))
        if not svc:
            raise PersistenceError("迁移记录的业务类别不能为空", f"{loc}.service_class")
        frm = d.get("from_link")
        to = d.get("to_link")
        if frm is not None and (not isinstance(frm, str) or frm not in link_ids):
            raise PersistenceError(
                f"迁移来源链路 {frm!r} 不存在（迁移来源必须合法）", f"{loc}.from_link")
        if to is not None and (not isinstance(to, str) or to not in link_ids):
            raise PersistenceError(
                f"迁移目标链路 {to!r} 不存在", f"{loc}.to_link")
        reason = _require(d, "reason", loc, (str,))
        if not reason:
            raise PersistenceError("迁移原因不能为空", f"{loc}.reason")
        n = _require(d, "bytes_sent", loc, (int,))
        if not _is_int(n) or n < 0:
            raise PersistenceError("迁移时字节数必须是非负整数", f"{loc}.bytes_sent")

        # 迁移链连续性：首条必须来自 None（初始放置），之后 from 必须等于上一条的 to。
        prev_to = chains.get(sid)
        if sid not in chains:
            if frm is not None:
                raise PersistenceError(
                    f"会话 {sid!r} 的首条迁移记录来源必须为空（初始放置），"
                    f"实际为 {frm!r}", f"{loc}.from_link")
        elif frm != prev_to:
            raise PersistenceError(
                f"会话 {sid!r} 迁移来源非法: 上一次承载为 {prev_to!r}，"
                f"本条来源却是 {frm!r}", f"{loc}.from_link")
        if svc != sessions[sid].service_class:
            raise PersistenceError(
                f"迁移记录的业务类别 {svc!r} 与会话登记类别 "
                f"{sessions[sid].service_class!r} 不一致", f"{loc}.service_class")
        chains[sid] = to
        out.append(MigrationRecord(seq=seq, time=t, session_id=sid, service_class=svc,
                                   from_link=frm, to_link=to, reason=reason, bytes_sent=n))
    out.sort(key=lambda m: m.seq)
    if [m.seq for m in out] != list(range(1, len(out) + 1)):
        raise PersistenceError("迁移序号必须从 1 开始连续编号", "migrations")
    return out


def _validate_conflicts(data, link_ids, reports, clock: int) -> List[ConflictRecord]:
    if not isinstance(data, list):
        raise PersistenceError("conflicts 必须是列表", "conflicts")
    out: List[ConflictRecord] = []
    ids = set()
    for i, d in enumerate(data):
        loc = f"conflicts[{i}]"
        if not isinstance(d, dict):
            raise PersistenceError("冲突条目必须是对象", loc)
        cid = _require(d, "id", loc, (str,))
        if cid in ids:
            raise PersistenceError(f"冲突标识重复: {cid!r}", f"{loc}.id")
        ids.add(cid)
        lid = _require(d, "link_id", loc, (str,))
        if lid not in link_ids:
            raise PersistenceError(f"冲突引用了不存在的链路 {lid!r}", f"{loc}.link_id")
        t = _require(d, "time", loc, (int,))
        if not _is_int(t) or t < 0 or t > clock:
            raise PersistenceError("冲突时刻必须是 0..clock 内的整数", f"{loc}.time")
        sa = _require(d, "source_a", loc, (str,))
        sb = _require(d, "source_b", loc, (str,))
        if "available_a" not in d or not isinstance(d["available_a"], bool):
            raise PersistenceError("available_a 必须是布尔值", f"{loc}.available_a")
        if "available_b" not in d or not isinstance(d["available_b"], bool):
            raise PersistenceError("available_b 必须是布尔值", f"{loc}.available_b")
        if d["available_a"] == d["available_b"]:
            raise PersistenceError("冲突双方状态必须相反", loc)
        if not isinstance(d.get("effective_status"), bool):
            raise PersistenceError("effective_status 必须是布尔值", f"{loc}.effective_status")
        if not _is_int(d.get("created_seq", 0)):
            raise PersistenceError("created_seq 必须是整数", f"{loc}.created_seq")
        resolved = d.get("resolved", False)
        if not isinstance(resolved, bool):
            raise PersistenceError("resolved 必须是布尔值", f"{loc}.resolved")
        resolution = d.get("resolution")
        if resolution is not None and not isinstance(resolution, str):
            raise PersistenceError("resolution 必须是字符串或 null", f"{loc}.resolution")
        out.append(ConflictRecord.from_dict(d))
    out.sort(key=lambda c: c.id)
    return out


def _validate_counters(data):
    if not isinstance(data, dict):
        raise PersistenceError("counters 必须是对象", "counters")
    vals = []
    for name in ("event", "migration", "conflict"):
        v = _require(data, name, "counters", (int,))
        if not _is_int(v) or v < 0:
            raise PersistenceError(f"计数器 {name} 必须是非负整数", f"counters.{name}")
        vals.append(v)
    return tuple(vals)


def _validate_events(data, link_ids, session_ids, clock: int) -> List[EventEnvelope]:
    if not isinstance(data, list):
        raise PersistenceError("events 必须是列表", "events")
    known = {"class_registered", "link_added", "session_added", "bytes_grew",
             "health_report", "manual_migration", "conflict_resolved",
             "session_stranded"}
    out: List[EventEnvelope] = []
    last_seq = 0
    for i, d in enumerate(data):
        loc = f"events[{i}]"
        if not isinstance(d, dict):
            raise PersistenceError("事件条目必须是对象", loc)
        seq = _require(d, "seq", loc, (int,))
        if not _is_int(seq) or seq != last_seq + 1:
            raise PersistenceError(
                f"事件序号必须从 1 连续递增，上一条 seq={last_seq}，本条 seq={seq}",
                f"{loc}.seq")
        last_seq = seq
        kind = _require(d, "kind", loc, (str,))
        if kind not in known:
            raise PersistenceError(f"未知事件类型 {kind!r}", f"{loc}.kind")
        t = _require(d, "time", loc, (int,))
        if not _is_int(t) or t < 0 or t > clock:
            raise PersistenceError("事件时刻必须是 0..clock 内的整数", f"{loc}.time")
        body = d.get("data")
        if not isinstance(body, dict):
            raise PersistenceError("事件 data 必须是对象", f"{loc}.data")
        if kind == "health_report" and body.get("link_id") not in link_ids:
            raise PersistenceError("健康上报事件引用了不存在的链路", f"{loc}.data.link_id")
        if kind == "session_added" and body.get("id") not in session_ids:
            raise PersistenceError("事件引用了不存在的会话", f"{loc}.data.id")
        if kind in ("bytes_grew", "session_stranded") \
                and body.get("session_id") not in session_ids:
            raise PersistenceError("事件引用了不存在的会话", f"{loc}.data.session_id")
        if kind == "manual_migration":
            if body.get("session_id") not in session_ids:
                raise PersistenceError("手动迁移事件引用了不存在的会话",
                                       f"{loc}.data.session_id")
            if body.get("to_link") not in link_ids:
                raise PersistenceError("手动迁移事件引用了不存在的目标链路",
                                       f"{loc}.data.to_link")
        if kind == "session_stranded" and body.get("failed_link") not in link_ids:
            raise PersistenceError("搁浅事件引用了不存在的链路", f"{loc}.data.failed_link")
        out.append(EventEnvelope(seq=seq, kind=kind, time=t, data=dict(body)))
    return out


def _check_conflicts_derivable(orch: LinkOrchestrator) -> None:
    """每条冲突都必须能在对应链路同时刻的上报里找到相反状态的双方。"""
    for c in orch.conflicts.values():
        bucket = [r for r in orch.reports[c.link_id] if r.time == c.time]
        sides = {(r.source, r.available) for r in bucket}
        if (c.source_a, c.available_a) not in sides or (c.source_b, c.available_b) not in sides:
            raise PersistenceError(
                f"冲突 {c.id} 的双方上报在健康上报记录中找不到，冲突记录无法溯源",
                f"conflicts[{c.id}]")
        carried = orch._carried_status_before(c.link_id, c.time)
        if carried != c.effective_status:
            raise PersistenceError(
                f"冲突 {c.id} 的 effective_status 与上报推导结果不一致",
                f"conflicts[{c.id}].effective_status")
