"""文件持久化：变量 / 主题 / 继承 / 覆盖 / 冲突记录的单个 JSON 文件往返。

文件格式（``themeoracle/v1``）::

    {
      "format": "themeoracle/v1",
      "variables": [{"id": "color.primary", "type": "color", "default": "#3366ff"}],
      "themes": [{"name": "base", "parent": null,
                  "overrides": {"color.primary": "#3366ff"}}],
      "conflicts": [{"variable_id": "...", "theme": "...",
                     "assignments": [{"theme": "...", "value": "..."}]}]
    }

载入策略：先把文件完整解析并在一个临时 :class:`DesignSystem` 上校验通过，
最后一刻才整体替换目标系统状态。任一步骤失败都抛 :class:`SerializationError`
（消息带 JSON 指针式位置），且已有系统状态保持不变。
``conflicts`` 段是快照，载入时会与按当前数据重新推导出的冲突逐条比对，
不一致即视为文件损坏。
"""

import json

from .errors import (
    SerializationError,
    ThemeOracleError,
    ParentThemeNotFoundError,
    InheritanceCycleError,
)
from .model import Variable
from .valuetypes import get_type, known_type_names
from .core import DesignSystem

FORMAT = "themeoracle/v1"


# ---------------------------------------------------------------------- #
# 写出
# ---------------------------------------------------------------------- #
def to_dict(system):
    """把系统导出为可 JSON 序列化的普通字典（冲突段取当前推导快照）。"""
    variables = []
    for vid in system.variable_ids:
        var = system.get_variable(vid)
        variables.append(
            {
                "id": var.id,
                "type": var.type_name,
                "default": var._type.to_json(var.default),
            }
        )
    themes = []
    for name in system.themes_in_topo_order():
        theme = system.get_theme(name)
        overrides = {
            vid: system.get_variable(vid)._type.to_json(theme.overrides[vid])
            for vid in sorted(theme.overrides)
        }
        themes.append(
            {"name": name, "parent": theme.parent, "overrides": overrides}
        )
    conflicts = []
    for record in system.conflicts():
        conflicts.append(record.to_dict(system.get_variable(record.variable_id)._type))
    return {
        "format": FORMAT,
        "variables": variables,
        "themes": themes,
        "conflicts": conflicts,
    }


def dumps(system, indent=2):
    """序列化为字符串。"""
    return json.dumps(
        to_dict(system), ensure_ascii=False, indent=indent, sort_keys=False
    )


def save(system, path):
    """原子写入：先写同目录临时文件再替换，避免半截文件破坏原数据。"""
    import os

    directory = os.path.dirname(os.path.abspath(path))
    tmp_path = os.path.join(
        directory, f".{os.path.basename(path)}.tmp"
    )
    text = dumps(system)
    try:
        with open(tmp_path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp_path, path)
    except OSError as exc:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise SerializationError(f"写入文件失败：{exc}")


# 兼容更直观的命名
save_to_file = save


# ---------------------------------------------------------------------- #
# 读入
# ---------------------------------------------------------------------- #
def _fail(message, location=None):
    raise SerializationError(message, location)


def _require_type(obj, expected, loc, what):
    if not isinstance(obj, expected):
        want = (
            "/".join(t.__name__ for t in expected)
            if isinstance(expected, tuple)
            else expected.__name__
        )
        _fail(f"{what}类型错误：需要 {want}，实际为 {type(obj).__name__}", loc)


def _require_key(obj, key, loc):
    if key not in obj:
        _fail(f"缺少必需字段 {key!r}", loc)
    return obj[key]


def loads(text, target=None):
    """从字符串载入。

    :param text: JSON 文本
    :param target: 可选的既有 :class:`DesignSystem`；给出时仅在全部校验
        通过后原子替换其状态，失败时原状态不变。
    :return: 校验通过后的系统（``target`` 给出时即其本身）。
    """
    if not isinstance(text, str):
        _fail("载入内容必须是字符串", "<root>")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        _fail(
            f"不是合法 JSON：{exc.msg}（行 {exc.lineno}，列 {exc.colno}）",
            "<root>",
        )
    _require_type(data, dict, "<root>", "根对象")
    fmt = data.get("format")
    if fmt != FORMAT:
        _fail(
            f"格式标识不符：期望 {FORMAT!r}，实际为 {fmt!r}",
            "format",
        )
    raw_variables = _require_key(data, "variables", "<root>")
    raw_themes = _require_key(data, "themes", "<root>")
    raw_conflicts = data.get("conflicts", [])

    variables = _parse_variables(raw_variables)
    themes = _parse_themes(raw_themes, variables)
    try:
        _validate_parent_relations(themes)
        system = DesignSystem()
        system._replace_state(variables, themes)
    except ThemeOracleError as exc:
        # 未知父主题 / 成环等定义错误统一包装为载入错误，消息中已含链条
        _fail(str(exc), "themes")
    _verify_conflicts(raw_conflicts, system, variables)

    if target is not None:
        if not isinstance(target, DesignSystem):
            _fail("target 必须是 DesignSystem 实例", "<api>")
        target._replace_state(variables, themes)
        return target
    return system


def load(path, target=None):
    """从文件载入；文件不可读或内容损坏时抛 :class:`SerializationError`。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as exc:
        _fail(f"无法读取文件：{exc}", str(path))
    return loads(text, target=target)


load_from_file = load


# ---------------------------------------------------------------------- #
# 分段校验
# ---------------------------------------------------------------------- #
def _parse_variables(raw_variables):
    _require_type(raw_variables, list, "variables", "variables")
    variables = {}
    for i, entry in enumerate(raw_variables):
        loc = f"variables[{i}]"
        _require_type(entry, dict, loc, "变量条目")
        vid = _require_key(entry, "id", loc)
        type_name = _require_key(entry, "type", loc)
        default = _require_key(entry, "default", loc + ".default")
        _require_type(vid, str, loc + ".id", "变量标识")
        if not vid.strip():
            _fail("变量标识不能为空", loc + ".id")
        if vid in variables:
            _fail(f"变量标识重复：{vid!r}", loc + ".id")
        _require_type(type_name, str, loc + ".type", "变量类型")
        if type_name not in known_type_names():
            _fail(
                f"未知取值类型 {type_name!r}；可选：{', '.join(known_type_names())}",
                loc + ".type",
            )
        value_type = get_type(type_name)
        try:
            normalized = value_type.validate(default, vid, loc + ".default")
        except ThemeOracleError as exc:
            _fail(str(exc), loc + ".default")
        var = Variable.__new__(Variable)
        var.id = vid
        var.type_name = type_name
        var._type = value_type
        var.default = normalized
        variables[vid] = var
    return variables


def _parse_themes(raw_themes, variables):
    from .model import Theme

    _require_type(raw_themes, list, "themes", "themes")
    themes = {}
    for i, entry in enumerate(raw_themes):
        loc = f"themes[{i}]"
        _require_type(entry, dict, loc, "主题条目")
        name = _require_key(entry, "name", loc)
        parent = _require_key(entry, "parent", loc)
        overrides = _require_key(entry, "overrides", loc)
        _require_type(name, str, loc + ".name", "主题名")
        if not name.strip():
            _fail("主题名不能为空", loc + ".name")
        if name in themes:
            _fail(f"主题名重复：{name!r}", loc + ".name")
        if parent is not None and not isinstance(parent, str):
            _fail("parent 必须是字符串或 null", loc + ".parent")
        _require_type(overrides, dict, loc + ".overrides", "覆盖记录")
        normalized_overrides = {}
        for vid, raw_value in overrides.items():
            vloc = f"{loc}.overrides[{vid!r}]"
            if not isinstance(vid, str):
                _fail("覆盖记录的键（变量标识）必须是字符串", vloc)
            if vid not in variables:
                _fail(f"覆盖引用了不存在的变量 {vid!r}", vloc)
            try:
                normalized_overrides[vid] = variables[vid]._type.validate(
                    raw_value, vid, vloc
                )
            except ThemeOracleError as exc:
                _fail(str(exc), vloc)
        themes[name] = Theme(name, parent, normalized_overrides)
    return themes


def _validate_parent_relations(themes):
    """检查父主题存在（给出链条）与继承成环（给出环路径）。"""
    # 1) 父主题必须存在，沿 parent 收集链条直到断点
    for name in sorted(themes):
        cur = themes[name]
        chain = [name]
        seen = {name}
        while cur.parent is not None:
            if cur.parent not in themes:
                raise ParentThemeNotFoundError(
                    name, cur.parent, chain + [cur.parent]
                )
            if cur.parent in seen:  # 环会在下面详细报告，这里先不断言
                break
            seen.add(cur.parent)
            chain.append(cur.parent)
            cur = themes[cur.parent]

    # 2) 环检测：对每个主题沿链走，回到访问过的节点即成环
    visiting = set()
    finished = set()

    def walk(node_name, stack):
        if node_name in finished:
            return None
        if node_name in visiting:
            start = stack.index(node_name)
            return stack[start:] + [node_name]
        visiting.add(node_name)
        stack.append(node_name)
        parent = themes[node_name].parent
        if parent is not None and parent in themes:
            cycle = walk(parent, stack)
            if cycle:
                return cycle
        stack.pop()
        visiting.discard(node_name)
        finished.add(node_name)
        return None

    for name in sorted(themes):
        cycle = walk(name, [])
        if cycle:
            raise InheritanceCycleError(cycle)


def _verify_conflicts(raw_conflicts, system, variables):
    """冲突段必须是列表，且与重新推导的快照内容完全一致。

    顺序不做要求（人工调整段顺序不算损坏），但每条记录的变量、视角主题、
    涉及主题与各自取值缺一不可、不可篡改。
    """
    _require_type(raw_conflicts, list, "conflicts", "conflicts")
    for i, entry in enumerate(raw_conflicts):
        loc = f"conflicts[{i}]"
        _require_type(entry, dict, loc, "冲突条目")
        vid = _require_key(entry, "variable_id", loc)
        theme = _require_key(entry, "theme", loc)
        assignments = _require_key(entry, "assignments", loc)
        _require_type(vid, str, loc + ".variable_id", "variable_id")
        _require_type(theme, str, loc + ".theme", "theme")
        _require_type(assignments, list, loc + ".assignments", "assignments")
        for j, pair in enumerate(assignments):
            ploc = f"{loc}.assignments[{j}]"
            _require_type(pair, dict, ploc, "冲突取值条目")
            p_theme = _require_key(pair, "theme", ploc)
            _require_key(pair, "value", ploc)
            _require_type(p_theme, str, ploc + ".theme", "theme")
        if vid not in variables:
            _fail(f"冲突记录引用了不存在的变量 {vid!r}", loc + ".variable_id")
        if theme not in system.theme_names:
            _fail(f"冲突记录引用了不存在的主题 {theme!r}", loc + ".theme")

    def canonical(records):
        return sorted(
            (
                rec["variable_id"],
                rec["theme"],
                [(a["theme"], a["value"]) for a in rec["assignments"]],
            )
            for rec in records
        )

    expected = []
    for record in system.conflicts():
        expected.append(record.to_dict(variables[record.variable_id]._type))
    if canonical(raw_conflicts) != canonical(expected):
        _fail(
            "冲突记录与按当前变量/主题/覆盖重新推导的结果不一致，文件可能已损坏",
            "conflicts",
        )
