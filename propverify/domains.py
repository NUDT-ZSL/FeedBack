"""取值域：声明每个输入字段的取值范围、生成方式与收缩策略。

每个域提供四个确定性操作：
- validate(): 拒绝空域 / 非法权重，报错带位置；
- generate(rng): 由调用方传入的确定性随机源生成一个值；
- edge(): 域内的“边界代表值”，用于权重偏向与约束可满足性探测；
- shrink(value): 产出有序收缩候选 (候选值, 依据说明)，收缩方向固定，保证可复现。
"""

from __future__ import annotations

from typing import Any, Iterator, List, Optional, Sequence, Tuple

from .errors import SpecError

ShrinkCandidate = Tuple[Any, str]


class Domain:
    kind = "abstract"

    def validate(self, path: str) -> None:
        raise NotImplementedError

    def generate(self, rng) -> Any:
        raise NotImplementedError

    def edge(self, rng) -> Any:
        """域内的边界代表值（权重命中边界时使用）。"""
        raise NotImplementedError

    def contains(self, value: Any) -> bool:
        raise NotImplementedError

    def shrink(self, value: Any) -> Iterator[ShrinkCandidate]:
        """按固定顺序产出比 value 更小的候选，附带人类可读依据。"""
        return iter(())

    def to_spec(self) -> dict:
        raise NotImplementedError

    # ------------------------------------------------------------------
    @staticmethod
    def from_spec(spec: dict, path: str) -> "Domain":
        if not isinstance(spec, dict) or "type" not in spec:
            raise SpecError(path, "取值域声明必须是含 type 字段的对象")
        kind = spec["type"]
        builders = {
            "int": IntDomain._build,
            "float": FloatDomain._build,
            "bool": BoolDomain._build,
            "choice": ChoiceDomain._build,
            "string": StringDomain._build,
            "list": ListDomain._build,
        }
        if kind not in builders:
            raise SpecError(path, f"未知取值域类型 {kind!r}，支持: {', '.join(sorted(builders))}")
        return builders[kind](spec, path)


def _num(spec: dict, key: str, path: str, default=None):
    v = spec.get(key, default)
    if v is None or isinstance(v, bool) or not isinstance(v, (int, float)):
        raise SpecError(path, f"字段 {key!r} 必须是数字，实际为 {v!r}")
    return v


class IntDomain(Domain):
    kind = "int"

    def __init__(self, lo: int, hi: int):
        self.lo = lo
        self.hi = hi

    @staticmethod
    def _build(spec, path):
        lo = _num(spec, "min", path)
        hi = _num(spec, "max", path)
        if isinstance(lo, float) and not lo.is_integer() or isinstance(hi, float) and not hi.is_integer():
            raise SpecError(path, "int 取值域的 min/max 必须是整数")
        return IntDomain(int(lo), int(hi))

    def validate(self, path: str) -> None:
        if self.lo > self.hi:
            raise SpecError(path, f"取值域为空: 下界 {self.lo} 大于上界 {self.hi}")

    def generate(self, rng) -> int:
        return rng.randint(self.lo, self.hi)

    def edge(self, rng) -> int:
        cands = [self.lo, self.hi]
        if self.lo <= 0 <= self.hi:
            cands.append(0)
        return cands[rng.randrange(len(cands))]

    def contains(self, value) -> bool:
        return isinstance(value, int) and not isinstance(value, bool) and self.lo <= value <= self.hi

    def shrink(self, value: int) -> Iterator[ShrinkCandidate]:
        target = 0 if self.lo <= 0 <= self.hi else (self.lo if self.lo > 0 else self.hi)
        if value == target:
            return
        yield target, f"整数直接向代表值 {target} 收缩"
        cur = value
        while True:
            nxt = target + (cur - target) // 2
            if nxt == cur or nxt == target:
                break
            yield nxt, f"整数向 {target} 二分收缩"
            cur = nxt

    def to_spec(self):
        return {"type": "int", "min": self.lo, "max": self.hi}


class FloatDomain(Domain):
    kind = "float"
    _EPS = 1e-9

    def __init__(self, lo: float, hi: float):
        self.lo = float(lo)
        self.hi = float(hi)

    @staticmethod
    def _build(spec, path):
        return FloatDomain(_num(spec, "min", path), _num(spec, "max", path))

    def validate(self, path: str) -> None:
        if self.lo > self.hi:
            raise SpecError(path, f"取值域为空: 下界 {self.lo} 大于上界 {self.hi}")

    def generate(self, rng) -> float:
        return rng.uniform(self.lo, self.hi)

    def edge(self, rng) -> float:
        cands = [self.lo, self.hi]
        if self.lo <= 0.0 <= self.hi:
            cands.append(0.0)
        return cands[rng.randrange(len(cands))]

    def contains(self, value) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and self.lo <= value <= self.hi

    def shrink(self, value: float) -> Iterator[ShrinkCandidate]:
        target = 0.0 if self.lo <= 0.0 <= self.hi else (self.lo if self.lo > 0 else self.hi)
        if abs(value - target) <= self._EPS:
            return
        yield target, f"浮点直接向代表值 {target} 收缩"
        cur = value
        while abs(cur - target) > self._EPS:
            nxt = target + (cur - target) / 2.0
            if abs(nxt - cur) <= self._EPS:
                break
            yield nxt, f"浮点向 {target} 二分收缩"
            cur = nxt

    def to_spec(self):
        return {"type": "float", "min": self.lo, "max": self.hi}


class BoolDomain(Domain):
    kind = "bool"

    @staticmethod
    def _build(spec, path):
        return BoolDomain()

    def validate(self, path: str) -> None:
        return

    def generate(self, rng) -> bool:
        return bool(rng.getrandbits(1))

    def edge(self, rng) -> bool:
        return False

    def contains(self, value) -> bool:
        return isinstance(value, bool)

    def shrink(self, value: bool) -> Iterator[ShrinkCandidate]:
        if value:
            yield False, "布尔 True 收缩为 False"

    def to_spec(self):
        return {"type": "bool"}


class ChoiceDomain(Domain):
    kind = "choice"

    def __init__(self, values: Sequence[Any], weights: Optional[Sequence[float]] = None):
        self.values = list(values)
        self.weights = list(weights) if weights is not None else None

    @staticmethod
    def _build(spec, path):
        values = spec.get("values")
        if not isinstance(values, list):
            raise SpecError(path, "choice 取值域必须提供 values 数组")
        weights = spec.get("weights")
        if weights is not None and not isinstance(weights, list):
            raise SpecError(path, "weights 必须是数组")
        return ChoiceDomain(values, weights)

    def validate(self, path: str) -> None:
        if not self.values:
            raise SpecError(path, "取值域为空: choice 的 values 不能为空数组")
        if self.weights is not None:
            if len(self.weights) != len(self.values):
                raise SpecError(
                    path,
                    f"weights 数量({len(self.weights)})与 values 数量({len(self.values)})不一致",
                )
            for i, w in enumerate(self.weights):
                if not isinstance(w, (int, float)) or isinstance(w, bool) or w < 0:
                    raise SpecError(path, f"weights[{i}] 必须是非负数字，实际为 {w!r}")
            if all(w == 0 for w in self.weights):
                raise SpecError(path, "所有权重均为 0，无法生成任何取值")

    def _pickable(self) -> List[int]:
        if self.weights is None:
            return list(range(len(self.values)))
        return [i for i, w in enumerate(self.weights) if w > 0]

    def generate(self, rng):
        idx = self._pickable()
        if self.weights is None:
            return self.values[idx[rng.randrange(len(idx))]]
        return rng.choices(self.values, weights=self.weights, k=1)[0]

    def edge(self, rng):
        return self.values[self._pickable()[0]]

    def contains(self, value) -> bool:
        return any(value == self.values[i] for i in self._pickable())

    def shrink(self, value) -> Iterator[ShrinkCandidate]:
        try:
            idx = next(i for i, v in enumerate(self.values) if v == value)
        except StopIteration:
            return
        if idx > 0:
            yield self.values[0], f"枚举收缩为首个候选 {self.values[0]!r}"
            mid = idx // 2
            if 0 < mid < idx:
                yield self.values[mid], f"枚举下标 {idx} 二分收缩到 {mid}"

    def to_spec(self):
        spec = {"type": "choice", "values": list(self.values)}
        if self.weights is not None:
            spec["weights"] = list(self.weights)
        return spec


class StringDomain(Domain):
    kind = "string"

    def __init__(self, alphabet: str, min_len: int, max_len: int):
        self.alphabet = alphabet
        self.min_len = min_len
        self.max_len = max_len

    @staticmethod
    def _build(spec, path):
        alphabet = spec.get("alphabet", "abcdefghijklmnopqrstuvwxyz")
        if not isinstance(alphabet, str):
            raise SpecError(path, "alphabet 必须是字符串")
        min_len = spec.get("min_len", 0)
        max_len = spec.get("max_len", 16)
        for k, v in (("min_len", min_len), ("max_len", max_len)):
            if not isinstance(v, int) or isinstance(v, bool):
                raise SpecError(path, f"{k} 必须是整数")
        return StringDomain(alphabet, min_len, max_len)

    def validate(self, path: str) -> None:
        if self.min_len < 0:
            raise SpecError(path, f"min_len 不能为负数: {self.min_len}")
        if self.min_len > self.max_len:
            raise SpecError(path, f"取值域为空: min_len {self.min_len} 大于 max_len {self.max_len}")
        if not self.alphabet and self.max_len > 0:
            raise SpecError(path, "取值域为空: alphabet 为空但允许的长度大于 0")

    def generate(self, rng) -> str:
        n = rng.randint(self.min_len, self.max_len)
        return "".join(self.alphabet[rng.randrange(len(self.alphabet))] for _ in range(n))

    def edge(self, rng) -> str:
        return self.alphabet[0] * self.min_len if self.alphabet else ""

    def contains(self, value) -> bool:
        return (
            isinstance(value, str)
            and self.min_len <= len(value) <= self.max_len
            and all(c in self.alphabet for c in value)
        )

    def shrink(self, value: str) -> Iterator[ShrinkCandidate]:
        n = len(value)
        if n > self.min_len:
            half = max(self.min_len, n // 2)
            yield value[:half], f"字符串长度 {n} 减半到 {half}"
            yield value[: self.min_len], f"字符串截短到最小长度 {self.min_len}"
        if value and self.alphabet:
            floor = self.alphabet[0]
            simplified = floor * len(value)
            if simplified != value:
                yield simplified, f"字符统一替换为字母表首字符 {floor!r}"

    def to_spec(self):
        return {
            "type": "string",
            "alphabet": self.alphabet,
            "min_len": self.min_len,
            "max_len": self.max_len,
        }


class ListDomain(Domain):
    kind = "list"

    def __init__(self, element: Domain, min_len: int, max_len: int):
        self.element = element
        self.min_len = min_len
        self.max_len = max_len

    @staticmethod
    def _build(spec, path):
        elem_spec = spec.get("element")
        if elem_spec is None:
            raise SpecError(path, "list 取值域必须提供 element 子域")
        element = Domain.from_spec(elem_spec, path + ".element")
        min_len = spec.get("min_len", 0)
        max_len = spec.get("max_len", 8)
        for k, v in (("min_len", min_len), ("max_len", max_len)):
            if not isinstance(v, int) or isinstance(v, bool):
                raise SpecError(path, f"{k} 必须是整数")
        return ListDomain(element, min_len, max_len)

    def validate(self, path: str) -> None:
        self.element.validate(path + ".element")
        if self.min_len < 0:
            raise SpecError(path, f"min_len 不能为负数: {self.min_len}")
        if self.min_len > self.max_len:
            raise SpecError(path, f"取值域为空: min_len {self.min_len} 大于 max_len {self.max_len}")

    def generate(self, rng) -> list:
        n = rng.randint(self.min_len, self.max_len)
        return [self.element.generate(rng) for _ in range(n)]

    def edge(self, rng) -> list:
        return [self.element.edge(rng) for _ in range(self.min_len)]

    def contains(self, value) -> bool:
        return (
            isinstance(value, list)
            and self.min_len <= len(value) <= self.max_len
            and all(self.element.contains(v) for v in value)
        )

    def shrink(self, value: list) -> Iterator[ShrinkCandidate]:
        n = len(value)
        if n > self.min_len:
            half = max(self.min_len, n // 2)
            yield value[:half], f"列表长度 {n} 减半到 {half}"
            yield value[: self.min_len], f"列表截短到最小长度 {self.min_len}"
        for i, item in enumerate(value):
            for cand, why in self.element.shrink(item):
                trial = list(value)
                trial[i] = cand
                yield trial, f"列表第 {i} 个元素收缩（{why}）"

    def to_spec(self):
        return {
            "type": "list",
            "element": self.element.to_spec(),
            "min_len": self.min_len,
            "max_len": self.max_len,
        }
