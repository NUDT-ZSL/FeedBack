"""异常体系：所有拒绝操作都指出位置与原因。"""


class ThemeOracleError(Exception):
    """本模块所有异常的公共基类，调用方只需捕获它即可兜底。"""


class DefinitionError(ThemeOracleError):
    """定义阶段（添加变量/主题、声明继承）的错误。"""


class DuplicateVariableError(DefinitionError):
    """变量唯一标识重复。"""

    def __init__(self, variable_id, location=None):
        self.variable_id = variable_id
        self.location = location
        at = f"（位置：{location}）" if location else ""
        super().__init__(f"变量标识重复：{variable_id!r}{at}")


class VariableNotFoundError(DefinitionError):
    """引用了不存在的变量。"""

    def __init__(self, variable_id, location=None):
        self.variable_id = variable_id
        self.location = location
        at = f"（位置：{location}）" if location is not None else ""
        super().__init__(f"变量不存在：{variable_id!r}{at}")


class DuplicateThemeError(DefinitionError):
    """主题名重复。"""

    def __init__(self, theme_name, location=None):
        self.theme_name = theme_name
        self.location = location
        at = f"（位置：{location}）" if location else ""
        super().__init__(f"主题名重复：{theme_name!r}{at}")


class ThemeNotFoundError(DefinitionError):
    """引用了不存在的主题。"""

    def __init__(self, theme_name, location=None):
        self.theme_name = theme_name
        self.location = location
        at = f"（位置：{location}）" if location else ""
        super().__init__(f"主题不存在：{theme_name!r}{at}")


class InvalidValueError(DefinitionError):
    """取值与变量声明的类型不符。

    ``location`` 形如 ``"variables['color.primary'].default"`` 或
    ``"themes['dark'].overrides['color.primary']"``，可直接定位到出错字段。
    """

    def __init__(self, variable_id, expected, actual, location=None, detail=None):
        self.variable_id = variable_id
        self.expected = expected
        self.actual = actual
        self.location = location
        self.detail = detail
        at = f"（位置：{location}）" if location else ""
        reason = f"：{detail}" if detail else ""
        super().__init__(
            f"变量 {variable_id!r} 取值类型不符：期望 {expected}，"
            f"实际得到 {actual!r}{reason}{at}"
        )


class ParentThemeNotFoundError(DefinitionError):
    """声明继承时引用了不存在的父主题，并给出涉及的链条。"""

    def __init__(self, theme_name, missing_parent, chain=None):
        self.theme_name = theme_name
        self.missing_parent = missing_parent
        self.chain = list(chain) if chain else [theme_name, missing_parent]
        chain_text = " -> ".join(self.chain)
        super().__init__(
            f"主题 {theme_name!r} 引用了不存在的父主题 {missing_parent!r}"
            f"；涉及链条：{chain_text}"
        )


class InheritanceCycleError(DefinitionError):
    """继承关系成环，给出环上的链条。"""

    def __init__(self, chain):
        self.chain = list(chain)
        chain_text = " -> ".join(self.chain)
        super().__init__(f"继承关系不允许成环；检测到环：{chain_text}")


class SerializationError(ThemeOracleError):
    """文件损坏、字段缺失或类型不符；消息中给出 JSON 指针式定位。

    载入失败时调用方系统状态保持不变（见 :func:`themeoracle.persistence.load`）。
    """

    def __init__(self, message, location=None):
        self.location = location
        at = f"（位置：{location}）" if location else ""
        super().__init__(f"{message}{at}")
