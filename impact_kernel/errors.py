"""校验错误类型。

所有校验失败都抛出 ValidationError，异常信息中始终包含出错位置
（请求标识 / 规则标识 / 属性名），便于运营人员直接定位。
"""


class ValidationError(ValueError):
    """数据校验失败。location 指出出错位置，message 说明原因。"""

    def __init__(self, location: str, message: str):
        self.location = location
        self.detail = message
        super().__init__(f"{location}: {message}")
