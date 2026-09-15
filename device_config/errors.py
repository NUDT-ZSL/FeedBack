"""领域异常类型。

所有内核可预期错误都继承 :class:`KernelError`，调用方可以只捕获这一个基类，
也可以按子类区分错误性质。错误消息一律为中文，并尽量带上出错对象与位置。
"""

from __future__ import annotations


class KernelError(Exception):
    """内核所有可预期错误的基类。"""


class VersionError(KernelError):
    """版本号非法。

    :param text: 原始版本字符串。
    :param position: 首个非法字符的下标（0 起）；整体非法时可给出 ``None``。
    :param segment: 出错段序号（0 起）；与段无关时为 ``None``。
    """

    def __init__(self, text: str, message: str, position=None, segment=None):
        self.text = text
        self.position = position
        self.segment = segment
        loc_parts = []
        if segment is not None:
            loc_parts.append(f"第 {segment} 段")
        if position is not None:
            loc_parts.append(f"字符位置 {position}")
        loc = f"（{ '，'.join(loc_parts) }）" if loc_parts else ""
        super().__init__(f"非法版本号 {text!r}{loc}：{message}")


class ValidationError(KernelError):
    """登记或校验数据不合法（类型、默认值、引用等）。"""


class DuplicateError(KernelError):
    """唯一标识或字段名重复。"""


class NotFoundError(KernelError):
    """查询的设备、字段、配置或适配记录不存在。"""


class MigrationChainError(KernelError):
    """迁移链断裂。

    :param breakpoint_version: 断点版本——从该版本起找不到通往目标版本的规则。
    :param target_version: 期望到达的目标版本。
    """

    def __init__(self, breakpoint_version: str, target_version: str, reason: str):
        self.breakpoint_version = breakpoint_version
        self.target_version = target_version
        super().__init__(
            f"迁移链在版本 {breakpoint_version} 处断裂，无法到达 {target_version}：{reason}"
        )


class MissingFieldError(KernelError):
    """必填字段在配置中缺失且没有默认值。

    :param fields: 按字段名排序后的全部缺失必填字段。
    """

    def __init__(self, fields):
        self.fields = sorted(fields)
        super().__init__(
            "以下必填字段缺失且未提供默认值：" + "、".join(self.fields)
        )


class CorruptStateError(KernelError):
    """导出/载入的数据损坏或字段缺失；此时内核状态保持载入前不变。"""
