"""段落级合并内核（纯函数，无状态，仅依赖标准库）。

设计要点
========
正文按行切分为"段落"。一次修订相对其基准版本产生一份 *编辑脚本*：
对基准版本的每个段落槽位给出意图（保留 / 删除 / 替换），并在槽位之间的
间隙记录纯插入的段落。编辑脚本通过 LCS（最长公共子序列）对齐得到，
因此对"把哪几行改成了什么"的判定是确定性的。

多个基于同一基准版本的修订集成时，以基准版本为骨干逐槽位归并各方意图：

* 某槽位只有一方修改、其余方保留 -> 自动采用那一方（不同段落可自动合并）；
* 某槽位存在两种及以上互斥的非保留意图（甲改成 x、乙改成 y，或一改一删）
  -> 该槽位冲突，**完整保留各方原文**，绝不任选一方；
* 同一间隙出现两种不同的插入内容 -> 间隙冲突，保留各方。

归并结果只依赖"各方意图的多重集合"，不含任何到达次序，因而与修订到达
顺序无关；对不相交段落，其结果与逐条串行 rebase 完全一致（由测试保证）。
"""

from __future__ import annotations

from typing import Dict, List, Tuple

# ---- 段落切分 ----------------------------------------------------------------

def split_paragraphs(text: str) -> List[str]:
    """把正文切为段落（行）。

    使用 ``"\\n".split`` 风格：空正文为 ``[""]``，``"a\\n"`` 为 ``["a", ""]``，
    与 :func:`join_paragraphs` 严格互逆。
    """
    return text.split("\n")


def join_paragraphs(paragraphs: List[str]) -> str:
    return "\n".join(paragraphs)


# ---- LCS 对齐 ----------------------------------------------------------------

def _lcs_table(base: List[str], other: List[str]) -> List[List[int]]:
    n, m = len(base), len(other)
    table = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        bi = base[i - 1]
        row = table[i]
        prev = table[i - 1]
        for j in range(1, m + 1):
            if bi == other[j - 1]:
                row[j] = prev[j - 1] + 1
            else:
                row[j] = prev[j] if prev[j] >= row[j - 1] else row[j - 1]
    return table


def _matched_pairs(base: List[str], other: List[str]) -> List[Tuple[int, int]]:
    """回溯 LCS，返回正序的匹配下标对 ``(base_idx, other_idx)``。"""
    table = _lcs_table(base, other)
    i, j = len(base), len(other)
    pairs: List[Tuple[int, int]] = []
    while i > 0 and j > 0:
        if base[i - 1] == other[j - 1]:
            pairs.append((i - 1, j - 1))
            i -= 1
            j -= 1
        elif table[i - 1][j] >= table[i][j - 1]:
            i -= 1  # base 侧多出：删除
        else:
            j -= 1  # other 侧多出：插入
    pairs.reverse()
    return pairs


# ---- 编辑脚本 ----------------------------------------------------------------
#
# 槽位意图：
#   ("K",)            保留原段落
#   ("D",)            删除原段落
#   ("R", (行,...))   把原段落替换为若干行
#
# 间隙用其"之后那个槽位"的下标标识：g 表示插在槽 g 之前，g == n 表示文末。

SlotIntent = Tuple[str, ...]                      # 元素为 ("K",)/("D",)/("R", rows)
GapKey = int
EditScript = Tuple[List[SlotIntent], Dict[GapKey, Tuple[str, ...]]]


def diff_edit_script(base_text: str, new_text: str) -> EditScript:
    """计算 *new_text* 相对 *base_text* 的规范化编辑脚本。"""
    base = split_paragraphs(base_text)
    new = split_paragraphs(new_text)
    n = len(base)

    slots: List[SlotIntent] = [("K",)] * n
    gaps: Dict[GapKey, Tuple[str, ...]] = {}

    pairs = _matched_pairs(base, new)

    prev_b = -1
    prev_c = -1
    for bi, cj in pairs + [(n, len(new))]:
        bgap = list(range(prev_b + 1, bi))          # base 侧未匹配段（被删/被改）
        cgap = list(range(prev_c + 1, cj))          # new 侧未匹配段（新增）
        bvals = [base[k] for k in bgap]
        cvals = [new[k] for k in cgap]

        if bvals and cvals:
            # 同一锚点间隙内双方都有内容：替换区域。
            if len(bvals) == len(cvals):
                for slot, row in zip(bgap, cvals):
                    slots[slot] = ("R", (row,))
            else:
                # 行数不对称：整段替换挂到区域首槽，其余槽删除。
                slots[bgap[0]] = ("R", tuple(cvals))
                for slot in bgap[1:]:
                    slots[slot] = ("D",)
        elif bvals:
            for slot in bgap:
                slots[slot] = ("D",)
        elif cvals:
            gaps[bi] = tuple(cvals)                 # 纯插入：锚点 bi 之前（bi==n 为文末）

        prev_b, prev_c = bi, cj

    return slots, gaps


# ---- 行级差异（查询用）-------------------------------------------------------

def line_diff(base_text: str, new_text: str) -> List[Tuple[str, str]]:
    """稳定的行级差异，元素为 ``(动作, 行)``，动作 ∈ {``eq``, ``del``, ``ins``}。

    动作按文档正序排列；该函数只读，便于展示"两版之间的实际改动"。
    """
    base = split_paragraphs(base_text)
    new = split_paragraphs(new_text)
    table = _lcs_table(base, new)
    i, j = len(base), len(new)
    out: List[Tuple[str, str]] = []
    while i > 0 or j > 0:
        if i > 0 and j > 0 and base[i - 1] == new[j - 1]:
            out.append(("eq", base[i - 1]))
            i -= 1
            j -= 1
        elif j > 0 and (i == 0 or table[i][j - 1] >= table[i - 1][j]):
            out.append(("ins", new[j - 1]))
            j -= 1
        else:
            out.append(("del", base[i - 1]))
            i -= 1
    out.reverse()
    return out


def render_diff(base_text: str, new_text: str) -> str:
    """人类可读的统一差异片段（稳定顺序）。"""
    symbols = {"eq": "  ", "del": "- ", "ins": "+ "}
    return "\n".join(symbols[act] + line for act, line in line_diff(base_text, new_text))


# ---- 多方集成 ----------------------------------------------------------------
#
# 一个候选修订参与集成时携带的信息：
Candidate = Tuple[str, int, str]
#   (作者标识, 基于的版本号, 修订后正文)

# 集成产出的"块"，按文档正序排列：
#   ("paras", 行序列)        普通段落（一行或多行，含删除则不产生块）
#   ("conflict", 槽位, 各方) 槽位冲突
#   ("conflict_ins", 间隙, 各方) 间隙插入冲突
# 各方为 (作者, 版本, 种类, 载荷)；种类 ∈ {"R","D"}，载荷为行元组（D 为空）。
Block = Tuple


def _slot_intent(script: EditScript, slot: int) -> SlotIntent:
    return script[0][slot]


def integrate(base_text: str, candidates: List[Candidate]):
    """把多个基于同一 *base_text* 的候选修订集成为确定结果。

    返回 ``(blocks, conflicts)``：

    * ``blocks`` 为文档正序块列表（见模块注释）；
    * ``conflicts`` 为结构化冲突列表，每个冲突是一个 dict，
      含 ``kind``(``slot``/``gap``)、``location``（段落位置，0 基）、
      ``parties``（``[{author, base_version, action, lines}]``，按作者排序）。

    无候选时原样返回基准文本。该函数不依赖候选顺序。
    """
    base = split_paragraphs(base_text)
    n = len(base)
    scripts = [(author, ver, diff_edit_script(base_text, text))
               for author, ver, text in candidates]

    blocks: List[Tuple] = []
    conflicts: List[dict] = []

    def emit_gap(gap: int) -> None:
        # 各候选在该间隙的插入（缺省为空元组）
        per = [(author, ver, scr[1].get(gap, ())) for author, ver, scr in scripts]
        distinct = sorted({rows for _, _, rows in per if rows})
        if not distinct:
            return
        if len(distinct) == 1:
            rows = distinct[0]
            blocks.append(("paras", list(rows)))
            return
        parties = [
            (author, ver, "I", rows)
            for author, ver, rows in sorted(per, key=lambda p: (p[0], p[1]))
            if rows
        ]
        blocks.append(("conflict_ins", gap, parties))
        conflicts.append({
            "kind": "gap",
            "location": gap,
            "parties": [
                {"author": a, "base_version": v, "action": "insert", "lines": list(rows)}
                for a, v, _, rows in parties
            ],
        })

    def emit_slot(slot: int) -> None:
        per = [(author, ver, _slot_intent(scr, slot)) for author, ver, scr in scripts]
        distinct = {intent for _, _, intent in per}
        nonkeep = [intent for intent in distinct if intent[0] != "K"]

        if not nonkeep:
            blocks.append(("paras", [base[slot]]))
            return
        if len(nonkeep) == 1:
            # 对该槽位存在修改的各方意图一致（其余方保留）-> 自动合并
            intent = nonkeep[0]
            if intent[0] == "D":
                return  # 该段被一致删除
            blocks.append(("paras", list(intent[1])))
            return

        # 两种及以上互斥的非保留意图 -> 冲突，保留所有非保留方
        parties = [
            (author, ver, intent[0], intent[1] if intent[0] == "R" else ())
            for author, ver, intent in sorted(per, key=lambda p: (p[0], p[1]))
            if intent[0] != "K"
        ]
        # 去重（相同意图且相同作者不会因多候选重复：按 作者+动作+内容 去重）
        dedup = []
        seen = set()
        for p in parties:
            key = (p[0], p[2], p[3])
            if key not in seen:
                seen.add(key)
                dedup.append(p)
        blocks.append(("conflict", slot, dedup))
        conflicts.append({
            "kind": "slot",
            "location": slot,
            "parties": [
                {
                    "author": a,
                    "base_version": v,
                    "action": "replace" if act == "R" else "delete",
                    "lines": list(lines),
                }
                for a, v, act, lines in dedup
            ],
        })

    for slot in range(n):
        emit_gap(slot)
        emit_slot(slot)
    emit_gap(n)

    return blocks, conflicts


def render_blocks(blocks: List[Tuple]) -> str:
    """把集成块渲染为含冲突标记的正文（双方原文均保留）。"""
    out: List[str] = []
    for block in blocks:
        kind = block[0]
        if kind == "paras":
            out.extend(block[1])
        elif kind == "conflict":
            _, location, parties = block
            out.append(f"<<<<<<< 分歧 @段落{location}")
            for idx, (author, ver, act, lines) in enumerate(parties):
                if idx:
                    out.append("=======")
                header = f"# 作者 {author}（基于 v{ver}）"
                header += "删除该段" if act == "D" else "改为："
                out.append(header)
                if act == "R":
                    out.extend(lines)
            out.append(f">>>>>>> END 分歧 @段落{location}")
        else:  # conflict_ins
            _, location, parties = block
            out.append(f"<<<<<<< 插入分歧 @段落{location}之前")
            for idx, (author, ver, _act, lines) in enumerate(parties):
                if idx:
                    out.append("=======")
                out.append(f"# 作者 {author}（基于 v{ver}）插入：")
                out.extend(lines)
            out.append(f">>>>>>> END 插入分歧 @段落{location}之前")
    return join_paragraphs(out)


def apply_serially(base_text: str, candidates: List[Candidate], order: List[int]) -> str:
    """按给定排列把候选修订逐条 rebase 应用，返回合并正文。

    这是"逐条串行应用"的参考实现：每条候选相对 *base_text* 的编辑脚本，
    通过段落溯源映射到当前文档（基准段落以槽位号标记，插入段落独立标记）。
    仅用于验证：当各方改动互不相交时，其结果与排列无关且等于
    :func:`integrate` 的干净合并结果。
    """
    base = split_paragraphs(base_text)
    n = len(base)
    # 每个 token: ["B", 槽位, [行]] 或 ["X", 标识, [行...]]
    tokens: List[list] = [["B", i, [base[i]]] for i in range(n)]

    for idx in order:
        author, ver, text = candidates[idx]
        slots_int, gaps = diff_edit_script(base_text, text)

        def index_of_slot(slot: int):
            for k, tok in enumerate(tokens):
                if tok[0] == "B" and tok[1] == slot:
                    return k
            return None

        for slot in range(n):
            intent = slots_int[slot]
            k = index_of_slot(slot)
            if intent[0] == "D":
                if k is not None:
                    del tokens[k]
            elif intent[0] == "R" and k is not None:
                tokens[k] = ["X", (author, slot), list(intent[1])]

        # 间隙插入：从后往前，位置始终按基准槽位重新定位
        for gap in sorted(gaps, reverse=True):
            rows = gaps[gap]
            pos = len(tokens)
            for k, tok in enumerate(tokens):
                if tok[0] == "B" and tok[1] >= gap:
                    pos = k
                    break
            tokens.insert(pos, ["X", (author, gap), list(rows)])

    out: List[str] = []
    for tok in tokens:
        out.extend(tok[2])
    return join_paragraphs(out)
