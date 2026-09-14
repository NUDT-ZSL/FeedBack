"""resource_kernel 的单元测试公共工具：脚本化的初始化/释放回调。"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


class ScriptedHooks:
    """按资源名预置回调结果序列，用于确定性地模拟失败与异常。

    每个资源对应一个结果队列：

    * ``None`` —— 成功；
    * 非空字符串 —— 失败原因；
    * ``""`` —— 失败（无具体原因，系统补默认原因）；
    * ``Exception`` 实例 —— 回调抛出该异常，模拟初始化被打断。

    队列耗尽后默认成功。同时记录每个资源被调用的次数。
    """

    def __init__(
        self,
        init_plan: Optional[Dict[str, List[Any]]] = None,
        release_plan: Optional[Dict[str, List[Any]]] = None,
    ) -> None:
        self.init_plan = {k: list(v) for k, v in (init_plan or {}).items()}
        self.release_plan = {k: list(v) for k, v in (release_plan or {}).items()}
        self.init_calls: Dict[str, int] = {}
        self.release_calls: Dict[str, int] = {}

    def set_init(self, name: str, outcomes: List[Any]) -> None:
        """覆盖某资源的初始化结果队列。"""
        self.init_plan[name] = list(outcomes)

    def set_release(self, name: str, outcomes: List[Any]) -> None:
        """覆盖某资源的释放结果队列。"""
        self.release_plan[name] = list(outcomes)

    @staticmethod
    def _pop(plan: Dict[str, List[Any]], name: str) -> Any:
        queue = plan.get(name)
        if not queue:
            return None
        return queue.pop(0)

    def initializer(self, name: str) -> Optional[str]:
        """初始化回调。"""
        self.init_calls[name] = self.init_calls.get(name, 0) + 1
        outcome = self._pop(self.init_plan, name)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    def releaser(self, name: str) -> Optional[str]:
        """释放回调。"""
        self.release_calls[name] = self.release_calls.get(name, 0) + 1
        outcome = self._pop(self.release_plan, name)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome
