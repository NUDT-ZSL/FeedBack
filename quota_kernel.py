"""分层令牌配额内核（Hierarchical Token Quota Kernel）。

本模块实现一棵配额层级树：每个节点是一个独立的令牌桶，拥有稳态容量
``capacity``、稳态补充速率 ``rate`` 以及一次性的突发容量 ``burst_capacity``。
一次到达某个节点的请求，必须在从该节点到根的**每一层**都凑够令牌才会被
接受；任意一层不足即整笔拒绝，并返回从请求节点一路向上的拒绝原因链。

核心记账规则（所有规则均为确定性规则，不依赖 wall clock、随机数或字典迭代
顺序，同一输入序列永远得到同一结果）：

1. 层级约束
   - 每个节点有非空唯一标识、至多一个父节点；根没有父节点，全树唯一。
   - 只允许把新节点挂到已存在且启用的节点下，因此不可能出现环或孤儿。
   - 同一父节点的子节点在所有输出中按标识字典序排列。

2. 双桶模型
   - 稳态桶 ``steady``：上限 ``capacity``，按 ``rate`` 个令牌/逻辑时间单位
     连续补充；桶满后新产出的令牌溢出（令牌桶的标准语义，不算凭空消失）。
   - 突发桶 ``burst``：上限 ``burst_capacity``，**一次性**、永不自动补充，
     专门用于短时超过稳态速率的应急消耗；突发容量为 0 表示无突发能力。
   - 节点被禁用期间稳态桶冻结（不补充），突发桶本来就只减不增。

3. 分层扣账与借用
   - 请求 n 个令牌时沿路径**自叶向根**逐层判定，每一层都要为整笔 n
     独立记账：本层先把直接子节点的借入需求用自己的**稳态**桶全额垫付
     （突发桶不外借），剩余的 n-垫付额 再依次用本层稳态桶、突发桶支付，
     仍不足才向直接父节点借入。根无父可借，凑不齐即整笔拒绝。
   - 借入的令牌"即借即耗"，不进入借入方稳态桶，且**不得转贷**：父节点
     只能借出自己稳态桶里真实存在的令牌，因此同一份令牌不可能被重复
     借出；借出使父节点 ``steady`` 减少、未还借出总额 ``out`` 增加，
     ``steady + out`` 守恒，天然满足
     ``steady + out <= capacity``（剩余加借出不超过容量）。
   - 每笔借用记录借出方、借入方、数量和逻辑时刻，编号单调递增。
   - 偿还顺序为 FIFO：按借用时刻、同刻按借用编号先后偿还；部分偿还合法，
     每次偿还后贷款余额为正，结清才销记。

4. 偿还与回落
   - 时间推进时，节点新补充出来的令牌**优先**按 FIFO 偿还上游借款，剩余
     部分才注入自己的稳态桶（注入上限为 ``capacity - out``），再剩余溢出。
   - 偿还沿借用链向上传播：父节点收回的令牌若仍欠其父，继续向上偿还。
   - 突发桶只减不增，用尽后所有消耗只能依赖稳态补充速率，因而平滑回落到
     稳态速率；所有令牌变动都有明确的来源/去向，不存在凭空增减。

5. 禁用与删除
   - 禁用：节点冻结，不再补充、不再受理请求，且其子孙的请求因链路经过它
     而被拒绝；禁用瞬间用其稳态桶余额立即 FIFO 偿还上游债务，还不起的
     部分作为"冻结债务"保留，启用后继续偿还；它对下游的借出不强制收回，
     不影响其他子节点，下游自然偿还时照常回收（还款可穿过禁用节点继续
     向上传播）。
   - 删除：只允许删除叶子节点（有子节点必须先删子节点）；先用稳态桶余额
     FIFO 偿还上游债务，仍无法偿还的部分（早已被消耗的令牌）由父节点
     **核销**并在结果中给出明细，随后移除节点。叶子不可能有对外借出。

6. 序列化
   - :meth:`QuotaKernel.to_dict` / :meth:`QuotaKernel.from_dict` 负责 JSON
     友好的导出/导入；导入执行完整校验，任一错误都抛出
     :class:`QuotaImportError`，且导入在全新对象上进行，失败时原内核状态
     字节不变。

逻辑时钟由外部注入（:meth:`QuotaKernel.advance_clock`），只能单调前进，
回退直接报错。申请的令牌数量必须是正整数；容量、速率、突发容量为有限的
非负数（int 或 float）。
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, field
from typing import Any, Optional, TextIO

# ---------------------------------------------------------------------------
# 错误类型
# ---------------------------------------------------------------------------


class QuotaError(Exception):
    """所有配额内核错误的基类；尽量携带定位用的节点标识。"""

    def __init__(self, message: str, node_id: Optional[str] = None) -> None:
        super().__init__(message)
        self.node_id = node_id


class NodeNotFoundError(QuotaError):
    """引用了不存在的节点。"""


class DuplicateNodeError(QuotaError):
    """节点标识非空且在整棵树中唯一，重复创建报此错误。"""


class NodeDisabledError(QuotaError):
    """结构变更操作指向了被禁用的节点（如在其下创建子节点）。"""


class NodeHasChildrenError(QuotaError):
    """删除非叶子节点：必须先删除其全部子节点。"""


class CycleDetectedError(QuotaError):
    """导入数据中的父节点指针形成了环。"""


class InvalidConfigError(QuotaError):
    """容量/速率/突发容量/数量等参数非法。"""


class ClockRollbackError(QuotaError):
    """逻辑时钟只能单调前进，回退时报错。"""


class QuotaImportError(QuotaError):
    """导出文件损坏、字段缺失或未通过一致性校验。"""


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


@dataclass
class Loan:
    """一笔借用记录。

    :ivar loan_id: 全树唯一、单调递增的借用编号（导出为 ``"L1"`` 等）。
    :ivar lender_id: 借出方（借入方的直接父节点）。
    :ivar borrower_id: 借入方。
    :ivar amount: 当前未还余额；部分偿还后减小，结清即销记，只要存在必为正。
    :ivar created_at: 借用发生时的逻辑时钟值。
    """

    loan_id: str
    lender_id: str
    borrower_id: str
    amount: float
    created_at: float

    def to_dict(self) -> dict[str, Any]:
        """序列化为 JSON 友好的字典。"""
        return {
            "id": self.loan_id,
            "lender_id": self.lender_id,
            "borrower_id": self.borrower_id,
            "amount": _num(self.amount),
            "time": self.created_at,
        }


@dataclass
class Node:
    """配额层级中的一个节点（一个双层令牌桶）。

    ``loans_in`` 是本节点作为借入方的 FIFO 队列；``loans_out`` 是本节点
    作为借出方的贷款集合（顺序同样按借用先后）。两处存放同一个 :class:`Loan`
    对象引用，结清时同时摘除。
    """

    node_id: str
    parent_id: Optional[str]
    capacity: float
    rate: float
    burst_capacity: float
    steady: float
    burst: float
    enabled: bool = True
    created_at: float = 0.0
    loans_in: list[Loan] = field(default_factory=list)
    loans_out: list[Loan] = field(default_factory=list)

    @property
    def borrowed_out(self) -> float:
        """已借出且未收回的令牌总额。"""
        return sum(loan.amount for loan in self.loans_out)

    @property
    def borrowed_in(self) -> float:
        """已借入且未偿还的令牌总额。"""
        return sum(loan.amount for loan in self.loans_in)

    @property
    def burst_used(self) -> float:
        """突发桶已消耗量。"""
        return self.burst_capacity - self.burst

    def to_dict(self) -> dict[str, Any]:
        """序列化为 JSON 友好的字典（借用记录在文件顶层统一存放）。"""
        return {
            "id": self.node_id,
            "parent_id": self.parent_id,
            "capacity": _num(self.capacity),
            "rate": _num(self.rate),
            "burst_capacity": _num(self.burst_capacity),
            "steady": _num(self.steady),
            "burst": _num(self.burst),
            "enabled": self.enabled,
            "created_at": self.created_at,
        }


@dataclass
class LayerDecision:
    """请求在一层上的判定明细，用于成功审计与拒绝原因链。

    每层都必须为整笔请求记账 ``required``，其构成为：借给直接子节点的
    ``lent_to_child``（只能出自本层稳态桶）、本层自身消耗的稳态/突发令牌
    ``steady_paid``/``burst_paid``，以及仍不足而向直接父节点借入的
    ``borrowed``（借入即耗，不得转贷）。
    """

    node_id: str
    depth: int
    required: float
    steady_before: float
    burst_before: float
    borrowable: float
    lent_to_child: float = 0.0
    steady_paid: float = 0.0
    burst_paid: float = 0.0
    borrowed: float = 0.0
    status: str = "ok"  # ok / insufficient / disabled / not_evaluated
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        """序列化为 JSON 友好的字典。"""
        return {
            "node_id": self.node_id,
            "depth_from_request": self.depth,
            "required": self.required,
            "steady_available": _num(self.steady_before),
            "burst_available": _num(self.burst_before),
            "borrowable_from_parent": _num(self.borrowable),
            "lent_to_child": _num(self.lent_to_child),
            "steady_paid": _num(self.steady_paid),
            "burst_paid": _num(self.burst_paid),
            "borrowed": _num(self.borrowed),
            "status": self.status,
            "reason": self.reason,
        }


@dataclass
class Decision:
    """一次令牌申请的完整判定结果。

    成功时 ``ok`` 为 ``True``，``layers`` 给出沿路径每层的扣账明细；拒绝时
    ``ok`` 为 ``False``，``failing_node_id`` 指向第一个（最靠近根的）无法
    凑齐令牌的层，``reason_code`` 给出规则名，``layers`` 自请求节点向根
    排列构成完整原因链，拒绝不产生任何状态变更。
    """

    ok: bool
    node_id: str
    amount: int
    time: float
    layers: list[LayerDecision]
    failing_node_id: Optional[str] = None
    reason_code: str = ""
    message: str = ""
    loans_created: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """序列化为 JSON 友好的字典。"""
        return {
            "ok": self.ok,
            "node_id": self.node_id,
            "amount": self.amount,
            "time": self.time,
            "failing_node_id": self.failing_node_id,
            "reason_code": self.reason_code,
            "message": self.message,
            "loans_created": list(self.loans_created),
            "reason_chain": [layer.to_dict() for layer in self.layers],
        }


def _num(value: float) -> float | int:
    """把整数值的浮点计数渲染成 int，保证输出整洁、可比对。"""
    if isinstance(value, bool):  # bool 是 int 的子类，显式排除
        return int(value)
    if float(value).is_integer():
        return int(value)
    return value


def _non_negative_number(value: Any, what: str, node_id: Optional[str] = None) -> float:
    """校验并返回有限的非负数值。

    :param value: 待校验值，接受 int/float（拒绝 bool、NaN、无穷）。
    :param what: 字段名，用于错误信息定位。
    :param node_id: 关联节点标识，用于错误信息定位。
    :raises InvalidConfigError: 值不是有限非负数。
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InvalidConfigError(f"{what} 必须是非负数值，实际为 {value!r}", node_id)
    if not math.isfinite(float(value)) or value < 0:
        raise InvalidConfigError(f"{what} 必须是有限的非负数，实际为 {value!r}", node_id)
    return float(value)


def _positive_int_amount(value: Any, what: str = "申请数量") -> int:
    """校验令牌申请数量为正整数。"""
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise InvalidConfigError(f"{what}必须是正整数，实际为 {value!r}")
    return value


# ---------------------------------------------------------------------------
# 内核
# ---------------------------------------------------------------------------

_EPS = 1e-9


def _loan_sort_key(loan_id: str) -> tuple[int, str]:
    """借用记录的确定性排序键：``L<n>`` 按序号排，其他 ID 退化为字典序。"""
    if len(loan_id) > 1 and loan_id[0] == "L" and loan_id[1:].isdigit():
        return (0, f"{int(loan_id[1:]):020d}")
    return (1, loan_id)
class QuotaKernel:
    """分层令牌配额内核。

    通过内部字典保存节点与借用记录，逻辑时钟从 0 开始。所有遍历在需要
    确定性的地方都按节点标识字典序排序；请求逐条串行处理，同一操作序列
    必定得到同一状态迁移与判定结果。
    """

    FORMAT_VERSION = 1

    def __init__(self) -> None:
        """创建一个空层级，逻辑时钟为 0。"""
        self._nodes: dict[str, Node] = {}
        self._children: dict[str, set[str]] = {}
        self._loans: dict[str, Loan] = {}
        self._loan_seq: int = 0
        self._clock: float = 0.0
        self._last_rejection: dict[str, dict[str, Any]] = {}

    # -- 基础查询 --------------------------------------------------------

    @property
    def clock(self) -> float:
        """当前逻辑时钟值。"""
        return self._clock

    def __len__(self) -> int:
        """层级中的节点数。"""
        return len(self._nodes)

    def __contains__(self, node_id: str) -> bool:
        """节点是否存在。"""
        return node_id in self._nodes

    def _get(self, node_id: str) -> Node:
        """取节点，不存在则抛 :class:`NodeNotFoundError`。"""
        node = self._nodes.get(node_id)
        if node is None:
            raise NodeNotFoundError(f"节点 {node_id!r} 不存在", node_id)
        return node

    def root_id(self) -> Optional[str]:
        """返回根节点标识；空层级返回 ``None``。"""
        for node_id, node in self._nodes.items():
            if node.parent_id is None:
                return node_id
        return None

    def children(self, node_id: str) -> list[str]:
        """返回直接子节点标识，按字典序稳定排列。"""
        self._get(node_id)
        return sorted(self._children.get(node_id, ()))

    def descendants(self, node_id: str) -> list[str]:
        """返回全部后代节点标识（先序、每层按字典序）。"""
        self._get(node_id)
        out: list[str] = []
        stack: list[str] = [node_id]
        while stack:
            current = stack.pop()
            if current != node_id:
                out.append(current)
            kids = self.children(current)  # 已按字典序排列
            stack.extend(reversed(kids))  # 逆序压栈，保证出栈为字典序
        return out

    def _path_to_root(self, node_id: str) -> list[Node]:
        """返回请求节点 → 根的路径（含两端）。结构上无环，必然终止。"""
        path: list[Node] = []
        current: Optional[str] = node_id
        seen: set[str] = set()
        while current is not None:
            if current in seen:  # 防御性检查：正常结构变更不可能触发
                raise CycleDetectedError(f"节点 {current!r} 的父链中存在环", current)
            seen.add(current)
            node = self._get(current)
            path.append(node)
            current = node.parent_id
        return path

    # -- 时钟与补充 ------------------------------------------------------

    def advance_clock(self, t: Any) -> float:
        """把逻辑时钟推进到 ``t`` 并让所有节点补充/偿还。

        :param t: 目标时刻，必须是有限数值且不小于当前时钟。
        :raises ClockRollbackError: ``t`` 小于当前时钟。
        :return: 推进后的时钟值。
        """
        if isinstance(t, bool) or not isinstance(t, (int, float)) or not math.isfinite(float(t)):
            raise InvalidConfigError(f"逻辑时刻必须是有限数值，实际为 {t!r}")
        if t < self._clock:
            raise ClockRollbackError(
                f"逻辑时钟不允许回退：当前 {_num(self._clock)}，收到 {_num(float(t))}"
            )
        if t > self._clock:
            # 按拓扑序（叶 → 根，同深度按标识字典序）补充：子节点先补充并
            # 偿还父节点，父节点在收到还款、释放被借出占用的容量后再补充
            # 自己，避免顺序敏感的溢出，保证结果只取决于输入而与 ID 无关。
            ordered = sorted(
                self._nodes,
                key=lambda nid: (-self._depth(nid), nid),
            )
            for node_id in ordered:
                self._refill_node(self._nodes[node_id], float(t))
            self._clock = float(t)
        return self._clock

    def _depth(self, node_id: str) -> int:
        """返回节点到根的距离（根为 0）。"""
        depth = 0
        current: Optional[str] = node_id
        while True:
            parent = self._nodes[current].parent_id
            if parent is None:
                return depth
            depth += 1
            current = parent

    def _refill_node(self, node: Node, t: float) -> None:
        """按速率把一个节点补充到时刻 ``t``，并按 FIFO 偿还上游借款。

        禁用节点在禁用期间不补充；无论是否禁用，节点都可以接收下游偿还
        （回收不是补充）。新补充出的令牌先还债（直接交给贷方，不进本节点
        稳态桶），还债后剩余的令牌再注入稳态桶，注满（容量上限扣除尚未
        收回的借出）后溢出。
        """
        elapsed = t - self._clock  # 本轮所有节点经历同样的时长
        if elapsed <= 0 or not node.enabled or node.rate <= 0:
            return
        supply = node.rate * elapsed
        leftover = self._pay_upstream(node, supply, from_bucket=False)
        if leftover > 0:
            room = node.capacity - node.borrowed_out - node.steady
            if room > 0:
                node.steady += min(leftover, room)

    def _pay_upstream(self, payer: Node, cash: float, from_bucket: bool) -> float:
        """让 ``payer`` 用一笔现金按 FIFO 沿借用链（父→祖父→…）偿还。

        每一跳交给直接父节点的金额为 ``min(可支配现金, 未还债务总额)``，
        再按 FIFO 逐笔销账；只有父节点实际收到的金额可以继续向祖父节点
        传播，首跳还债后剩下的现金仍属于 ``payer``，作为返回值交回调用方。

        :param from_bucket: 为 ``True`` 时现金原本就在 ``payer.steady`` 中
            （删除/禁用时的即时偿还），首跳需要从桶里扣款；为 ``False`` 时
            现金是尚未入桶的新补充令牌，首跳不扣桶。第二跳起钱都已在
            上一跳的 ``steady`` 中，统一扣款。
        :return: 首跳还债后仍属于 ``payer``、可由调用方处置的现金余额。
        """
        first_hop_total = min(cash, payer.borrowed_in)
        current = payer
        available = cash
        first_hop = True
        while available > 0 and current.loans_in:
            up = min(available, current.borrowed_in)
            if from_bucket or not first_hop:
                current.steady -= up
            # 债主恒为直接父节点；按 FIFO 逐笔减少。
            parent = self._nodes[current.parent_id]  # type: ignore[arg-type]
            rest = up
            while rest > 0:
                loan = current.loans_in[0]
                part = min(rest, loan.amount)
                loan.amount -= part
                rest -= part
                if loan.amount <= _EPS:
                    loan.amount = 0.0
                    current.loans_in.pop(0)
                    parent.loans_out.remove(loan)
                    del self._loans[loan.loan_id]
            parent.steady += up
            current = parent
            available = up
            first_hop = False
        return cash - first_hop_total

    # -- 结构变更 --------------------------------------------------------

    def create_node(
        self,
        node_id: str,
        capacity: Any,
        rate: Any,
        parent_id: Optional[str] = None,
        burst_capacity: Any = 0,
        t: Any = None,
    ) -> dict[str, Any]:
        """创建一个配额节点。

        新节点稳态桶初始为满（冷启动即有完整容量），突发桶初始为满。
        空层级中第一个节点必须无根（成为根）；此后根唯一，新增节点必须
        挂到已存在且**启用中**的父节点下。

        :param node_id: 非空字符串标识，全树唯一。
        :param capacity: 稳态容量，有限非负数。
        :param rate: 稳态补充速率（令牌/逻辑时间单位），有限非负数。
        :param parent_id: 父节点标识；建根时为 ``None``。
        :param burst_capacity: 一次性突发容量，有限非负数，默认 0。
        :param t: 可选逻辑时刻，先推进时钟再创建。
        :raises DuplicateNodeError: 标识为空或重复。
        :raises NodeNotFoundError: 父节点不存在。
        :raises NodeDisabledError: 父节点被禁用。
        :raises InvalidConfigError: 容量/速率/突发容量非法，或无根/多根。
        """
        if t is not None:
            self.advance_clock(t)
        if not isinstance(node_id, str) or not node_id:
            raise InvalidConfigError(f"节点标识必须是非空字符串，实际为 {node_id!r}", node_id)
        if node_id in self._nodes:
            raise DuplicateNodeError(f"节点标识 {node_id!r} 已存在", node_id)
        cap = _non_negative_number(capacity, "容量(capacity)", node_id)
        r = _non_negative_number(rate, "补充速率(rate)", node_id)
        burst_cap = _non_negative_number(burst_capacity, "突发容量(burst_capacity)", node_id)

        existing_root = self.root_id()
        if parent_id is None:
            if existing_root is not None:
                raise InvalidConfigError(
                    f"根节点 {existing_root!r} 已存在，新节点 {node_id!r} 必须指定父节点",
                    node_id,
                )
        else:
            parent = self._nodes.get(parent_id)
            if parent is None:
                raise NodeNotFoundError(
                    f"无法创建节点 {node_id!r}：父节点 {parent_id!r} 不存在", parent_id
                )
            if not parent.enabled:
                raise NodeDisabledError(
                    f"无法在禁用节点 {parent_id!r} 下创建子节点 {node_id!r}", parent_id
                )
        node = Node(
            node_id=node_id,
            parent_id=parent_id,
            capacity=cap,
            rate=r,
            burst_capacity=burst_cap,
            steady=cap,
            burst=burst_cap,
            enabled=True,
            created_at=self._clock,
        )
        self._nodes[node_id] = node
        self._children[node_id] = set()
        if parent_id is not None:
            self._children[parent_id].add(node_id)
        return self.node_status(node_id)

    def disable_node(self, node_id: str, t: Any = None) -> dict[str, Any]:
        """禁用节点：冻结补充、拒绝受理，立即用桶余额偿还上游债务。

        还不起的部分作为冻结债务保留；对下游的借出不强制收回。禁用一个
        已经禁用的节点是幂等无操作。已禁用节点的子孙请求会因链路中断被拒。

        :return: 含 ``repaid``（本次即时偿还明细）与 ``frozen_debt``
            （冻结债务余额）的字典。
        """
        if t is not None:
            self.advance_clock(t)
        node = self._get(node_id)
        repaid: list[dict[str, Any]] = []
        if node.enabled:
            before = self._snapshot_debts(node)
            self._repay_from_bucket(node)
            repaid = self._diff_debts(node, before)
            node.enabled = False
        return {
            "node_id": node_id,
            "enabled": False,
            "repaid": repaid,
            "frozen_debt": _num(node.borrowed_in),
        }

    def enable_node(self, node_id: str, t: Any = None) -> dict[str, Any]:
        """重新启用节点；禁用期间不追补令牌，冻结债务仍然有效。

        启用是幂等的。启用之后的下一次时钟推进起，节点恢复补充且新令牌
        优先偿还冻结债务。
        """
        if t is not None:
            self.advance_clock(t)
        node = self._get(node_id)
        node.enabled = True
        return self.node_status(node_id)

    def delete_node(self, node_id: str, t: Any = None) -> dict[str, Any]:
        """删除叶子节点，安全回收/偿还/核销其全部债务。

        步骤（任一步都不影响无关节点，且所有祖先始终满足
        ``steady + out <= capacity``）：

        1. 非叶子节点拒绝删除（先删子节点）；
        2. 用稳态桶余额按 FIFO 即时向上偿还；
        3. 仍未偿还的债务说明令牌已被消耗，由各借出方核销，核销明细随
           结果返回；
        4. 叶子不可能有对外借出，断言成立后摘除节点。

        突发桶是节点独立的应急账本，随节点一并移除，不影响祖先。
        """
        if t is not None:
            self.advance_clock(t)
        node = self._get(node_id)
        kids = self._children.get(node_id, set())
        if kids:
            raise NodeHasChildrenError(
                f"节点 {node_id!r} 仍有子节点 {sorted(kids)}，必须先删除全部子节点",
                node_id,
            )
        before = self._snapshot_debts(node)
        self._repay_from_bucket(node)
        repaid = self._diff_debts(node, before)

        forgiven: list[dict[str, Any]] = []
        for loan in list(node.loans_in):
            lender = self._nodes[loan.lender_id]
            lender.loans_out.remove(loan)
            forgiven.append(
                {
                    "loan_id": loan.loan_id,
                    "lender_id": loan.lender_id,
                    "amount": _num(loan.amount),
                }
            )
            del self._loans[loan.loan_id]
            loan.amount = 0.0
        node.loans_in.clear()
        # 叶子节点不可能是借出方（借款人只能是自己的后代）。
        if node.loans_out:
            raise QuotaError(
                f"内部错误：叶子节点 {node_id!r} 仍存在对外借出记录", node_id
            )

        if node.parent_id is not None:
            self._children[node.parent_id].discard(node_id)
        del self._children[node_id]
        del self._nodes[node_id]
        self._last_rejection.pop(node_id, None)
        return {
            "deleted": node_id,
            "repaid": repaid,
            "forgiven": forgiven,
        }

    def _repay_from_bucket(self, node: Node) -> None:
        """用节点当前稳态桶余额按 FIFO 向上偿还（删除/禁用时调用）。"""
        if node.steady <= 0 or not node.loans_in:
            return
        self._pay_upstream(node, node.steady, from_bucket=True)

    def _snapshot_debts(self, node: Node) -> dict[str, float]:
        """记录节点当前各笔在途债务的余额快照。"""
        return {loan.loan_id: loan.amount for loan in node.loans_in}

    def _diff_debts(self, node: Node, before: dict[str, float]) -> list[dict[str, Any]]:
        """对照快照算出每笔债务本次偿还了多少（在销记完成后调用即可）。"""
        rows: list[dict[str, Any]] = []
        after = {loan.loan_id: loan.amount for loan in node.loans_in}
        for loan_id, old_amount in before.items():
            new_amount = after.get(loan_id, 0.0)
            paid = old_amount - new_amount
            if paid > 0:
                rows.append({"loan_id": loan_id, "amount": _num(paid)})
        return rows

    # -- 令牌申请 --------------------------------------------------------

    def request_tokens(self, node_id: str, amount: Any, t: Any = None) -> Decision:
        """申请令牌；成功才落账，拒绝返回原因链且不改变任何状态。

        每一层都必须为整笔 ``amount`` 独立记账，判定自请求节点（叶）沿
        路径向上到根：

        1. 本层首先要替直接子节点垫付 ``lend``（只准用本层**稳态**桶，
           子节点的这笔短缺在下层已经确定）；垫付后再承担本层自身的消耗，
           依次使用剩余稳态桶、本层突发桶；
        2. 仍不足的部分作为本层对直接父节点的**借入需求**向上传递，借入
           即耗、不得转贷（因此同一份令牌不可能被重复借出）；
        3. 根节点没有父节点，无法借入；它（以及中间任一无父可借而仍短缺
           的层）凑不齐即整笔拒绝。最先暴露短缺的层沿自根向叶的提交顺序
           确定，拒绝原因链自请求节点向根排列。

        目标节点或任一祖先被禁用时，在对应层拒绝。整个判定先在临时账本
        上完成，全部层可行后才一次性提交。

        :param amount: 正整数令牌数。
        :param t: 可选逻辑时刻，先推进时钟再判定。
        :return: :class:`Decision`；拒绝不抛异常，结构类错误才抛异常。
        """
        if t is not None:
            self.advance_clock(t)
        amount = _positive_int_amount(amount)
        self._get(node_id)
        path_up = self._path_to_root(node_id)  # [请求节点, ..., 根]

        # 临时账本：只包含路径上的节点；borrow_need[node] 是它向直接父
        # 节点的借入需求（在下一层被父节点用稳态桶全额垫付或拒绝）。
        work_steady = {n.node_id: n.steady for n in path_up}
        work_burst = {n.node_id: n.burst for n in path_up}
        borrow_need: dict[str, float] = {n.node_id: 0.0 for n in path_up}
        entries: dict[str, LayerDecision] = {}
        disabled_layer: Optional[str] = None
        insufficient_layer: Optional[str] = None
        shortfall_left = 0.0

        for depth, current in enumerate(path_up):
            need = float(amount)
            entry = LayerDecision(
                node_id=current.node_id,
                depth=depth,
                required=need,
                steady_before=work_steady[current.node_id],
                burst_before=work_burst[current.node_id],
                borrowable=0.0,  # 父节点能借给本层的额度，提交前回填
            )
            if not current.enabled:
                entry.status = "disabled"
                entry.reason = "节点被禁用，链路上该层不可用"
                entries[current.node_id] = entry
                disabled_layer = current.node_id
                break

            # 1) 先全额满足直接子节点的借入需求：只能用本层稳态桶，突发桶
            #    不外借，借入的令牌更不能转贷。凑不齐子节点借款 → 本层拒绝。
            child_id: Optional[str] = path_up[depth - 1].node_id if depth > 0 else None
            child_need = borrow_need[child_id] if child_id is not None else 0.0
            if child_need > work_steady[current.node_id] + _EPS:
                entry.lent_to_child = work_steady[current.node_id]
                entry.status = "insufficient"
                entry.reason = (
                    f"子节点 {child_id!r} 需借入 {_num(child_need)}，本层稳态桶仅 "
                    f"{_num(work_steady[current.node_id])} 可借（突发与借入令牌不得转贷），"
                    f"尚缺 {_num(child_need - work_steady[current.node_id])}"
                )
                entries[current.node_id] = entry
                insufficient_layer = current.node_id
                shortfall_left = child_need - work_steady[current.node_id]
                break
            work_steady[current.node_id] -= child_need
            entry.lent_to_child = child_need

            # 2) 垫付之后，本层还要为同一笔请求记账 n - 垫付额，依次使用
            #    本层剩余稳态桶与突发桶。
            own_need = need - child_need
            s_pay = min(work_steady[current.node_id], own_need)
            work_steady[current.node_id] -= s_pay
            own_need -= s_pay
            b_pay = min(work_burst[current.node_id], own_need)
            work_burst[current.node_id] -= b_pay
            own_need -= b_pay
            entry.steady_paid = s_pay
            entry.burst_paid = b_pay

            # 3) 仍不足 → 向直接父节点借入（借入即耗，不进本层桶）。
            if own_need > 0:
                if current.parent_id is None:
                    entry.status = "insufficient"
                    entry.reason = (
                        f"根层垫付子节点 {_num(child_need)}、自身稳态 {_num(s_pay)}、"
                        f"突发 {_num(b_pay)} 后仍缺 {_num(own_need)}，根无父可借"
                    )
                    entries[current.node_id] = entry
                    insufficient_layer = current.node_id
                    shortfall_left = own_need
                    break
                borrow_need[current.node_id] = own_need
                entry.borrowed = own_need
            entries[current.node_id] = entry

        # 回填每层 borrowable（父节点最终稳态剩余，仅供审计展示）。
        if disabled_layer is None and insufficient_layer is None:
            for depth, current in enumerate(path_up):
                if current.parent_id is not None:
                    entries[current.node_id].borrowable = work_steady[current.parent_id]
                else:
                    entries[current.node_id].borrowable = 0.0

        # 组装原因链：请求节点 → 根；未评估层显式标注。
        chain: list[LayerDecision] = []
        evaluation_done = disabled_layer is not None or insufficient_layer is not None
        for depth, current in enumerate(path_up):
            if current.node_id in entries:
                chain.append(entries[current.node_id])
            elif evaluation_done:
                chain.append(
                    LayerDecision(
                        node_id=current.node_id,
                        depth=depth,
                        required=float(amount),
                        steady_before=work_steady[current.node_id],
                        burst_before=work_burst[current.node_id],
                        borrowable=0.0,
                        status="not_evaluated",
                        reason="本层已拒绝，更靠近根的祖先层未参与扣账",
                    )
                )

        failing_id = disabled_layer or insufficient_layer
        if failing_id is not None:
            if disabled_layer is not None:
                reason_code = (
                    "node_disabled" if failing_id == node_id else "ancestor_disabled"
                )
                message = f"节点 {failing_id!r} 被禁用，请求被拒绝"
            else:
                reason_code = (
                    "self_insufficient" if failing_id == node_id
                    else "ancestor_insufficient"
                )
                message = (
                    f"节点 {failing_id!r} 层令牌不足，尚缺 {_num(shortfall_left)}"
                )
            decision = Decision(
                ok=False,
                node_id=node_id,
                amount=amount,
                time=self._clock,
                layers=chain,
                failing_node_id=failing_id,
                reason_code=reason_code,
                message=message,
            )
            self._last_rejection[node_id] = decision.to_dict()
            return decision

        # 全部层可行 → 自根向叶提交（顺序确定、可重放）。
        created_loans: list[str] = []
        for current in reversed(path_up):
            entry = entries[current.node_id]
            current.steady -= entry.steady_paid + entry.lent_to_child
            current.burst -= entry.burst_paid
            if entry.borrowed > 0:
                parent = self._nodes[current.parent_id]  # type: ignore[index]
                self._loan_seq += 1
                loan = Loan(
                    loan_id=f"L{self._loan_seq}",
                    lender_id=parent.node_id,
                    borrower_id=current.node_id,
                    amount=entry.borrowed,
                    created_at=self._clock,
                )
                parent.loans_out.append(loan)
                current.loans_in.append(loan)
                self._loans[loan.loan_id] = loan
                created_loans.append(loan.loan_id)
        decision = Decision(
            ok=True,
            node_id=node_id,
            amount=amount,
            time=self._clock,
            layers=chain,
            message="ok",
            loans_created=created_loans,
        )
        self._last_rejection.pop(node_id, None)
        return decision

    # -- 查询 ------------------------------------------------------------

    def node_status(self, node_id: str, t: Any = None) -> dict[str, Any]:
        """返回节点在（可选推进到的）时刻 ``t`` 的完整状态。

        包含可用稳态令牌、已借出、已借入、突发剩余、突发已用、容量配置、
        启用状态及按字典序排列的子节点。查询带未来时刻等价于先推进时钟。
        """
        if t is not None:
            self.advance_clock(t)
        node = self._get(node_id)
        return {
            "node_id": node.node_id,
            "parent_id": node.parent_id,
            "enabled": node.enabled,
            "capacity": _num(node.capacity),
            "rate": _num(node.rate),
            "available": _num(node.steady),
            "borrowed_out": _num(node.borrowed_out),
            "borrowed_in": _num(node.borrowed_in),
            "burst_capacity": _num(node.burst_capacity),
            "burst_remaining": _num(node.burst),
            "burst_used": _num(node.burst_used),
            "children": self.children(node_id),
        }

    def total_used(self, t: Any = None) -> dict[str, Any]:
        """整棵层级所有节点已用额度之和。

        单节点已用（该层当前被占用的额度）::

            capacity - steady - borrowed_out   # 本层稳态桶净消耗
                + burst_capacity - burst       # 本层突发已耗
                + borrowed_in                  # 借入且已消耗、尚未偿还的部分

        借入令牌"即借即耗"，不进入借入方稳态桶，因此必须单独计入借入方的
        已用；它同时体现为借出方的 ``borrowed_out``，两个节点在各自的层上
        各计一次，正是分层记账的语义。就整棵树求和时，借入与借出两两抵消，
        总和等于所有稳态/突发桶实际减少的令牌总数。
        """
        if t is not None:
            self.advance_clock(t)
        total = 0.0
        per_node: dict[str, float] = {}
        for node_id in sorted(self._nodes):
            node = self._nodes[node_id]
            used = (
                node.capacity
                - node.steady
                - node.borrowed_out
                + node.burst_used
                + node.borrowed_in
            )
            per_node[node_id] = _num(used)
            total += used
        return {"time": self._clock, "total_used": _num(total), "per_node": per_node}

    def last_rejection(self, node_id: str) -> Optional[dict[str, Any]]:
        """返回该节点最近一次拒绝的完整原因链；从未被拒返回 ``None``。

        成功申请会清除该节点的记录；禁用/不足造成的拒绝都会记录。
        """
        self._get(node_id)
        return self._last_rejection.get(node_id)

    def internal_state(self) -> dict[str, Any]:
        """调试用内部视图：时钟、全部节点、全部借用记录与派生统计。"""
        nodes: list[dict[str, Any]] = []
        for node_id in sorted(self._nodes):
            node = self._nodes[node_id]
            info = node.to_dict()
            info["children"] = self.children(node_id)
            info["borrowed_out_total"] = _num(node.borrowed_out)
            info["borrowed_in_total"] = _num(node.borrowed_in)
            info["loans_in_ids"] = [loan.loan_id for loan in node.loans_in]
            info["loans_out_ids"] = [loan.loan_id for loan in node.loans_out]
            nodes.append(info)
        loans = [self._loans[loan_id].to_dict()
                 for loan_id in sorted(self._loans, key=_loan_sort_key)]
        return {
            "clock": self._clock,
            "node_count": len(self._nodes),
            "root_id": self.root_id(),
            "nodes": nodes,
            "loans": loans,
        }

    # -- 导出 / 导入 -----------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """导出为 JSON 友好的字典（层级、配置、当前令牌、借款、时钟）。"""
        return {
            "version": self.FORMAT_VERSION,
            "clock": _num(self._clock),
            "nodes": [self._nodes[nid].to_dict() for nid in sorted(self._nodes)],
            "loans": [
                self._loans[loan_id].to_dict()
                for loan_id in sorted(self._loans, key=_loan_sort_key)
            ],
        }

    def export_json(self, path: str) -> dict[str, Any]:
        """导出到 JSON 文件并返回数据字典。"""
        data = self.to_dict()
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        return data

    def import_data(self, data: Any) -> dict[str, Any]:
        """从字典原子导入：校验全部通过才替换自身状态，失败则原样不变。"""
        fresh = self.from_dict(data)
        self._nodes = fresh._nodes
        self._children = fresh._children
        self._loans = fresh._loans
        self._loan_seq = fresh._loan_seq
        self._clock = fresh._clock
        self._last_rejection = fresh._last_rejection
        return {"imported_nodes": len(self._nodes), "imported_loans": len(self._loans),
                "clock": _num(self._clock)}

    def import_json(self, path: str) -> dict[str, Any]:
        """从 JSON 文件导入（损坏文件抛 :class:`QuotaImportError`，状态不变）。"""
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except FileNotFoundError:
            raise QuotaImportError(f"导入文件不存在：{path}")
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise QuotaImportError(f"导入文件损坏，不是合法 JSON：{exc}")
        return self.import_data(data)

    @classmethod
    def from_dict(cls, data: Any) -> "QuotaKernel":
        """完整校验后用字典构建新内核；任何问题抛 :class:`QuotaImportError`。

        校验项：顶层结构与版本号、节点标识非空唯一、容量/速率/突发/当前
        令牌为有限非负数、当前令牌不超容量、父节点存在、单根、无环、
        借用记录的借贷双方存在且为直接父子、数量为正、时刻合法，以及
        ``steady + 未还借出 <= capacity`` 的全局一致性。
        """
        if not isinstance(data, dict):
            raise QuotaImportError("文件顶层必须是 JSON 对象")
        if data.get("version") != cls.FORMAT_VERSION:
            raise QuotaImportError(
                f"不支持的版本号：{data.get('version')!r}，期望 {cls.FORMAT_VERSION}"
            )
        raw_nodes = data.get("nodes")
        if not isinstance(raw_nodes, list):
            raise QuotaImportError("字段 nodes 缺失或不是数组")
        raw_loans = data.get("loans", [])
        if not isinstance(raw_loans, list):
            raise QuotaImportError("字段 loans 必须是数组")
        clock = data.get("clock", 0)
        if isinstance(clock, bool) or not isinstance(clock, (int, float)) \
                or not math.isfinite(float(clock)) or clock < 0:
            raise QuotaImportError(f"clock 必须是有限非负数，实际为 {clock!r}")

        kernel = cls()
        kernel._clock = float(clock)
        seen_ids: set[str] = set()
        parents: dict[str, Optional[str]] = {}

        for index, raw in enumerate(raw_nodes):
            if not isinstance(raw, dict):
                raise QuotaImportError(f"nodes[{index}] 必须是对象")
            nid = raw.get("id")
            if not isinstance(nid, str) or not nid:
                raise QuotaImportError(f"nodes[{index}] 缺少非空字符串 id")
            if nid in seen_ids:
                raise QuotaImportError(f"节点标识 {nid!r} 重复", nid)
            seen_ids.add(nid)

            def field_num(name: str) -> float:
                if name not in raw:
                    raise QuotaImportError(f"节点 {nid!r} 缺少字段 {name}", nid)
                value = raw[name]
                if isinstance(value, bool) or not isinstance(value, (int, float)) \
                        or not math.isfinite(float(value)) or value < 0:
                    raise QuotaImportError(
                        f"节点 {nid!r} 的 {name} 必须是有限非负数，实际为 {value!r}", nid
                    )
                return float(value)

            capacity = field_num("capacity")
            rate = field_num("rate")
            burst_capacity = field_num("burst_capacity")
            steady = field_num("steady")
            burst = field_num("burst")
            parent_id = raw.get("parent_id")
            if parent_id is not None and not isinstance(parent_id, str):
                raise QuotaImportError(f"节点 {nid!r} 的 parent_id 必须是字符串或 null", nid)
            enabled = raw.get("enabled", True)
            if not isinstance(enabled, bool):
                raise QuotaImportError(f"节点 {nid!r} 的 enabled 必须是布尔值", nid)
            created_at = raw.get("created_at", 0)
            if isinstance(created_at, bool) or not isinstance(created_at, (int, float)) \
                    or not math.isfinite(float(created_at)) or created_at < 0 \
                    or created_at > clock:
                raise QuotaImportError(
                    f"节点 {nid!r} 的 created_at 必须位于 [0, clock] 内", nid
                )
            if steady > capacity:
                raise QuotaImportError(
                    f"节点 {nid!r} 的 steady({steady}) 超过容量 capacity({capacity})", nid
                )
            if burst > burst_capacity:
                raise QuotaImportError(
                    f"节点 {nid!r} 的 burst({burst}) 超过突发容量({burst_capacity})", nid
                )
            node = Node(
                node_id=nid,
                parent_id=parent_id,
                capacity=capacity,
                rate=rate,
                burst_capacity=burst_capacity,
                steady=steady,
                burst=burst,
                enabled=enabled,
                created_at=float(created_at),
            )
            kernel._nodes[nid] = node
            kernel._children[nid] = set()
            parents[nid] = parent_id

        # 父节点存在性（无孤儿）、单根。
        roots = [nid for nid, pid in parents.items() if pid is None]
        if len(roots) > 1:
            raise QuotaImportError(f"存在多个根节点：{sorted(roots)}")
        if kernel._nodes and not roots:
            raise QuotaImportError("层级非空但没有根节点")
        for nid, pid in parents.items():
            if pid is not None and pid not in parents:
                raise QuotaImportError(
                    f"节点 {nid!r} 的父节点 {pid!r} 不存在（孤儿节点）", nid
                )
        # 环检测：沿父链上行。
        for nid in parents:
            chain: set[str] = set()
            cur: Optional[str] = nid
            while cur is not None:
                if cur in chain:
                    raise CycleDetectedError(
                        f"父节点指针在 {cur!r} 处形成环：{sorted(chain)}", cur
                    )
                chain.add(cur)
                cur = parents[cur]
        for nid, pid in parents.items():
            if pid is not None:
                kernel._children[pid].add(nid)

        # 借用记录校验与重建。
        seen_loan_ids: set[str] = set()
        for index, raw in enumerate(raw_loans):
            if not isinstance(raw, dict):
                raise QuotaImportError(f"loans[{index}] 必须是对象")
            lid = raw.get("id")
            if not isinstance(lid, str) or not lid:
                raise QuotaImportError(f"loans[{index}] 缺少非空 id")
            if lid in seen_loan_ids:
                raise QuotaImportError(f"借用记录标识 {lid!r} 重复")
            seen_loan_ids.add(lid)
            lender_id = raw.get("lender_id")
            borrower_id = raw.get("borrower_id")
            for name, value in (("lender_id", lender_id), ("borrower_id", borrower_id)):
                if not isinstance(value, str) or not value:
                    raise QuotaImportError(f"借用记录 {lid} 的 {name} 缺失或非法")
                if value not in kernel._nodes:
                    raise QuotaImportError(
                        f"借用记录 {lid} 引用的节点 {value!r} 不存在", value
                    )
            if parents[borrower_id] != lender_id:  # type: ignore[index]
                raise QuotaImportError(
                    f"借用记录 {lid} 中 {lender_id!r} 不是 {borrower_id!r} 的直接父节点；"
                    "令牌只允许在直接父子间借用",
                    borrower_id,
                )
            amount = raw.get("amount")
            if isinstance(amount, bool) or not isinstance(amount, (int, float)) \
                    or not math.isfinite(float(amount)) or amount <= 0:
                raise QuotaImportError(
                    f"借用记录 {lid} 的 amount 必须是正数，实际为 {amount!r}"
                )
            created = raw.get("time")
            if isinstance(created, bool) or not isinstance(created, (int, float)) \
                    or not math.isfinite(float(created)) or created < 0 \
                    or created > clock:
                raise QuotaImportError(
                    f"借用记录 {lid} 的 time 必须位于 [0, clock] 内"
                )
            loan = Loan(lid, lender_id, borrower_id, float(amount), float(created))
            kernel._loans[lid] = loan
            kernel._nodes[lender_id].loans_out.append(loan)
            kernel._nodes[borrower_id].loans_in.append(loan)

        # FIFO 顺序必须是 (time, id序号)，重建后显式排序。
        def loan_order(loan: Loan) -> tuple[float, tuple[int, str]]:
            return (loan.created_at, _loan_sort_key(loan.loan_id))

        for node in kernel._nodes.values():
            node.loans_in.sort(key=loan_order)
            node.loans_out.sort(key=loan_order)
        numeric_seqs = [
            int(lid[1:]) for lid in kernel._loans
            if len(lid) > 1 and lid[0] == "L" and lid[1:].isdigit()
        ]
        if numeric_seqs:
            kernel._loan_seq = max(numeric_seqs)

        # 一致性：steady + 未还借出 <= capacity；非负 burst 已在上面校验。
        for nid, node in kernel._nodes.items():
            if node.steady + node.borrowed_out > node.capacity + 1e-9:
                raise QuotaImportError(
                    f"节点 {nid!r} 一致性校验失败：steady({node.steady}) + "
                    f"未还借出({node.borrowed_out}) 超过容量({node.capacity})",
                    nid,
                )
        return kernel


# ---------------------------------------------------------------------------
# 操作流调度（逐条到达的请求）与 JSONL 命令行
# ---------------------------------------------------------------------------

_OP_FIELDS: dict[str, tuple[str, ...]] = {
    # op 名 -> 必需字段
    "create_node": ("id", "capacity", "rate"),
    "delete_node": ("id",),
    "disable": ("id",),
    "enable": ("id",),
    "request_tokens": ("id", "amount"),
    "advance_clock": ("time",),
    "node_status": ("id",),
    "total_used": (),
    "query_rejection": ("id",),
    "internal_state": (),
    "export": (),
    "import": (),
}


def apply_op(kernel: QuotaKernel, op: dict[str, Any]) -> dict[str, Any]:
    """对内核逐条执行一个操作，返回 JSON 友好的结果字典。

    支持的 ``op``：create_node / delete_node / disable / enable /
    request_tokens / advance_clock / node_status / total_used /
    query_rejection / internal_state / export / import。

    结构类错误被捕获为 ``{"ok": false, "error": ..., "error_type": ...,
    "node_id": ...}``，不抛出，便于批处理继续；令牌申请被拒是正常业务
    结果（同样 ``ok: false``），区别在 ``error_type`` 为 ``"denied"`` 且
    带完整 ``reason_chain``。

    :param op: 至少含 ``op`` 字段的字典；export/import 可用 ``path``
        指定文件，import 也可用 ``data`` 直接内嵌数据。
    """
    if not isinstance(op, dict):
        return {"ok": False, "error": "操作必须是 JSON 对象", "error_type": "InvalidOp"}
    name = op.get("op")
    if name not in _OP_FIELDS:
        return {"ok": False, "error": f"未知操作 {name!r}", "error_type": "UnknownOp"}
    missing = [key for key in _OP_FIELDS[name] if key not in op]
    if missing:
        return {
            "ok": False,
            "op": name,
            "error": f"缺少必需字段 {missing}",
            "error_type": "MissingField",
        }
    t = op.get("time")
    try:
        if name == "create_node":
            result = kernel.create_node(
                op["id"], op["capacity"], op["rate"],
                parent_id=op.get("parent_id"),
                burst_capacity=op.get("burst_capacity", 0),
                t=t,
            )
        elif name == "delete_node":
            result = kernel.delete_node(op["id"], t=t)
        elif name == "disable":
            result = kernel.disable_node(op["id"], t=t)
        elif name == "enable":
            result = kernel.enable_node(op["id"], t=t)
        elif name == "request_tokens":
            decision = kernel.request_tokens(op["id"], op["amount"], t=t)
            result = decision.to_dict()
            if not decision.ok:
                result["error_type"] = "denied"
                result["error"] = decision.message
            return {"op": name, **result}
        elif name == "advance_clock":
            result = {"clock": _num(kernel.advance_clock(op["time"]))}
        elif name == "node_status":
            result = kernel.node_status(op["id"], t=t)
        elif name == "total_used":
            result = kernel.total_used(t=t)
        elif name == "query_rejection":
            result = {
                "node_id": op["id"],
                "rejection": kernel.last_rejection(op["id"]),
            }
        elif name == "internal_state":
            result = kernel.internal_state()
        elif name == "export":
            if "path" in op:
                kernel.export_json(op["path"])
                result = {"path": op["path"], **kernel.to_dict()}
            else:
                result = kernel.to_dict()
        else:  # import
            if "data" in op:
                result = kernel.import_data(op["data"])
            elif "path" in op:
                result = kernel.import_json(op["path"])
            else:
                return {
                    "ok": False,
                    "op": name,
                    "error": "import 需要 path 或 data 字段",
                    "error_type": "MissingField",
                }
        return {"ok": True, "op": name, "result": result}
    except QuotaError as exc:
        return {
            "ok": False,
            "op": name,
            "error": str(exc),
            "error_type": type(exc).__name__,
            "node_id": exc.node_id,
        }


def process_jsonl(kernel: QuotaKernel, lines: list[str] | Any) -> list[dict[str, Any]]:
    """逐行解析并执行 JSONL 操作流。

    某行 JSON 本身损坏不影响内核状态与后续行，对应结果里给出
    ``error_type="MalformedJSON"``。
    """
    results: list[dict[str, Any]] = []
    for lineno, raw in enumerate(lines, 1):
        text = raw.strip() if isinstance(raw, str) else raw
        if not text:
            continue
        try:
            op = json.loads(text)
        except json.JSONDecodeError as exc:
            results.append(
                {
                    "ok": False,
                    "line": lineno,
                    "error": f"JSON 解析失败：{exc}",
                    "error_type": "MalformedJSON",
                }
            )
            continue
        result = apply_op(kernel, op)
        result.setdefault("line", lineno)
        results.append(result)
    return results


def main(argv: Optional[list[str]] = None,
         stdin: Optional[TextIO] = None,
         stdout: Optional[TextIO] = None) -> int:
    """JSONL 命令行入口：每行一个操作 JSON，每行输出一个结果 JSON。

    用法：``python quota_kernel.py < ops.jsonl``（或管道输入）。
    """
    inp = stdin or sys.stdin
    out = stdout or sys.stdout
    kernel = QuotaKernel()
    lines = inp.read().splitlines()
    for result in process_jsonl(kernel, lines):
        out.write(json.dumps(result, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
