"""对象注册表与不变量注册表。

- 对象：被测系统里需要验证行为的目标（如 "counter"、"order"），先登记再引用。
- 不变量：唯一标识 + 适用对象 + 判定条件（安全表达式）+ 可选前置条件。
重复标识、引用未登记对象、表达式引用未知字段，均在登记时拒绝并指出位置。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Union

from .errors import SpecError
from .expr import Expr

# 判定条件可以是安全表达式字符串，也可以是 Python 可调用对象（便于程序内直接使用）。
Predicate = Union[str, Callable[[dict], bool]]


@dataclass
class Invariant:
    inv_id: str
    target: str
    check: Predicate
    when: Optional[Predicate] = None  # 前置条件不满足时该输入记为跳过
    description: str = ""

    def spec_key(self) -> tuple:
        """用于变更检测的稳定指纹。"""
        return (
            self.inv_id,
            self.target,
            self.check if isinstance(self.check, str) else repr(self.check),
            self.when if isinstance(self.when, str) or self.when is None else repr(self.when),
        )


@dataclass
class CompiledInvariant:
    inv_id: str
    target: str
    check_expr: Optional[Expr]
    check_fn: Optional[Callable[[dict], bool]]
    when_expr: Optional[Expr]
    when_fn: Optional[Callable[[dict], bool]]
    description: str = ""

    def applies(self, values: dict) -> bool:
        if self.when_expr is not None:
            return self.when_expr.check(values)
        if self.when_fn is not None:
            return bool(self.when_fn(values))
        return True

    def holds(self, values: dict) -> bool:
        if self.check_expr is not None:
            return self.check_expr.check(values)
        return bool(self.check_fn(values))


class Registry:
    """对象 + 不变量的登记处。"""

    def __init__(self) -> None:
        self._objects: Dict[str, dict] = {}
        self._invariants: Dict[str, Invariant] = {}

    # ---------------------------------------------------------------- 对象
    def register_object(self, name: str, **meta) -> None:
        path = f"object[{name}]"
        if not isinstance(name, str) or not name:
            raise SpecError("object", "对象名必须是非空字符串")
        if name in self._objects:
            raise SpecError(path, f"对象标识重复: {name!r} 已登记")
        self._objects[name] = dict(meta)

    def has_object(self, name: str) -> bool:
        return name in self._objects

    @property
    def objects(self) -> List[str]:
        return sorted(self._objects)

    # ---------------------------------------------------------------- 不变量
    def register_invariant(
        self,
        inv_id: str,
        target: str,
        check: Predicate,
        when: Optional[Predicate] = None,
        description: str = "",
        _replace: bool = False,
    ) -> Invariant:
        path = f"invariant[{inv_id}]"
        if not isinstance(inv_id, str) or not inv_id:
            raise SpecError("invariant", "不变量标识必须是非空字符串")
        if not _replace and inv_id in self._invariants:
            raise SpecError(path, f"不变量标识重复: {inv_id!r} 已登记")
        if target not in self._objects:
            raise SpecError(
                path,
                f"引用了未登记的对象 {target!r}；已登记对象: {sorted(self._objects) or '（无）'}",
            )
        inv = Invariant(inv_id=inv_id, target=target, check=check, when=when, description=description)
        # 立即编译，表达式语法错误在登记时暴露，而不是判定时。
        self.compile(inv, known_fields=None)
        self._invariants[inv_id] = inv
        return inv

    def replace_invariant(self, inv: Invariant) -> None:
        """变更场景下替换已有不变量（供 Runner 增量重判使用）。"""
        self._invariants[inv.inv_id] = inv

    def invariant(self, inv_id: str) -> Invariant:
        return self._invariants[inv_id]

    @property
    def invariants(self) -> List[Invariant]:
        return [self._invariants[k] for k in sorted(self._invariants)]

    def invariants_for(self, target: str) -> List[Invariant]:
        return [inv for inv in self.invariants if inv.target == target]

    # ---------------------------------------------------------------- 编译
    @staticmethod
    def compile(inv: Invariant, known_fields: Optional[set]) -> CompiledInvariant:
        path = f"invariant[{inv.inv_id}]"
        check_expr = check_fn = when_expr = when_fn = None
        if isinstance(inv.check, str):
            check_expr = Expr(inv.check, path + ".check")
        elif callable(inv.check):
            check_fn = inv.check
        else:
            raise SpecError(path + ".check", "判定条件必须是表达式字符串或可调用对象")
        if inv.when is not None:
            if isinstance(inv.when, str):
                when_expr = Expr(inv.when, path + ".when")
            elif callable(inv.when):
                when_fn = inv.when
            else:
                raise SpecError(path + ".when", "前置条件必须是表达式字符串或可调用对象")
        if known_fields is not None:
            for label, e in (("check", check_expr), ("when", when_expr)):
                if e is None:
                    continue
                unknown = sorted(e.names - known_fields)
                if unknown:
                    raise SpecError(
                        f"{path}.{label}",
                        f"表达式引用了未声明的输入字段 {unknown}；已声明字段: {sorted(known_fields)}",
                    )
        return CompiledInvariant(
            inv_id=inv.inv_id,
            target=inv.target,
            check_expr=check_expr,
            check_fn=check_fn,
            when_expr=when_expr,
            when_fn=when_fn,
            description=inv.description,
        )
