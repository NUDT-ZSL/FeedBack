"""离线可验收的资源管理内核。

本模块只依赖 Python 标准库，提供命名资源的统一登记、申请（含初始化）、
释放（含重试）、强制清理、状态查询以及 JSON 持久化所需的序列化能力。

资源状态机::

    IDLE（空闲）
      --acquire(初始化成功)--> OCCUPIED（已占用）
      --acquire(初始化失败/中断)--> IDLE（完整回退，无残留）

    OCCUPIED（已占用）
      --release(释放成功)--> RELEASED（已释放）
      --release(释放失败)--> RELEASING（释放中，等待重试）

    RELEASING（释放中）
      --retry(成功)--> RELEASED
      --retry(再次失败，未达上限)--> RELEASING
      --retry(连续失败达到上限)--> FAILED（失败，仍可被后续清理接管）

    RELEASED / FAILED
      --reset / 强制清理成功 / 重新申请--> IDLE 或 OCCUPIED

"占用计数"表示资源当前是否处于占用中：占用时恒为 1，其余状态恒为 0，
因此系统中不存在计数大于 1 的嵌套占用；它作为显式字段暴露，便于验收时
直接断言"占用归零"。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional


class ResourceState(str, Enum):
    """资源的六种合法状态。

    枚举值继承 ``str``，可直接作为 JSON 中的稳定字符串，取值分别为::

        idle        空闲
        initializing 初始化中（瞬态，仅初始化回调执行期间可见）
        occupied    已占用
        releasing   释放中（上一次释放失败，等待重试）
        released    已释放
        failed      失败（连续释放失败达到上限，仍可被清理流程接管）
    """

    IDLE = "idle"
    INITIALIZING = "initializing"
    OCCUPIED = "occupied"
    RELEASING = "releasing"
    RELEASED = "released"
    FAILED = "failed"


# 终态：占用计数恒为 0。
TERMINAL_STATES = frozenset(
    {ResourceState.RELEASED, ResourceState.FAILED}
)

# 允许重新申请的状态（计数为 0、没有归属者）。
REACQUIRABLE_STATES = frozenset(
    {
        ResourceState.IDLE,
        ResourceState.RELEASED,
        ResourceState.FAILED,
    }
)


class ResourceKernelError(Exception):
    """内核错误基类。所有抛出的错误都携带机器可读的 ``code``。"""

    code = "kernel_error"

    def __init__(self, message: str = "") -> None:
        super().__init__(message or self.code)
        self.message = message or self.code


class ResourceNotFoundError(ResourceKernelError):
    """资源名未登记。"""

    code = "resource_not_found"


class ResourceAlreadyExistsError(ResourceKernelError):
    """登记时发现资源名已存在（名字必须唯一）。"""

    code = "resource_already_exists"


class ResourceBusyError(ResourceKernelError):
    """申请被拒绝：资源正被其他归属者占用。"""

    code = "resource_busy"

    def __init__(self, name: str, owner: str) -> None:
        super().__init__(
            f"resource '{name}' is already held by owner '{owner}'"
        )
        self.name = name
        self.owner = owner


class ResourceNotOccupiedError(ResourceKernelError):
    """对未占用的资源执行释放/重试。"""

    code = "resource_not_occupied"


class InvalidStateError(ResourceKernelError):
    """操作与资源当前状态不兼容。"""

    code = "invalid_state"


# 初始化 / 释放回调：返回 None 表示成功，返回字符串表示失败原因，
# 抛出异常同样视为失败，异常文本作为原因。
Initializer = Callable[[str], Optional[str]]
Releaser = Callable[[str], Optional[str]]


@dataclass
class RetryRecord:
    """单次释放尝试的记录。"""

    attempt: int
    """第几次尝试，从 1 开始（首次 release 记为 1）。"""

    reason: str
    """本次尝试失败的原因。"""

    action: str = "release"
    """尝试来源：``release``（普通释放）或 ``force_cleanup``（强制清理）。"""

    def to_dict(self) -> Dict[str, object]:
        """序列化为可 JSON 化的普通字典。"""
        return {"attempt": self.attempt, "reason": self.reason, "action": self.action}

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "RetryRecord":
        """从字典反序列化，字段类型不符时抛出 ValueError。"""
        attempt = data.get("attempt")
        reason = data.get("reason")
        action = data.get("action", "release")
        if not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 1:
            raise ValueError("retry record 'attempt' must be a positive integer")
        if not isinstance(reason, str):
            raise ValueError("retry record 'reason' must be a string")
        if not isinstance(action, str) or action not in ("release", "force_cleanup"):
            raise ValueError(
                "retry record 'action' must be 'release' or 'force_cleanup'"
            )
        return cls(attempt=attempt, reason=reason, action=action)


@dataclass
class CleanupRecord:
    """一次强制清理中单个资源的处置结果。"""

    name: str
    """被清理的资源名。"""

    result: str
    """``success`` / ``failed`` / ``skipped``。"""

    detail: str = ""
    """成功时为空；失败为原因；跳过时说明跳过理由。"""

    def to_dict(self) -> Dict[str, object]:
        """序列化为普通字典。"""
        return {"name": self.name, "result": self.result, "detail": self.detail}

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "CleanupRecord":
        """从字典反序列化。"""
        name = data.get("name")
        result = data.get("result")
        detail = data.get("detail", "")
        if not isinstance(name, str):
            raise ValueError("cleanup record 'name' must be a string")
        if result not in ("success", "failed", "skipped"):
            raise ValueError(
                "cleanup record 'result' must be success/failed/skipped"
            )
        if not isinstance(detail, str):
            raise ValueError("cleanup record 'detail' must be a string")
        return cls(name=name, result=result, detail=detail)  # type: ignore[arg-type]


@dataclass
class Resource:
    """单个命名资源的全部运行时状态。"""

    name: str
    """唯一资源名。"""

    state: ResourceState = ResourceState.IDLE
    """当前状态。"""

    owner: Optional[str] = None
    """当前归属者标识；未占用时为 None。"""

    occupation_count: int = 0
    """占用计数：占用中为 1，否则为 0。"""

    retry_count: int = 0
    """释放尝试的连续失败累计次数；成功归零，重新申请时清零。"""

    last_failure_reason: Optional[str] = None
    """最近一次失败原因；没有失败过为 None。"""

    attempts: List[RetryRecord] = field(default_factory=list)
    """逐次释放尝试（含成功尝试）的记录。"""

    def to_dict(self) -> Dict[str, object]:
        """序列化为普通字典。"""
        return {
            "name": self.name,
            "state": self.state.value,
            "owner": self.owner,
            "occupation_count": self.occupation_count,
            "retry_count": self.retry_count,
            "last_failure_reason": self.last_failure_reason,
            "attempts": [a.to_dict() for a in self.attempts],
        }

    @classmethod
    def from_dict(cls, data: Dict[str, object]) -> "Resource":
        """从字典构造；**仅做语法/类型层面解析**，跨字段自洽性校验由
        :func:`validate_snapshot` 统一完成。"""
        name = data.get("name")
        if not isinstance(name, str) or not name:
            raise ValueError("resource 'name' must be a non-empty string")
        state_value = data.get("state")
        if not isinstance(state_value, str):
            raise ValueError(f"resource '{name}': 'state' must be a string")
        try:
            state = ResourceState(state_value)
        except ValueError:
            raise ValueError(
                f"resource '{name}': illegal state '{state_value}', "
                f"expected one of {sorted(s.value for s in ResourceState)}"
            ) from None
        owner = data.get("owner")
        if owner is not None and not isinstance(owner, str):
            raise ValueError(f"resource '{name}': 'owner' must be a string or null")
        count = data.get("occupation_count")
        if (
            not isinstance(count, int)
            or isinstance(count, bool)
            or count < 0
        ):
            raise ValueError(
                f"resource '{name}': 'occupation_count' must be a non-negative integer"
            )
        retry_count = data.get("retry_count", 0)
        if (
            not isinstance(retry_count, int)
            or isinstance(retry_count, bool)
            or retry_count < 0
        ):
            raise ValueError(
                f"resource '{name}': 'retry_count' must be a non-negative integer"
            )
        reason = data.get("last_failure_reason")
        if reason is not None and not isinstance(reason, str):
            raise ValueError(
                f"resource '{name}': 'last_failure_reason' must be a string or null"
            )
        raw_attempts = data.get("attempts", [])
        if not isinstance(raw_attempts, list):
            raise ValueError(f"resource '{name}': 'attempts' must be a list")
        attempts = [RetryRecord.from_dict(item) for item in raw_attempts]
        return cls(
            name=name,
            state=state,
            owner=owner,
            occupation_count=count,
            retry_count=retry_count,
            last_failure_reason=reason,
            attempts=attempts,
        )

    # ---- 一致性断言 ----

    def _validate_self(self) -> None:
        """校验该资源内部字段是否自洽，不自洽抛出 ValueError。"""
        if self.state == ResourceState.OCCUPIED:
            if not self.owner:
                raise ValueError(
                    f"resource '{self.name}': occupied state requires an owner"
                )
            if self.occupation_count != 1:
                raise ValueError(
                    f"resource '{self.name}': occupied state requires "
                    f"occupation_count == 1, got {self.occupation_count}"
                )
        else:
            if self.owner is not None:
                raise ValueError(
                    f"resource '{self.name}': state '{self.state.value}' must not "
                    f"carry an owner (got '{self.owner}')"
                )
            if self.occupation_count != 0:
                raise ValueError(
                    f"resource '{self.name}': state '{self.state.value}' requires "
                    f"occupation_count == 0, got {self.occupation_count}"
                )
        if len(self.attempts) < self.retry_count:
            raise ValueError(
                f"resource '{self.name}': retry_count ({self.retry_count}) cannot "
                f"exceed number of recorded attempts ({len(self.attempts)})"
            )


class ResourceKernel:
    """资源登记与生命周期管理的内核。

    线程模型：本内核为单线程顺序执行设计（CLI 逐行处理、单元测试均如此），
    不做内部加锁。初始化与释放逻辑通过构造参数注入回调，便于在测试中
    模拟失败、中断与超时。

    :param initializer: 初始化回调，签名 ``(name) -> None|str``；
        返回 None 表示成功，返回字符串或抛异常表示失败/中断。
    :param releaser: 释放回调，签名同上。
    :param max_retries: 连续释放失败的上限，达到后资源进入
        :pyattr:`ResourceState.FAILED`；必须 >= 1。
    """

    def __init__(
        self,
        initializer: Optional[Initializer] = None,
        releaser: Optional[Releaser] = None,
        max_retries: int = 3,
    ) -> None:
        if not isinstance(max_retries, int) or isinstance(max_retries, bool):
            raise TypeError("max_retries must be an integer")
        if max_retries < 1:
            raise ValueError("max_retries must be >= 1")
        self._initializer: Initializer = initializer or (lambda _name: None)
        self._releaser: Releaser = releaser or (lambda _name: None)
        self._max_retries = max_retries
        self._resources: Dict[str, Resource] = {}
        # 每个资源单调递增的尝试序号（持久化时一并保存）。
        self._attempt_seq: Dict[str, int] = {}
        # 每次 force_cleanup 的汇总记录，新记录追加在末尾。
        self._cleanup_history: List[Dict[str, object]] = []

    # ---- 内部工具 ----

    def _get(self, name: str) -> Resource:
        resource = self._resources.get(name)
        if resource is None:
            raise ResourceNotFoundError(f"resource '{name}' is not registered")
        return resource

    def _next_attempt_no(self, name: str) -> int:
        nxt = self._attempt_seq.get(name, 0) + 1
        self._attempt_seq[name] = nxt
        return nxt

    @staticmethod
    def _run_callback(callback: Callable[[str], Optional[str]], name: str) -> Optional[str]:
        """执行初始化/释放回调，把异常也归一化为失败原因字符串。

        :returns: None 表示成功；字符串表示失败原因。
        """
        try:
            result = callback(name)
        except Exception as exc:  # 初始化/释放失败是预期路径，需归一化
            return f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
        if result is None:
            return None
        reason = str(result)
        return reason or "initialization/release reported failure"

    # ---- 登记 ----

    def register(self, name: str) -> None:
        """登记一个新的命名资源，初始为空闲态。

        :raises ResourceAlreadyExistsError: 名字已存在。
        :raises ValueError: 名字不是非空字符串。
        """
        if not isinstance(name, str) or not name:
            raise ValueError("resource name must be a non-empty string")
        if name in self._resources:
            raise ResourceAlreadyExistsError(
                f"resource '{name}' is already registered"
            )
        self._resources[name] = Resource(name=name)
        self._attempt_seq[name] = 0

    # ---- 申请 / 初始化回退 ----

    def acquire(self, name: str, owner: str) -> None:
        """申请并初始化资源，成功后归属 ``owner``，占用计数置 1。

        初始化失败或回调被异常打断时，资源**完整回退到空闲态**：
        归属者清空、计数归 0、瞬态 ``initializing`` 不留存、尝试序号不变。

        :raises ResourceNotFoundError: 资源未登记。
        :raises ResourceBusyError: 资源正被占用，错误信息含当前持有者。
        :raises InvalidStateError: 资源处于 releasing 等不允许申请的状态。
        :raises ValueError: owner 不是非空字符串；初始化失败时抛出携带原因的
            此异常（资源已先回退到空闲）。
        """
        if not isinstance(owner, str) or not owner:
            raise ValueError("owner must be a non-empty string")
        resource = self._get(name)

        if resource.state == ResourceState.OCCUPIED:
            assert resource.owner is not None
            raise ResourceBusyError(name, resource.owner)
        if resource.state in (ResourceState.INITIALIZING, ResourceState.RELEASING):
            raise InvalidStateError(
                f"resource '{name}' is {resource.state.value}, try again later"
            )
        # IDLE / RELEASED / FAILED 均可重新申请：先清干净上一轮痕迹。
        resource.state = ResourceState.INITIALIZING
        resource.owner = None
        resource.occupation_count = 0
        resource.retry_count = 0
        resource.last_failure_reason = None
        resource.attempts = []
        self._attempt_seq[name] = 0

        reason = self._run_callback(self._initializer, name)
        if reason is not None:
            # 关键不变量：初始化中断必须完整回退，绝不留半初始化状态。
            resource.state = ResourceState.IDLE
            resource.owner = None
            resource.occupation_count = 0
            resource.retry_count = 0
            resource.last_failure_reason = reason
            resource.attempts = []
            self._attempt_seq[name] = 0
            raise InvalidStateError(
                f"resource '{name}' initialization failed and was rolled back: {reason}"
            )

        resource.state = ResourceState.OCCUPIED
        resource.owner = owner
        resource.occupation_count = 1

    # ---- 释放 / 重试 ----

    def release(self, name: str) -> None:
        """释放已占用资源；失败则进入释放中并累计一次失败。

        连续失败次数达到 ``max_retries`` 时进入失败态；未达上限停留在
        释放中，等待 :meth:`retry`。无论成功失败，调用返回后资源都不会
        残留在"名义占用但无人负责"的状态。

        :raises ResourceNotFoundError: 资源未登记。
        :raises ResourceNotOccupiedError: 资源当前未被占用。
        """
        resource = self._get(name)
        if resource.state != ResourceState.OCCUPIED:
            raise ResourceNotOccupiedError(
                f"resource '{name}' is not occupied (state={resource.state.value})"
            )
        self._attempt_release(resource, action="release")

    def retry(self, name: str) -> None:
        """对停留在释放中（或失败态）的资源再次尝试释放。

        释放中状态下重试成功则进入已释放；再次失败累计次数，达到上限转入
        失败态。失败态资源也可被本方法接管继续尝试（例如外部依赖恢复后），
        一旦成功即进入已释放、占用归零。

        :raises ResourceNotFoundError: 资源未登记。
        :raises ResourceNotOccupiedError: 资源当前不在 releasing/failed。
        """
        resource = self._get(name)
        if resource.state not in (ResourceState.RELEASING, ResourceState.FAILED):
            raise ResourceNotOccupiedError(
                f"resource '{name}' has no pending release "
                f"(state={resource.state.value})"
            )
        self._attempt_release(resource, action="release")

    def _attempt_release(self, resource: Resource, action: str) -> None:
        """执行一次释放尝试并更新状态机（release/retry/force_cleanup 共用）。"""
        name = resource.name
        attempt_no = self._next_attempt_no(name)
        # 尝试期间为瞬态 releasing；占用计数在进入释放流程时即已交出归属。
        prev_state = resource.state
        if prev_state == ResourceState.OCCUPIED:
            resource.owner = None
            resource.occupation_count = 0
        resource.state = ResourceState.RELEASING

        reason = self._run_callback(self._releaser, name)
        if reason is None:
            resource.state = ResourceState.RELEASED
            resource.owner = None
            resource.occupation_count = 0
            resource.retry_count = 0
            resource.last_failure_reason = None
            resource.attempts.append(
                RetryRecord(attempt=attempt_no, reason="", action=action)
            )
            return

        resource.retry_count += 1
        resource.last_failure_reason = reason
        resource.attempts.append(
            RetryRecord(attempt=attempt_no, reason=reason, action=action)
        )
        if resource.retry_count >= self._max_retries:
            # 达到上限：进入失败态，但仍保留登记，可被后续清理接管。
            resource.state = ResourceState.FAILED
        else:
            resource.state = ResourceState.RELEASING

    # ---- 强制清理 ----

    def force_cleanup(self) -> Dict[str, object]:
        """对全部资源做一次强制清理，逐个尝试释放，互不影响。

        处置分类：

        * ``success``：原本占用/释放中/失败的资源，本次释放成功；
        * ``failed``：本次释放仍失败（失败态资源重试后仍失败也归此类）；
        * ``skipped``：已经是 released 或 idle，无需释放。

        单个资源抛错不会中断其余资源。返回汇总字典，并追加到清理历史。
        """
        succeeded: List[str] = []
        failed: List[CleanupRecord] = []
        skipped: List[CleanupRecord] = []

        for name in sorted(self._resources):
            resource = self._resources[name]
            try:
                if resource.state in (
                    ResourceState.OCCUPIED,
                    ResourceState.RELEASING,
                    ResourceState.FAILED,
                ):
                    self._attempt_release(resource, action="force_cleanup")
                    if resource.state == ResourceState.RELEASED:
                        succeeded.append(name)
                    else:
                        failed.append(
                            CleanupRecord(
                                name=name,
                                result="failed",
                                detail=resource.last_failure_reason
                                or "release failed",
                            )
                        )
                else:
                    skipped.append(
                        CleanupRecord(
                            name=name,
                            result="skipped",
                            detail=f"state={resource.state.value}",
                        )
                    )
            except Exception as exc:  # 防御性：单个资源失败绝不影响其他资源
                failed.append(
                    CleanupRecord(
                        name=name,
                        result="failed",
                        detail=f"{type(exc).__name__}: {exc}",
                    )
                )

        # 需要人工处理：失败态 + 仍在释放中 + 任何计数未归零者。
        manual = [
            name
            for name in sorted(self._resources)
            if self._resources[name].state
            in (ResourceState.FAILED, ResourceState.RELEASING)
            or self._resources[name].occupation_count != 0
        ]
        summary: Dict[str, object] = {
            "succeeded": succeeded,
            "failed": [item.to_dict() for item in failed],
            "skipped": [item.to_dict() for item in skipped],
            "manual_review": manual,
        }
        self._cleanup_history.append(summary)
        return summary

    # ---- 重置 ----

    def reset(self, name: str) -> None:
        """把已释放/失败的资源重置为干净的空闲态（清掉全部历史字段）。

        :raises InvalidStateError: 资源仍占用或处于释放流程中。
        """
        resource = self._get(name)
        if resource.state not in (ResourceState.RELEASED, ResourceState.FAILED, ResourceState.IDLE):
            raise InvalidStateError(
                f"resource '{name}' in state {resource.state.value} cannot be reset"
            )
        resource.state = ResourceState.IDLE
        resource.owner = None
        resource.occupation_count = 0
        resource.retry_count = 0
        resource.last_failure_reason = None
        resource.attempts = []
        self._attempt_seq[name] = 0

    # ---- 查询 ----

    def status(self, name: str) -> Dict[str, object]:
        """返回单个资源的完整状态字典（字段名稳定，可直接 JSON 序列化）。"""
        resource = self._get(name)
        return {
            "name": resource.name,
            "state": resource.state.value,
            "owner": resource.owner,
            "occupation_count": resource.occupation_count,
            "retry_count": resource.retry_count,
            "last_failure_reason": resource.last_failure_reason,
            "attempts": [a.to_dict() for a in resource.attempts],
        }

    def list_unreleased(self) -> List[Dict[str, object]]:
        """列出所有占用未归零的资源，按资源名字典序返回。

        判定标准是 ``occupation_count != 0``——即当前仍被占用的资源；
        已释放/失败/释放中的资源计数均为 0，不在"未归零"之列（它们的
        异常状态通过 status/失败清单另行暴露）。
        """
        return [
            self.status(name)
            for name in sorted(self._resources)
            if self._resources[name].occupation_count != 0
        ]

    def list_all(self) -> List[Dict[str, object]]:
        """列出全部资源状态，按资源名字典序稳定返回。"""
        return [self.status(name) for name in sorted(self._resources)]

    def is_clean(self, name: str) -> bool:
        """资源占用是否已归零（计数为 0 且无归属者）。"""
        resource = self._get(name)
        return resource.occupation_count == 0 and resource.owner is None

    # ---- 序列化 / 反序列化 ----

    def to_snapshot(self) -> Dict[str, object]:
        """导出内核完整状态为可 JSON 化的快照字典。"""
        return {
            "version": 1,
            "max_retries": self._max_retries,
            "resources": [
                self._resources[name].to_dict() for name in sorted(self._resources)
            ],
            "attempt_seq": {
                name: self._attempt_seq.get(name, 0)
                for name in sorted(self._resources)
            },
            "cleanup_history": list(self._cleanup_history),
        }

    def load_snapshot(self, snapshot: Dict[str, object]) -> None:
        """从快照字典载入并**整体替换**当前状态。

        先在临时对象上完成全部解析与校验，任何错误都不会改动当前内存状态。

        :raises ValueError: 快照结构损坏、字段缺失或自洽性校验失败。
        """
        resources, attempt_seq, max_retries, history = validate_snapshot(snapshot)
        # 校验通过后才一次性提交。
        self._resources = resources
        self._attempt_seq = attempt_seq
        self._max_retries = max_retries
        self._cleanup_history = history


def validate_snapshot(
    snapshot: object,
) -> "tuple[Dict[str, Resource], Dict[str, int], int, List[Dict[str, object]]]":
    """校验快照并返回解析后的内核组成部分。

    校验内容：顶层结构、版本、max_retries；资源名唯一非空；状态合法；
    占用计数非负；归属者与状态自洽（占用必须有 owner 且计数为 1，
    非占用必须无 owner 且计数为 0）；尝试序号自洽。

    :raises ValueError: 任意校验失败，错误信息指出具体资源与字段。
    """
    if not isinstance(snapshot, dict):
        raise ValueError("snapshot must be a JSON object")
    if "resources" not in snapshot:
        raise ValueError("snapshot missing required field 'resources'")
    if "version" not in snapshot:
        raise ValueError("snapshot missing required field 'version'")

    version = snapshot["version"]
    if version != 1:
        raise ValueError(f"unsupported snapshot version: {version!r} (supported: 1)")

    max_retries = snapshot.get("max_retries", 3)
    if (
        not isinstance(max_retries, int)
        or isinstance(max_retries, bool)
        or max_retries < 1
    ):
        raise ValueError("'max_retries' must be a positive integer")

    raw_resources = snapshot["resources"]
    if not isinstance(raw_resources, list):
        raise ValueError("'resources' must be a list")

    resources: Dict[str, Resource] = {}
    for item in raw_resources:
        if not isinstance(item, dict):
            raise ValueError("each resource entry must be an object")
        resource = Resource.from_dict(item)
        if resource.name in resources:
            raise ValueError(f"duplicate resource name: '{resource.name}'")
        resource._validate_self()
        resources[resource.name] = resource

    attempt_seq: Dict[str, int] = {}
    raw_seq = snapshot.get("attempt_seq", {})
    if not isinstance(raw_seq, dict):
        raise ValueError("'attempt_seq' must be an object")
    for key, value in raw_seq.items():
        if not isinstance(key, str):
            raise ValueError("attempt_seq keys must be strings")
        if key not in resources:
            raise ValueError(f"attempt_seq references unknown resource '{key}'")
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError(
                f"attempt_seq['{key}'] must be a non-negative integer"
            )
        attempt_seq[key] = value
    # 每个登记资源都有序号，且不小于已记录的尝试数。
    for name, resource in resources.items():
        seq = attempt_seq.get(name, 0)
        if seq < len(resource.attempts):
            raise ValueError(
                f"resource '{name}': attempt_seq ({seq}) is behind "
                f"recorded attempts ({len(resource.attempts)})"
            )
        attempt_seq.setdefault(name, seq)

    history = snapshot.get("cleanup_history", [])
    if not isinstance(history, list):
        raise ValueError("'cleanup_history' must be a list")
    cleaned_history: List[Dict[str, object]] = []
    for entry in history:
        if not isinstance(entry, dict):
            raise ValueError("each cleanup_history entry must be an object")
        for key in ("succeeded", "failed", "skipped", "manual_review"):
            if key not in entry:
                raise ValueError(f"cleanup_history entry missing field '{key}'")
            if not isinstance(entry[key], list):
                raise ValueError(f"cleanup_history field '{key}' must be a list")
        cleaned_history.append(dict(entry))

    return resources, attempt_seq, max_retries, cleaned_history
