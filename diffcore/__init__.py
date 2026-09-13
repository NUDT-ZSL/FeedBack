"""diffcore —— 文本差异对齐与行号映射内核。

面向代码评审场景：对两份文本（按行）做基于 LCS 的对齐，
并在此之上提供行号映射、折叠区间映射、批注重定位和结果序列化。

对齐结果（alignment result）是一个 [(old_index, new_index), ...] 列表：
- old_index / new_index 为 0 起始的行号，None 表示该侧没有对应行；
- 两侧行号各自严格单调递增，且覆盖两侧的所有行。

性能特征：对齐基于 Myers O(ND) 算法（D 为两侧的最小编辑距离），
20000 行、5% 差异的输入在 1 秒内完成；差异越集中、D 越大则越慢，
两份几乎完全不同的超大文件属于该算法的固有最坏情况。
"""

from ._lcs import lcs_matches

__all__ = [
    "align",
    "map_line",
    "fold",
    "relocate",
    "to_dict",
    "from_dict",
]

__version__ = "0.1.0"

_SIDES = ("old", "new")


# ---------------------------------------------------------------------------
# 对齐
# ---------------------------------------------------------------------------

def align(old_lines, new_lines):
    """对两份文本的行序列做 LCS 对齐，返回对齐结果列表。

    old_lines / new_lines 是字符串列表，按整行精确比较。
    结果中每项为 (old_index, new_index)，None 表示该侧无对应行；
    顺序单调递增，且覆盖两侧所有行。同一输入多次调用结果完全一致。
    """
    old = _check_lines(old_lines, "old_lines")
    new = _check_lines(new_lines, "new_lines")

    # 先把行内容映射为整数 token，加速后续大量相等性比较。
    tokens = {}
    a = _tokenize(old, tokens)
    b = _tokenize(new, tokens)

    matches = lcs_matches(a, b)

    result = []
    i = j = 0
    n_old = len(old)
    n_new = len(new)
    for mi, mj in matches:
        while i < mi:
            result.append((i, None))
            i += 1
        while j < mj:
            result.append((None, j))
            j += 1
        result.append((i, j))
        i += 1
        j += 1
    while i < n_old:
        result.append((i, None))
        i += 1
    while j < n_new:
        result.append((None, j))
        j += 1
    return result


def _check_lines(lines, name):
    if isinstance(lines, (str, bytes)):
        raise TypeError("%s 必须是字符串列表，而不是 %s" % (name, type(lines).__name__))
    try:
        items = list(lines)
    except TypeError:
        raise TypeError("%s 必须是字符串列表" % name) from None
    for idx, item in enumerate(items):
        if not isinstance(item, str):
            raise TypeError(
                "%s 的第 %d 项不是字符串: %r" % (name, idx, item))
    return items


def _tokenize(lines, tokens):
    out = []
    get = tokens.get
    for s in lines:
        t = get(s)
        if t is None:
            t = len(tokens)
            tokens[s] = t
        out.append(t)
    return out


# ---------------------------------------------------------------------------
# 行号映射
# ---------------------------------------------------------------------------

def map_line(result, side, index):
    """把一侧的行号映射到对侧。

    side 取 'old' 或 'new'，index 为该侧的 0 起始行号。
    返回对侧行号；该行在对侧没有对应行（被删除/是新增之间的空隙）
    时返回 None。side 非法或 index 越界时抛 ValueError。
    """
    old_to_new, new_to_old = _build_maps(result)
    table = _pick_table(old_to_new, new_to_old, side, index)
    if not isinstance(index, int) or isinstance(index, bool) or index < 0:
        raise ValueError(
            "非法行号: side=%r, index=%r（index 必须是非负整数）" % (side, index))
    if index not in table:
        raise ValueError(
            "行号越界: side=%r, index=%r（该侧共 %d 行）"
            % (side, index, len(table)))
    return table[index]


def _pick_table(old_to_new, new_to_old, side, index):
    if side == "old":
        return old_to_new
    if side == "new":
        return new_to_old
    raise ValueError(
        "非法 side: side=%r, index=%r（side 只能是 'old' 或 'new'）"
        % (side, index))


def _build_maps(result):
    """由对齐结果构建双向映射表：{本侧行号: 对侧行号或 None}。"""
    old_to_new = {}
    new_to_old = {}
    for pair in result:
        o, n = pair
        if o is not None:
            old_to_new[o] = n
        if n is not None:
            new_to_old[n] = o
    return old_to_new, new_to_old


# ---------------------------------------------------------------------------
# 折叠区间
# ---------------------------------------------------------------------------

def fold(result, ranges, side="old"):
    """把一侧的折叠区间映射到对侧。

    ranges 是 [(start, end), ...] 形式的闭区间列表（允许重叠、乱序），
    先在给定侧（side，默认 'old'）合并重叠区间，再映射到对侧。
    返回对侧的折叠区间列表：闭区间、升序、互不重叠。
    区间内没有任何存活行（整段被删除）时，该区间被丢弃。
    """
    if side not in _SIDES:
        raise ValueError("非法 side: %r（只能是 'old' 或 'new'）" % (side,))
    merged = _merge_ranges(ranges)
    old_to_new, new_to_old = _build_maps(result)
    table = old_to_new if side == "old" else new_to_old

    out = []
    for start, end in merged:
        lo = None
        hi = None
        for idx in range(start, end + 1):
            target = table.get(idx)
            if target is None:
                continue
            if lo is None:
                lo = target
            hi = target
        if lo is not None:
            out.append((lo, hi))
    return out


def _merge_ranges(ranges):
    norm = []
    for i, r in enumerate(ranges):
        try:
            start, end = r
        except (TypeError, ValueError):
            raise ValueError("第 %d 个区间不是 (start, end) 形式: %r" % (i, r)) from None
        for v in (start, end):
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                raise ValueError("第 %d 个区间含非法行号: %r" % (i, r))
        if start > end:
            raise ValueError("第 %d 个区间起点大于终点: %r" % (i, r))
        norm.append((start, end))
    norm.sort()
    merged = []
    for start, end in norm:
        if merged and start <= merged[-1][1]:
            if end > merged[-1][1]:
                merged[-1][1] = end
        else:
            merged.append([start, end])
    return [(s, e) for s, e in merged]


# ---------------------------------------------------------------------------
# 批注重定位
# ---------------------------------------------------------------------------

def relocate(annotations, result):
    """把批注从一侧重定位到对侧。

    annotations 每项是 {'side', 'line', 'id'} 形式的字典；
    返回新列表，每项在原有字段基础上增加：
    - 'mapped_line'：对侧行号；落在被删行上时挂到相邻存活行
      （优先前一行，其次后一行），无存活行可挂时为 None；
    - 'status'：'unchanged'（行号不变）、'moved'（行号变化）、
      'deleted'（原行被删除）之一。
    """
    old_to_new, new_to_old = _build_maps(result)
    out = []
    for i, ann in enumerate(annotations):
        if not isinstance(ann, dict):
            raise ValueError("第 %d 条批注不是字典: %r" % (i, ann))
        try:
            side = ann["side"]
            line = ann["line"]
        except KeyError as exc:
            raise ValueError(
                "第 %d 条批注缺少字段 %s: %r" % (i, exc, ann)) from None
        if side == "old":
            table = old_to_new
        elif side == "new":
            table = new_to_old
        else:
            raise ValueError(
                "第 %d 条批注 side 非法: side=%r, line=%r" % (i, side, line))
        if (not isinstance(line, int) or isinstance(line, bool)
                or line < 0 or line not in table):
            raise ValueError(
                "第 %d 条批注行号越界: side=%r, line=%r（该侧共 %d 行）"
                % (i, side, line, len(table)))
        mapped = table[line]
        if mapped is not None:
            status = "unchanged" if mapped == line else "moved"
            mapped_line = mapped
        else:
            status = "deleted"
            mapped_line = _nearest_surviving(table, line)
        item = dict(ann)
        item["mapped_line"] = mapped_line
        item["status"] = status
        out.append(item)
    return out


def _nearest_surviving(table, line):
    """在 table 中找 line 附近最近的存活行号，优先前一行，其次后一行。"""
    for j in range(line - 1, -1, -1):
        target = table.get(j)
        if target is not None:
            return target
    for j in range(line + 1, max(table) + 1 if table else 0):
        target = table.get(j)
        if target is not None:
            return target
    return None


# ---------------------------------------------------------------------------
# 序列化
# ---------------------------------------------------------------------------

def to_dict(result):
    """把对齐结果序列化为稳定的、可比较的字典结构（可直接 JSON 化）。"""
    pairs = []
    for pair in result:
        o, n = pair
        pairs.append([o, n])
    return {"version": 1, "pairs": pairs}


def from_dict(data):
    """把 to_dict 产出的结构还原为对齐结果列表。

    结构不合法（记录形状错误、索引非单调递增、两侧行号重复、
    两侧同时为 None 等）时抛 ValueError，并指明是哪条记录坏了。
    """
    if not isinstance(data, dict):
        raise ValueError("对齐数据必须是字典，实际是: %r" % (data,))
    pairs = data.get("pairs")
    if not isinstance(pairs, (list, tuple)):
        raise ValueError("对齐数据缺少 'pairs' 列表: %r" % (data,))

    result = []
    prev_old = -1
    prev_new = -1
    for i, rec in enumerate(pairs):
        if not isinstance(rec, (list, tuple)) or len(rec) != 2:
            raise ValueError("第 %d 条记录不是 (old, new) 二元组: %r" % (i, rec))
        o, n = rec
        for value, name in ((o, "old"), (n, "new")):
            if value is not None and (
                    not isinstance(value, int) or isinstance(value, bool)
                    or value < 0):
                raise ValueError(
                    "第 %d 条记录的 %s 行号非法: %r" % (i, name, rec))
        if o is None and n is None:
            raise ValueError("第 %d 条记录两侧行号都是 None: %r" % (i, rec))
        if o is not None:
            if o <= prev_old:
                raise ValueError(
                    "第 %d 条记录 old 行号重复或非单调递增: %r" % (i, rec))
            prev_old = o
        if n is not None:
            if n <= prev_new:
                raise ValueError(
                    "第 %d 条记录 new 行号重复或非单调递增: %r" % (i, rec))
            prev_new = n
        result.append((o, n))
    return result
