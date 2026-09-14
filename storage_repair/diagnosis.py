"""候选内容裁决与校验一致性诊断。

本模块不修改任何条带状态，全部函数为纯函数，便于独立单元测试。

候选信任规则（确定性，与候选到达顺序无关）
==========================================

设某位置登记了 ``N`` 份候选（同一 ``source`` 标签在该位置至多登记一份）：

1. 先按**内容字节**分组（不依赖登记顺序），组内指纹相同。
2. 只有一组（所有候选逐字节一致）→ 信任该内容，``outcome="unanimous"``。
3. 多组内容时，取得票数（候选份数）最多的一组：

   * 得票 **严格超过** ``N/2``（严格多数）→ 信任该内容，
     ``outcome="majority"``；
   * 否则（包括平票与不过半）→ 判定该位置 **冲突**，
     ``outcome="conflict"``，拒绝用候选修复该位置。

4. 任何并列次序用内容指纹（SHA-256 十六进制）字典序打破，只影响
   记录中代表来源的选取，绝不影响被采用的字节内容：代表来源取
   获胜组内来源标签字典序最小者。

因此候选以任意顺序到达，分组、得票与结论都完全相同。

损坏位置诊断规则（唯一最近码字译码）
====================================

当若干位置持有“看似完好”的内容、但它们不满足校验方程时，需要判断
到底哪些位置是坏块。记这些内容位置集合为 ``S``：

* ``|S| < k``：信息不足，无法判断也无法重建。
* ``|S| = k``：MDS 性质决定任意 k 个块总落在某个码字上，无矛盾可查，
  是否可重建取决于坏块总数是否超过 m。
* ``|S| > k`` 且整体一致：无隐藏坏块（``ok``）。
* 否则按规模升序枚举**最小一致损坏集**——即“删去这 s 个位置后，
  剩余内容自洽（落在某个码字上）”的集合，等价于寻找与接收字最接近
  的码字：

  * 删除后**剩余位置不少于 k+1 个**（至少保留一个校验余力真正验证
    方程；只剩 k 个时任意内容都平凡自洽，不算被验证的解释）；
  * 第一个命中规模（最小汉明距离）上若**恰有一个**集合 → ``unique``：
    坏位置被唯一确定。集合只含校验位置时以数据块为准重算校验块，
    含数据位置时由其余块重建；
  * 该规模上有**多个**集合 → ``ambiguous``：多个等距码字，**拒绝
    挑选**，返回全部矛盾位置组合；
  * 所有命中解释都落在“删后只剩 k 个”的不可验证层 →
    ``underdetermined``：同样拒绝并列出全部等规模组合。

正确性保证（码距 ``m+1``）：当真实静默错误不超过 ``floor(m/2)`` 个
时，真实码字与接收字距离最小且唯一最近，译码必然返回唯一正确解释。
超过该半径后，若方程仍给出唯一最近码字，系统确定性地采纳它；一旦
并列或只能得到不可验证解释，系统绝不猜测，要求显式把已知坏块标记
为丢失/损坏（按纠删处理，最多可重建 m 个）。

枚举按位置编号升序进行（:func:`itertools.combinations` 的自然序），
因此输出顺序确定。每一层枚举设有组合数上限
:data:`MAX_COMBOS_PER_LEVEL`；超限仍无结论时抛出
:class:`DiagnosisLimitReached`，调用方按“无法唯一确定”处理，绝不
猜测一个结果。
"""

from __future__ import annotations

import hashlib
import itertools
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from .coding import ReedSolomonCodec, _solve_linear_system

#: 每层枚举最多检查的组合数；达到上限按无法唯一确定处理。
MAX_COMBOS_PER_LEVEL = 100_000


class DiagnosisLimitReached(Exception):
    """损坏集枚举超过 :data:`MAX_COMBOS_PER_LEVEL` 仍无法定论。"""


@dataclass(frozen=True)
class CandidateGroup:
    """候选按内容分组后的一组。

    :ivar fingerprint: 组内内容的 SHA-256 十六进制指纹。
    :ivar content: 组内共同的字节内容。
    :ivar count: 得票份数。
    :ivar sources: 该组全部来源标签（升序）。
    """

    fingerprint: str
    content: bytes
    count: int
    sources: Tuple[str, ...]


@dataclass(frozen=True)
class CandidateDecision:
    """候选裁决结果。

    :ivar outcome: ``unanimous`` / ``majority`` / ``conflict`` 之一。
    :ivar content: 被信任的内容；冲突时为 ``None``。
    :ivar source: 获胜组的代表来源（组内字典序最小标签）；冲突时为 ``None``。
    :ivar groups: 全部分组，按 ``(得票降序, 指纹升序)`` 排列，与到达顺序无关。
    """

    outcome: str
    content: Optional[bytes]
    source: Optional[str]
    groups: Tuple[CandidateGroup, ...]


def _fingerprint(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def resolve_candidates(
    candidates: Sequence[Tuple[str, bytes]],
) -> CandidateDecision:
    """对某位置的候选执行确定性裁决。

    :param candidates: ``(来源标签, 内容)`` 序列，顺序任意。
    :return: 裁决结果；没有候选时抛出 :class:`ValueError`。
    :raises ValueError: 候选列表为空。
    """
    if not candidates:
        raise ValueError("cannot resolve an empty candidate set")

    grouped: Dict[bytes, List[str]] = {}
    for source, content in candidates:
        grouped.setdefault(content, []).append(source)

    groups: List[CandidateGroup] = []
    for content, sources in grouped.items():
        groups.append(
            CandidateGroup(
                fingerprint=_fingerprint(content),
                content=content,
                count=len(sources),
                sources=tuple(sorted(sources)),
            )
        )
    # 确定性排序：得票降序，平手按指纹升序；与候选到达顺序无关。
    groups.sort(key=lambda g: (-g.count, g.fingerprint))

    total = len(candidates)
    winner = groups[0]
    if len(groups) == 1:
        outcome = "unanimous"
    elif winner.count * 2 > total:
        outcome = "majority"
    else:
        outcome = "conflict"

    if outcome == "conflict":
        return CandidateDecision(
            outcome="conflict", content=None, source=None, groups=tuple(groups)
        )
    return CandidateDecision(
        outcome=outcome,
        content=winner.content,
        source=winner.sources[0],
        groups=tuple(groups),
    )


# --- 校验一致性 -------------------------------------------------------------


def decode_codeword(
    codec: ReedSolomonCodec, contents: Dict[int, bytes]
) -> Optional[Dict[int, bytes]]:
    """用内容位置中编号最小的 k 个解出完整码字。

    :param contents: 位置到内容的映射，至少包含 k 个等长块。
    :return: 全部 ``k+m`` 个位置应有的内容；若少于 k 个位置返回 ``None``。
    """
    positions = sorted(contents)
    if len(positions) < codec.k:
        return None
    chosen = positions[: codec.k]
    length = len(contents[chosen[0]])

    # A[r][c]：依据块 r 对应数据列 c 的生成矩阵系数。
    matrix = [[0] * codec.k for _ in range(codec.k)]
    for row, pos in enumerate(chosen):
        if pos < codec.k:
            matrix[row][pos] = 1
        else:
            col = pos - codec.k
            for data_idx in range(codec.k):
                matrix[row][data_idx] = codec.parity[data_idx][col]
    data_vecs = [bytearray(length) for _ in range(codec.k)]
    columns = [contents[pos] for pos in chosen]
    for offset in range(length):
        solution = _solve_linear_system(
            matrix, [block[offset] for block in columns]
        )
        for data_idx in range(codec.k):
            data_vecs[data_idx][offset] = solution[data_idx]
    data_blocks = [bytes(buf) for buf in data_vecs]
    parity_blocks = codec.encode_parity(data_blocks)
    codeword: Dict[int, bytes] = {}
    for pos in range(codec.k):
        codeword[pos] = data_blocks[pos]
    for offset, block in enumerate(parity_blocks):
        codeword[codec.k + offset] = block
    return codeword


def is_consistent(
    codec: ReedSolomonCodec, contents: Dict[int, bytes]
) -> bool:
    """判断给定内容位置是否共同满足校验方程。

    位置数少于 k 时无矛盾可言，返回 ``True``；等于 k 时 MDS 性质保证
    必然一致；大于 k 时逐字节核对其余位置。
    """
    if len(contents) <= codec.k:
        return True
    codeword = decode_codeword(codec, contents)
    assert codeword is not None
    return all(codeword[pos] == contents[pos] for pos in contents)


@dataclass(frozen=True)
class DiagnosisResult:
    """静默矛盾诊断结果。

    :ivar status: ``ok``（无矛盾）、``unique``（唯一可验证坏集）、
        ``ambiguous``（多个可验证坏集，无法唯一确定）、
        ``underdetermined``（只能在不可验证层得到解释：错误过多）。
    :ivar sets: 相关位置组合（每个为升序位置元组，整体按字典序）。
    :ivar verified: ``sets`` 中的解释是否经过至少一个校验余力验证。
    """

    status: str
    sets: Tuple[Tuple[int, ...], ...]
    verified: bool


def diagnose(
    codec: ReedSolomonCodec,
    contents: Dict[int, bytes],
    cap: int = MAX_COMBOS_PER_LEVEL,
) -> DiagnosisResult:
    """对持有内容的位置执行确定性静默矛盾诊断（唯一最近码字译码）。

    步骤：

    1. 内容位置不超过 k，或整体一致 → ``ok``；
    2. 逐层枚举规模 ``s = 1..m-1``（保证删后剩余 ≥ k+1，解释经
       校验余力验证）：第一层命中时，唯一集合 → ``unique``，
       多个集合 → ``ambiguous``；
    3. 没有任何可验证解释时，在不可验证层（删后恰剩 k 个）收集全部
       等规模平凡解释，返回 ``underdetermined``，调用方必须拒绝
       修复并把这些组合作为矛盾位置组合报告，不得挑选。

    :param contents: 位置到内容的映射。
    :param cap: 每层枚举的组合数上限。
    :raises DiagnosisLimitReached: 超过 ``cap`` 仍无法定论。
    """
    positions = sorted(contents)
    n = len(positions)
    if n <= codec.k:
        return DiagnosisResult(status="ok", sets=(), verified=True)
    if is_consistent(codec, contents):
        return DiagnosisResult(status="ok", sets=(), verified=True)

    # 可验证层：删后剩余 >= k+1，即 s <= n - (k+1) = m-1。
    max_verified = n - (codec.k + 1)
    for size in range(1, max_verified + 1):
        hits: List[Tuple[int, ...]] = []
        checked = 0
        for combo in itertools.combinations(positions, size):
            checked += 1
            if checked > cap:
                raise DiagnosisLimitReached(
                    f"diagnosis checked more than {cap} combinations of size "
                    f"{size} without a conclusion; refusing to guess"
                )
            remaining = {pos: contents[pos] for pos in positions if pos not in combo}
            if is_consistent(codec, remaining):
                hits.append(combo)
        if hits:
            if len(hits) == 1:
                return DiagnosisResult(
                    status="unique", sets=(hits[0],), verified=True
                )
            return DiagnosisResult(
                status="ambiguous", sets=tuple(hits), verified=True
            )

    # 不可验证层：删后恰剩 k 个，任意组合都平凡“一致”。
    # 收集全部等规模组合作为互相矛盾的候选解释报告出来（受 cap 约束）。
    size = n - codec.k
    if size < 1:
        return DiagnosisResult(status="ok", sets=(), verified=True)
    all_combos: List[Tuple[int, ...]] = []
    checked = 0
    for combo in itertools.combinations(positions, size):
        checked += 1
        if checked > cap:
            raise DiagnosisLimitReached(
                f"diagnosis collected more than {cap} equally-sized "
                "unverifiable explanations without a conclusion; refusing to guess"
            )
        all_combos.append(combo)
    return DiagnosisResult(
        status="underdetermined", sets=tuple(all_combos), verified=False
    )


def find_minimal_bad_sets(
    codec: ReedSolomonCodec,
    contents: Dict[int, bytes],
    cap: int = MAX_COMBOS_PER_LEVEL,
) -> List[List[int]]:
    """兼容包装：返回诊断中的位置组合列表（无矛盾时为空）。"""
    result = diagnose(codec, contents, cap)
    return [list(combo) for combo in result.sets]


def classify_sets(
    codec: ReedSolomonCodec, bad_sets: Sequence[Sequence[int]]
) -> str:
    """按坏块位置类型分类损坏集。

    :return: ``none``（无集合）、``parity_only``（全部集合都只含校验位置）、
        ``data``（存在含数据位置的集合）。
    """
    if not bad_sets:
        return "none"
    if all(all(pos >= codec.k for pos in combo) for combo in bad_sets):
        return "parity_only"
    return "data"
