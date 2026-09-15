"""属性模式：声明访问请求允许携带的属性名及其类型。

支持的类型：str / int / float / bool。
注意 Python 中 bool 是 int 的子类，类型检查时对 int/float 显式排除 bool，
避免 True 被当成合法的整数值。
"""

from typing import Any

SUPPORTED_TYPES = ("str", "int", "float", "bool")


def check_value_type(value: Any, type_name: str) -> bool:
    """判断 value 是否符合 type_name 声明的类型。"""
    if type_name == "bool":
        return isinstance(value, bool)
    if type_name == "int":
        return isinstance(value, int) and not isinstance(value, bool)
    if type_name == "float":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if type_name == "str":
        return isinstance(value, str)
    return False
