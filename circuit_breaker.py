"""可离线验收的熔断内核（纯 Python 标准库实现）。

设计要点：
- 不依赖第三方包，不访问真实网络 / 真实时钟；
- 由可注入的逻辑时钟（LogicalClock）驱动，所有状态迁移对同一输入序列完全可复现；
- 支持多个独立熔断单元，每个单元有关闭（closed）/ 打开（open）/ 半开（half_open）三种状态；
- 半开状态按探测配额限量放行，探测成功恢复关闭，探测失败重新打开；
- 恢复抖动（flapping）会被识别并按可配置策略加速重新熔断，冷却期有上限；
- 全部内部状态可导出为 JSON 并校验后重新载入，载入失败不影响内存状态。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class CircuitBreakerError(Exception):
    """熔断内核的基础异常，错误信息中总是包含可定位的上下文。"""


class UnknownUnitError(CircuitBreakerError):
    """操作的熔断单元不存在。"""


class DuplicateUnitError(CircuitBreakerError):
    """重复注册同一熔断单元。"""


class ConfigError(CircuitBreakerError):
    """单元配置不合法。"""


class ClockRegressionError(CircuitBreakerError):
    """逻辑时钟回退（推进量为负）。"""


class NoInflightRequestError(CircuitBreakerError):
    """在没有已放行请求的情况下上报结果（例如打开状态下上报）。"""


class ImportValidationError(CircuitBreakerError):
    """导入的 JSON 数据校验失败；内存状态保持不变。"""


# ---------------------------------------------------------------------------
# 状态与配置
# ---------------------------------------------------------------------------


class State(str, Enum):
    """熔断单元的三种状态。"""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

    @classmethod
    def parse(cls, value: Any) -> "State":
        if isinstance(value, cls):
            return value
        try:
            return cls(value)
        except ValueError:
            legal = ", ".join(s.value for s in cls)
            raise ImportValidationError(
                f"非法状态取值 {value!r}，合法取值为: {legal}"
            ) from None


@dataclass(frozen=True)
class UnitConfig:
    """单个熔断单元的配置。

    failure_threshold:        关闭状态下触发熔断的连续失败阈值（>= 1）。
    cooldown_seconds:         基础冷却期（> 0），首次打开时使用。
    half_open_probe_quota:    半开状态允许同时在途的探测请求数（>= 0；为 0 时
                              半开状态不放行任何请求，单元将停留在半开）。
    flapping_window_seconds:  抖动识别窗口（>= 0）。单元离开打开状态后，若在该
                              窗口内再次打开，视为恢复抖动。
    backoff_multiplier:       抖动加速倍率（>= 1）。第 n 级抖动的冷却期为
                              cooldown_seconds * backoff_multiplier ** n。
    max_cooldown_seconds:     冷却期上限（>= cooldown_seconds），加速后的冷却期
                              不会超过该值。
    """

    failure_threshold: int = 3
    cooldown_seconds: float = 30.0
    half_open_probe_quota: int = 1
    flapping_window_seconds: float = 60.0
    backoff_multiplier: float = 2.0
    max_cooldown_seconds: float = 600.0

    def validate(self, context: str = "配置") -> None:
        if not isinstance(self.failure_threshold, int) or self.failure_threshold < 1:
            raise ConfigError(f"{context}: failure_threshold 必须为 >= 1 的整数")
        if not _is_number(self.cooldown_seconds) or self.cooldown_seconds <= 0:
            raise ConfigError(f"{context}: cooldown_seconds 必须为正数")
        if (
            not isinstance(self.half_open_probe_quota, int)
            or self.half_open_probe_quota < 0
        ):
            raise ConfigError(f"{context}: half_open_probe_quota 必须为 >= 0 的整数")
        if (
            not _is_number(self.flapping_window_seconds)
            or self.flapping_window_seconds < 0
        ):
            raise ConfigError(f"{context}: flapping_window_seconds 必须为非负数")
        if not _is_number(self.backoff_multiplier) or self.backoff_multiplier < 1:
            raise ConfigError(f"{context}: backoff_multiplier 必须 >= 1")
        if not _is_number(self.max_cooldown_seconds) or (
            self.max_cooldown_seconds < self.cooldown_seconds
        ):
            raise ConfigError(
                f"{context}: max_cooldown_seconds 必须 >= cooldown_seconds"
            )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "failure_threshold": self.failure_threshold,
            "cooldown_seconds": self.cooldown_seconds,
            "half_open_probe_quota": self.half_open_probe_quota,
            "flapping_window_seconds": self.flapping_window_seconds,
            "backoff_multiplier": self.backoff_multiplier,
            "max_cooldown_seconds": self.max_cooldown_seconds,
        }

    @classmethod
    def from_dict(cls, data: Any, context: str) -> "UnitConfig":
        if not isinstance(data, dict):
            raise ImportValidationError(f"{context}: config 必须是对象")
        required = {
            "failure_threshold",
            "cooldown_seconds",
            "half_open_probe_quota",
            "flapping_window_seconds",
            "backoff_multiplier",
            "max_cooldown_seconds",
        }
        missing = required - set(data)
        if missing:
            raise ImportValidationError(
                f"{context}: config 缺少字段 {sorted(missing)}"
            )
        cfg = cls(
            failure_threshold=data["failure_threshold"],
            cooldown_seconds=data["cooldown_seconds"],
            half_open_probe_quota=data["half_open_probe_quota"],
            flapping_window_seconds=data["flapping_window_seconds"],
            backoff_multiplier=data["backoff_multiplier"],
            max_cooldown_seconds=data["max_cooldown_seconds"],
        )
        try:
            cfg.validate(context)
        except ConfigError as exc:
            raise ImportValidationError(str(exc)) from None
        return cfg


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


# ---------------------------------------------------------------------------
# 逻辑时钟
# ---------------------------------------------------------------------------


class LogicalClock:
    """可注入的逻辑时钟：从 0 开始，只能向前推进。"""

    def __init__(self, start: float = 0.0) -> None:
        if not _is_number(start) or start < 0:
            raise ConfigError("逻辑时钟起点必须为非负数")
        self._now = float(start)

    @property
    def now(self) -> float:
        return self._now

    def advance(self, delta: float) -> float:
        """推进逻辑时钟。推进量必须 >= 0，否则视为时钟回退并报错。"""
        if not _is_number(delta):
            raise ClockRegressionError(f"时钟推进量必须为数字，得到 {delta!r}")
        if delta < 0:
            raise ClockRegressionError(
                f"逻辑时钟不允许回退：推进量 {delta} 为负（当前时刻 {self._now}）"
            )
        self._now += float(delta)
        return self._now


# ---------------------------------------------------------------------------
# 内部记录
# ---------------------------------------------------------------------------


@dataclass
class _Transition:
    """一次状态迁移记录。"""

    seq: int
    unit_id: str
    from_state: State
    to_state: State
    at: float
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "seq": self.seq,
            "unit_id": self.unit_id,
            "from_state": self.from_state.value,
            "to_state": self.to_state.value,
            "at": self.at,
            "reason": self.reason,
        }


@dataclass
class _Unit:
    """单个熔断单元的全部运行时状态。"""

    unit_id: str
    config: UnitConfig
    state: State = State.CLOSED
    consecutive_failures: int = 0
    last_failure_at: Optional[float] = None
    # 当前打开期的起点与本次实际使用的冷却期（可能已被抖动加速）。
    opened_at: Optional[float] = None
    effective_cooldown: float = 0.0
    # 半开状态下已放行、尚未上报结果的探测请求数。
    probes_in_flight: int = 0
    # 抖动等级：在抖动窗口内每重新打开一次升一级，窗口外归零。
    flap_level: int = 0
    # 最近一次离开打开状态（进入半开）的时刻，用于抖动识别。
    last_open_exit_at: Optional[float] = None
    # 最近一次失败（含探测失败）的原因与时刻。
    last_failure_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "unit_id": self.unit_id,
            "state": self.state.value,
            "consecutive_failures": self.consecutive_failures,
            "last_failure_at": self.last_failure_at,
            "opened_at": self.opened_at,
            "effective_cooldown": self.effective_cooldown,
            "probes_in_flight": self.probes_in_flight,
            "flap_level": self.flap_level,
            "last_open_exit_at": self.last_open_exit_at,
            "last_failure_reason": self.last_failure_reason,
            "config": self.config.to_dict(),
        }


# ---------------------------------------------------------------------------
# 熔断内核
# ---------------------------------------------------------------------------

_EXPORT_VERSION = 1


class CircuitBreaker:
    """多单元熔断内核。所有时间均来自注入的逻辑时钟。"""

    def __init__(self, clock: Optional[LogicalClock] = None) -> None:
        self._clock = clock if clock is not None else LogicalClock()
        self._units: Dict[str, _Unit] = {}
        self._history: List[_Transition] = []
        self._seq = 0

    # -- 注册 ----------------------------------------------------------------

    def register(self, unit_id: str, config: Optional[UnitConfig] = None) -> None:
        """注册一个熔断单元。标识必须为非空字符串且不得重复。"""
        if not isinstance(unit_id, str) or not unit_id:
            raise ConfigError(f"单元标识必须为非空字符串，得到 {unit_id!r}")
        if unit_id in self._units:
            raise DuplicateUnitError(f"单元 '{unit_id}' 已注册，不允许重复注册")
        cfg = config if config is not None else UnitConfig()
        cfg.validate(context=f"单元 '{unit_id}' 的配置")
        self._units[unit_id] = _Unit(unit_id=unit_id, config=cfg)

    # -- 放行判定 --------------------------------------------------------------

    def allow(self, unit_id: str) -> bool:
        """判定当前时刻是否放行该单元的请求。

        关闭状态一律放行；打开状态一律拒绝（拒绝不改变任何计数，也不触发迁移）；
        半开状态在探测配额内放行，配额用尽后拒绝并等待在途探测的结果。
        """
        unit = self._get_unit(unit_id)
        self._maybe_exit_open(unit)
        if unit.state is State.CLOSED:
            return True
        if unit.state is State.OPEN:
            return False
        # 半开
        if unit.probes_in_flight < unit.config.half_open_probe_quota:
            unit.probes_in_flight += 1
            return True
        return False

    # -- 结果上报 --------------------------------------------------------------

    def report_success(self, unit_id: str) -> None:
        """上报一次成功。半开探测成功会恢复关闭并清零连续失败计数。"""
        unit = self._get_unit(unit_id)
        self._maybe_exit_open(unit)
        if unit.state is State.OPEN:
            raise NoInflightRequestError(
                f"单元 '{unit_id}' 处于打开状态，没有已放行的请求，无法上报成功"
            )
        if unit.state is State.HALF_OPEN:
            self._consume_probe(unit, "成功")
            unit.consecutive_failures = 0
            # 半开探测期结束，释放剩余探测配额，在途计数不留残值。
            unit.probes_in_flight = 0
            self._transition(unit, State.CLOSED, "半开探测成功，恢复关闭")
        else:
            unit.consecutive_failures = 0

    def report_failure(self, unit_id: str, reason: str = "") -> None:
        """上报一次失败。达到阈值或在半开状态下失败都会触发熔断。"""
        unit = self._get_unit(unit_id)
        self._maybe_exit_open(unit)
        if unit.state is State.OPEN:
            raise NoInflightRequestError(
                f"单元 '{unit_id}' 处于打开状态，没有已放行的请求，无法上报失败"
            )
        unit.last_failure_at = self._clock.now
        unit.last_failure_reason = reason or None
        if unit.state is State.HALF_OPEN:
            self._consume_probe(unit, "失败")
            detail = f"，原因: {reason}" if reason else ""
            self._open(unit, f"半开探测失败，重新打开{detail}")
            return
        unit.consecutive_failures += 1
        if unit.consecutive_failures >= unit.config.failure_threshold:
            detail = f"，原因: {reason}" if reason else ""
            self._open(
                unit,
                f"连续失败 {unit.consecutive_failures} 次达到阈值 "
                f"{unit.config.failure_threshold}{detail}",
            )

    # -- 时钟 ------------------------------------------------------------------

    def advance_clock(self, delta: float) -> float:
        """推进逻辑时钟，并按单元注册顺序结算所有到期的冷却期。"""
        now = self._clock.advance(delta)
        for unit in self._units.values():
            self._maybe_exit_open(unit)
        return now

    @property
    def now(self) -> float:
        return self._clock.now

    # -- 查询 ------------------------------------------------------------------

    def query(self, unit_id: str) -> Dict[str, Any]:
        """返回单元当前状态快照（会先结算到期的冷却期）。"""
        unit = self._get_unit(unit_id)
        self._maybe_exit_open(unit)
        cooldown_remaining = None
        if unit.state is State.OPEN:
            assert unit.opened_at is not None
            cooldown_remaining = max(
                0.0, unit.opened_at + unit.effective_cooldown - self._clock.now
            )
        last_transition = None
        for record in reversed(self._history):
            if record.unit_id == unit_id:
                last_transition = record.to_dict()
                break
        return {
            "unit_id": unit_id,
            "state": unit.state.value,
            "consecutive_failures": unit.consecutive_failures,
            "last_failure_at": unit.last_failure_at,
            "last_failure_reason": unit.last_failure_reason,
            "cooldown_remaining": cooldown_remaining,
            "effective_cooldown": (
                unit.effective_cooldown if unit.state is State.OPEN else None
            ),
            "probes_in_flight": unit.probes_in_flight,
            "probe_quota_remaining": max(
                0, unit.config.half_open_probe_quota - unit.probes_in_flight
            )
            if unit.state is State.HALF_OPEN
            else None,
            "flap_level": unit.flap_level,
            "last_transition": last_transition,
        }

    def history(self, unit_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """查询状态迁移历史；指定单元时只返回该单元的迁移。"""
        if unit_id is not None:
            self._get_unit(unit_id)
            records = [r for r in self._history if r.unit_id == unit_id]
        else:
            records = list(self._history)
        return [r.to_dict() for r in records]

    def inspect(self) -> Dict[str, Any]:
        """查看内核完整内部状态（只读快照，字典形式）。"""
        return {
            "clock": self._clock.now,
            "units": {uid: u.to_dict() for uid, u in self._units.items()},
            "history": [r.to_dict() for r in self._history],
        }

    # -- 导出 / 导入 -------------------------------------------------------------

    def export_dict(self) -> Dict[str, Any]:
        """把全部状态导出为可 JSON 序列化的字典。"""
        return {
            "version": _EXPORT_VERSION,
            "clock": self._clock.now,
            "units": [u.to_dict() for u in self._units.values()],
            "history": [r.to_dict() for r in self._history],
        }

    def export_file(self, path: str) -> None:
        """把全部状态写入 JSON 文件（键排序，保证输出确定）。"""
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.export_dict(), fh, ensure_ascii=False, indent=2,
                      sort_keys=True)
            fh.write("\n")

    def import_file(self, path: str) -> None:
        """从 JSON 文件载入状态。任何校验失败都会报错且内存状态保持不变。"""
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except OSError as exc:
            raise ImportValidationError(f"无法读取导入文件 '{path}': {exc}") from None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ImportValidationError(
                f"导入文件 '{path}' 不是合法 JSON: 第 {exc.lineno} 行第 "
                f"{exc.colno} 列: {exc.msg}"
            ) from None
        self.import_dict(data)

    def import_dict(self, data: Any) -> None:
        """从字典载入状态。先完整校验并构建新状态，校验全部通过后才替换内存。"""
        clock, units, history, seq = self._validate_import(data)
        # 校验全部通过，原子替换内存状态。
        self._clock = LogicalClock(clock)
        self._units = units
        self._history = history
        self._seq = seq

    # -- 逐条操作分发 ------------------------------------------------------------

    def apply(self, op: Dict[str, Any]) -> Any:
        """接收逐条到达的操作请求并返回结果。

        支持的操作（op 字段）：
        register / allow / report_success / report_failure / advance /
        query / history / export / import / inspect。
        """
        if not isinstance(op, dict):
            raise CircuitBreakerError(f"操作必须是字典，得到 {op!r}")
        kind = op.get("op")
        if kind == "register":
            config = None
            if "config" in op:
                config = UnitConfig.from_dict(
                    op["config"], context=f"单元 {op.get('unit_id')!r} 的注册配置"
                )
            self.register(op.get("unit_id"), config)
            return {"registered": op.get("unit_id")}
        if kind == "allow":
            return {"allowed": self.allow(self._op_unit_id(op))}
        if kind == "report_success":
            self.report_success(self._op_unit_id(op))
            return {"reported": "success"}
        if kind == "report_failure":
            self.report_failure(self._op_unit_id(op), op.get("reason", ""))
            return {"reported": "failure"}
        if kind == "advance":
            return {"now": self.advance_clock(op.get("delta", 0))}
        if kind == "query":
            return self.query(self._op_unit_id(op))
        if kind == "history":
            return {"history": self.history(op.get("unit_id"))}
        if kind == "export":
            if "path" in op:
                self.export_file(op["path"])
                return {"exported": op["path"]}
            return self.export_dict()
        if kind == "import":
            if "path" in op:
                self.import_file(op["path"])
            else:
                self.import_dict(op.get("data"))
            return {"imported": True}
        if kind == "inspect":
            return self.inspect()
        raise CircuitBreakerError(f"未知操作类型 {kind!r}")

    # -- 内部实现 ----------------------------------------------------------------

    @staticmethod
    def _op_unit_id(op: Dict[str, Any]) -> str:
        unit_id = op.get("unit_id")
        if not isinstance(unit_id, str) or not unit_id:
            raise CircuitBreakerError(
                f"操作 {op.get('op')!r} 缺少非空的 unit_id 字段"
            )
        return unit_id

    def _get_unit(self, unit_id: str) -> _Unit:
        try:
            return self._units[unit_id]
        except KeyError:
            raise UnknownUnitError(f"单元 '{unit_id}' 不存在（未注册）") from None

    def _transition(self, unit: _Unit, to_state: State, reason: str) -> None:
        record = _Transition(
            seq=self._seq,
            unit_id=unit.unit_id,
            from_state=unit.state,
            to_state=to_state,
            at=self._clock.now,
            reason=reason,
        )
        self._seq += 1
        self._history.append(record)
        unit.state = to_state

    def _open(self, unit: _Unit, reason: str) -> None:
        """进入打开状态：识别恢复抖动并计算本次实际冷却期。"""
        cfg = unit.config
        now = self._clock.now
        if (
            unit.last_open_exit_at is not None
            and now - unit.last_open_exit_at <= cfg.flapping_window_seconds
        ):
            unit.flap_level += 1
        else:
            unit.flap_level = 0
        unit.effective_cooldown = min(
            cfg.cooldown_seconds * (cfg.backoff_multiplier ** unit.flap_level),
            cfg.max_cooldown_seconds,
        )
        unit.opened_at = now
        unit.probes_in_flight = 0
        if unit.flap_level > 0:
            reason += (
                f"（检测到恢复抖动，等级 {unit.flap_level}，"
                f"冷却期加速为 {unit.effective_cooldown} 秒）"
            )
        self._transition(unit, State.OPEN, reason)

    def _maybe_exit_open(self, unit: _Unit) -> None:
        """冷却期结束后进入半开状态（幂等，非打开状态直接返回）。"""
        if unit.state is not State.OPEN:
            return
        assert unit.opened_at is not None
        if self._clock.now >= unit.opened_at + unit.effective_cooldown:
            unit.probes_in_flight = 0
            unit.last_open_exit_at = self._clock.now
            self._transition(
                unit,
                State.HALF_OPEN,
                f"冷却期 {unit.effective_cooldown} 秒结束，进入半开，"
                f"探测配额 {unit.config.half_open_probe_quota}",
            )

    def _consume_probe(self, unit: _Unit, outcome: str) -> None:
        if unit.probes_in_flight <= 0:
            raise NoInflightRequestError(
                f"单元 '{unit.unit_id}' 处于半开状态但没有在途探测请求，"
                f"无法上报{outcome}（探测配额可能为零）"
            )
        unit.probes_in_flight -= 1

    # -- 导入校验 ----------------------------------------------------------------

    def _validate_import(
        self, data: Any
    ) -> tuple[float, Dict[str, _Unit], List[_Transition], int]:
        if not isinstance(data, dict):
            raise ImportValidationError("导入数据必须是 JSON 对象")
        for key in ("version", "clock", "units", "history"):
            if key not in data:
                raise ImportValidationError(f"导入数据缺少顶层字段 '{key}'")
        if data["version"] != _EXPORT_VERSION:
            raise ImportValidationError(
                f"不支持的导出版本 {data['version']!r}，当前支持 {_EXPORT_VERSION}"
            )
        clock = data["clock"]
        if not _is_number(clock) or clock < 0:
            raise ImportValidationError(f"逻辑时钟取值非法: {clock!r}")

        if not isinstance(data["units"], list):
            raise ImportValidationError("字段 'units' 必须是数组")
        units: Dict[str, _Unit] = {}
        for index, raw_unit in enumerate(data["units"]):
            unit = self._validate_unit(raw_unit, index, clock)
            if unit.unit_id in units:
                raise ImportValidationError(
                    f"单元标识 '{unit.unit_id}' 在导入数据中重复"
                )
            units[unit.unit_id] = unit

        if not isinstance(data["history"], list):
            raise ImportValidationError("字段 'history' 必须是数组")
        history: List[_Transition] = []
        max_seq = -1
        for index, raw_record in enumerate(data["history"]):
            record = self._validate_transition(raw_record, index, units, clock)
            max_seq = max(max_seq, record.seq)
            history.append(record)
        return float(clock), units, history, max_seq + 1

    @staticmethod
    def _validate_unit(raw: Any, index: int, clock: float) -> _Unit:
        ctx = f"units[{index}]"
        if not isinstance(raw, dict):
            raise ImportValidationError(f"{ctx}: 单元记录必须是对象")
        required = {
            "unit_id", "state", "consecutive_failures", "last_failure_at",
            "opened_at", "effective_cooldown", "probes_in_flight", "flap_level",
            "last_open_exit_at", "last_failure_reason", "config",
        }
        missing = required - set(raw)
        if missing:
            raise ImportValidationError(f"{ctx}: 缺少字段 {sorted(missing)}")

        unit_id = raw["unit_id"]
        if not isinstance(unit_id, str) or not unit_id:
            raise ImportValidationError(f"{ctx}: unit_id 必须为非空字符串")
        ctx = f"单元 '{unit_id}'"

        state = State.parse(raw["state"])

        def non_negative_int(key: str) -> int:
            value = raw[key]
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise ImportValidationError(f"{ctx}: {key} 必须为非负整数")
            return value

        consecutive_failures = non_negative_int("consecutive_failures")
        probes_in_flight = non_negative_int("probes_in_flight")
        flap_level = non_negative_int("flap_level")

        def optional_time(key: str) -> Optional[float]:
            value = raw[key]
            if value is None:
                return None
            if not _is_number(value) or value < 0:
                raise ImportValidationError(f"{ctx}: {key} 必须为非负数值或 null")
            return float(value)

        last_failure_at = optional_time("last_failure_at")
        opened_at = optional_time("opened_at")
        last_open_exit_at = optional_time("last_open_exit_at")

        effective_cooldown = raw["effective_cooldown"]
        if not _is_number(effective_cooldown) or effective_cooldown < 0:
            raise ImportValidationError(
                f"{ctx}: effective_cooldown 必须为非负数值"
            )

        last_failure_reason = raw["last_failure_reason"]
        if last_failure_reason is not None and not isinstance(
            last_failure_reason, str
        ):
            raise ImportValidationError(
                f"{ctx}: last_failure_reason 必须为字符串或 null"
            )

        config = UnitConfig.from_dict(raw["config"], ctx)

        if state is State.CLOSED and consecutive_failures >= config.failure_threshold:
            raise ImportValidationError(
                f"{ctx}: 连续失败计数 {consecutive_failures} 已达到失败阈值 "
                f"{config.failure_threshold}，状态却仍为 closed，数据自相矛盾"
            )
        if probes_in_flight > config.half_open_probe_quota:
            raise ImportValidationError(
                f"{ctx}: 在途探测数 {probes_in_flight} 超过探测配额 "
                f"{config.half_open_probe_quota}"
            )
        if state is State.OPEN:
            if opened_at is None:
                raise ImportValidationError(
                    f"{ctx}: 状态为 open 时 opened_at 不得为 null"
                )
            if opened_at > clock:
                raise ImportValidationError(
                    f"{ctx}: opened_at ({opened_at}) 晚于逻辑时钟 ({clock})"
                )
            if effective_cooldown <= 0:
                raise ImportValidationError(
                    f"{ctx}: 状态为 open 时 effective_cooldown 必须为正数"
                )
            if effective_cooldown > config.max_cooldown_seconds:
                raise ImportValidationError(
                    f"{ctx}: effective_cooldown ({effective_cooldown}) 超过冷却期"
                    f"上限 {config.max_cooldown_seconds}"
                )
        if state is not State.HALF_OPEN and probes_in_flight > 0:
            raise ImportValidationError(
                f"{ctx}: 非半开状态不得有在途探测请求"
            )

        return _Unit(
            unit_id=unit_id,
            config=config,
            state=state,
            consecutive_failures=consecutive_failures,
            last_failure_at=last_failure_at,
            opened_at=opened_at,
            effective_cooldown=float(effective_cooldown),
            probes_in_flight=probes_in_flight,
            flap_level=flap_level,
            last_open_exit_at=last_open_exit_at,
            last_failure_reason=last_failure_reason,
        )

    @staticmethod
    def _validate_transition(
        raw: Any, index: int, units: Dict[str, _Unit], clock: float
    ) -> _Transition:
        ctx = f"history[{index}]"
        if not isinstance(raw, dict):
            raise ImportValidationError(f"{ctx}: 迁移记录必须是对象")
        required = {"seq", "unit_id", "from_state", "to_state", "at", "reason"}
        missing = required - set(raw)
        if missing:
            raise ImportValidationError(f"{ctx}: 缺少字段 {sorted(missing)}")
        seq = raw["seq"]
        if not isinstance(seq, int) or isinstance(seq, bool) or seq < 0:
            raise ImportValidationError(f"{ctx}: seq 必须为非负整数")
        unit_id = raw["unit_id"]
        if unit_id not in units:
            raise ImportValidationError(
                f"{ctx}: 迁移历史引用了不存在的单元 {unit_id!r}"
            )
        from_state = State.parse(raw["from_state"])
        to_state = State.parse(raw["to_state"])
        at = raw["at"]
        if not _is_number(at) or at < 0:
            raise ImportValidationError(f"{ctx}: at 必须为非负数值")
        if at > clock:
            raise ImportValidationError(
                f"{ctx}: 单元 '{unit_id}' 的迁移时刻 {at} 晚于逻辑时钟 "
                f"{clock}，数据自相矛盾"
            )
        reason = raw["reason"]
        if not isinstance(reason, str):
            raise ImportValidationError(f"{ctx}: reason 必须为字符串")
        return _Transition(
            seq=seq,
            unit_id=unit_id,
            from_state=from_state,
            to_state=to_state,
            at=float(at),
            reason=reason,
        )
