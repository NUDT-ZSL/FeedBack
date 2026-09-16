"""数据模型：变量、主题、解析结果与冲突记录。

这些类只承载数据，约束校验集中在 :mod:`themeoracle.core`，
以便持久化载入时能够一次性给出清晰错误而不留下半初始化对象。
"""

from .valuetypes import get_type, known_type_names


class Variable:
    """视觉变量定义。

    :param variable_id: 全局唯一标识，非空字符串。
    :param type_name: 取值类型名，见 :func:`themeoracle.valuetypes.known_type_names`。
    :param default: 默认值（按类型校验、规范化）；未在任何主题覆盖时取它。
    """

    __slots__ = ("id", "type_name", "default", "_type")

    def __init__(self, variable_id, type_name, default):
        if not isinstance(variable_id, str) or not variable_id.strip():
            raise ValueError("变量标识必须是非空字符串")
        if not isinstance(type_name, str):
            raise ValueError("类型名必须是字符串")
        # 这里先验证类型名存在；default 的类型校验由 DesignSystem 完成，
        # 因为只有它能构造出带位置信息的 InvalidValueError。
        try:
            value_type = get_type(type_name)
        except KeyError:
            raise ValueError(f"未知取值类型 {type_name!r}")
        self.id = variable_id
        self.type_name = type_name
        self._type = value_type
        self.default = default

    @property
    def value_type(self):
        return self._type

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type_name,
            "default": self._type.to_json(self.default),
        }

    def __repr__(self):
        return f"Variable(id={self.id!r}, type={self.type_name!r}, default={self.default!r})"


class Theme:
    """主题。

    :param name: 主题名，全局唯一。
    :param parent: 父主题名（单继承）或 ``None``（根主题）。
    :param overrides: ``{变量标识: 覆盖值}``，值在加入 DesignSystem 时按类型校验。
    """

    __slots__ = ("name", "parent", "overrides")

    def __init__(self, name, parent=None, overrides=None):
        if not isinstance(name, str) or not name.strip():
            raise ValueError("主题名必须是非空字符串")
        if parent is not None and not isinstance(parent, str):
            raise ValueError("父主题名必须是字符串或 None")
        self.name = name
        self.parent = parent
        self.overrides = dict(overrides or {})

    def to_dict(self):
        return {
            "name": self.name,
            "parent": self.parent,
            "overrides": dict(self.overrides),
        }

    def __repr__(self):
        return f"Theme(name={self.name!r}, parent={self.parent!r}, overrides={len(self.overrides)})"


class ResolvedValue:
    """某主题下某变量的最终解析结果。

    :param variable_id: 变量标识
    :param value: 规范化后的最终取值（可能为 :data:`UNRESOLVED`）
    :param source: 取值来源主题名；若来自变量默认值则为 ``None``
    :param used_default: 是否最终回落到变量默认值
    :param chain: 自当前主题沿继承向上的完整主题名链
    """

    __slots__ = ("variable_id", "value", "source", "used_default", "chain")

    def __init__(self, variable_id, value, source, used_default, chain):
        self.variable_id = variable_id
        self.value = value
        self.source = source
        self.used_default = used_default
        self.chain = tuple(chain)

    @property
    def resolved(self):
        return self.value is not UNRESOLVED

    def __repr__(self):
        origin = "默认值" if self.used_default else f"主题 {self.source!r}"
        return f"ResolvedValue({self.variable_id!r}={self.value!r} <- {origin})"


class _Unresolved:
    """哨兵：沿链与默认值都找不到取值（变量没有默认值时才会出现）。"""

    _instance = None

    def __repr__(self):
        return "<UNRESOLVED>"

    def __bool__(self):
        return False


UNRESOLVED = _Unresolved()


class ConflictRecord:
    """同一变量在继承链上出现的互相矛盾的取值。

    :param variable_id: 变量标识
    :param theme_name: 被查询/检测的下游主题（冲突在它的继承链上可见）
    :param assignments: ``[(主题名, 规范化取值), ...]``，按继承链就近到远、
        再按主题名排序的稳定顺序；至少两项且取值互不相同。
    """

    __slots__ = ("variable_id", "theme_name", "assignments")

    def __init__(self, variable_id, theme_name, assignments):
        self.variable_id = variable_id
        self.theme_name = theme_name
        self.assignments = list(assignments)

    @property
    def themes(self):
        return [name for name, _ in self.assignments]

    @property
    def values(self):
        return [value for _, value in self.assignments]

    def to_dict(self, value_type):
        return {
            "variable_id": self.variable_id,
            "theme": self.theme_name,
            "assignments": [
                {"theme": name, "value": value_type.to_json(value)}
                for name, value in self.assignments
            ],
        }

    def describe(self):
        """人类可读的一行冲突描述。"""
        def show(value):
            # 字符串加引号以区分；Color/Length 等有自定义 __str__ 的直接展示
            return repr(value) if isinstance(value, str) else str(value)

        details = "；".join(
            f"{name}={show(value)}" for name, value in self.assignments
        )
        return (
            f"变量 {self.variable_id!r} 在主题 {self.theme_name!r} 的继承链上"
            f"存在互相矛盾的取值：{details}（生效取值来自最近的"
            f" {self.assignments[0][0]!r}，其余取值保留备查）"
        )

    def __str__(self):
        return self.describe()

    def __repr__(self):
        return f"ConflictRecord({self.variable_id!r}, {self.theme_name!r}, {self.assignments!r})"
