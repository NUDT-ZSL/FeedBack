"""编排核心：变量/主题登记、继承校验、逐层解析、增量重算与冲突检测。

解析语义（与逐层手工推导完全一致）：
    对主题 T 的变量 V，从 T 开始沿 parent 链向上，第一个在自身 overrides 中
    给出 V 的主题即生效来源；整条链都没有时，回落到变量默认值。
    链上出现多个互不相同的取值不影响生效结果（就近生效），但会全部保留并
    生成 :class:`ConflictRecord`。

增量语义：
    修改主题 T 对变量 V 的覆盖，只可能影响 T 本身及其下游子孙主题对 V 的
    解析。缓存中仅这些 (主题, V) 条目会被重算，其余条目对象保持不变；
    重算算法与全量解析是同一段链上查找逻辑，因此二者结果必然一致。
"""

from .errors import (
    DuplicateVariableError,
    VariableNotFoundError,
    DuplicateThemeError,
    ThemeNotFoundError,
    InvalidValueError,
    ParentThemeNotFoundError,
    InheritanceCycleError,
)
from .model import Variable, Theme, ResolvedValue, ConflictRecord
from .valuetypes import get_type


class DesignSystem:
    def __init__(self):
        self._variables = {}          # id -> Variable（default 已规范化）
        self._themes = {}             # name -> Theme（overrides 已规范化）
        self._children = {}           # name -> set[直接子主题名]
        self._chains = {}             # name -> (name, parent, ..., root)
        self._cache = {}              # name -> {var_id: ResolvedValue}

    # ------------------------------------------------------------------ #
    # 变量
    # ------------------------------------------------------------------ #
    def add_variable(self, variable_id, type_name, default):
        """登记一个视觉变量；标识重复或默认值类型不符则拒绝（状态不变）。"""
        if variable_id in self._variables:
            raise DuplicateVariableError(
                variable_id, location=f"variables[{variable_id!r}]"
            )
        location = f"variables[{variable_id!r}].default"
        try:
            value_type = get_type(type_name)
        except KeyError:
            raise InvalidValueError(
                variable_id, f"已知类型之一", type_name,
                f"variables[{variable_id!r}].type",
                detail=f"未知取值类型 {type_name!r}",
            )
        normalized_default = value_type.validate(default, variable_id, location)
        variable = Variable.__new__(Variable)
        variable.id = variable_id
        variable.type_name = type_name
        variable._type = value_type
        variable.default = normalized_default
        self._variables[variable_id] = variable
        # 已有主题的缓存是惰性补全的，新变量无需使任何缓存失效。
        return variable

    @property
    def variable_ids(self):
        """所有变量标识，按字典序稳定返回。"""
        return tuple(sorted(self._variables))

    def get_variable(self, variable_id):
        try:
            return self._variables[variable_id]
        except KeyError:
            raise VariableNotFoundError(variable_id)

    # ------------------------------------------------------------------ #
    # 主题与继承
    # ------------------------------------------------------------------ #
    def add_theme(self, name, parent=None, overrides=None):
        """新增主题并声明父主题；未知父主题、成环、覆盖值非法都会被拒绝。"""
        if name in self._themes:
            raise DuplicateThemeError(name, location=f"themes[{name!r}]")
        if parent is not None:
            if parent not in self._themes:
                raise ParentThemeNotFoundError(name, parent, [name, parent])
            # 新主题尚无子女，唯一可能的环是 name 已在 parent 的祖先链上
            # （此时 name 必然是已存在的主题——但 name 刚刚检查过不重复，
            # 因此 add_theme 阶段实际上不可能成环；保留检查以防未来放开重命名）。
            ancestor_chain = self.inheritance_chain(parent)
            if name in ancestor_chain:
                raise InheritanceCycleError(
                    [name] + list(ancestor_chain[: ancestor_chain.index(name) + 1])
                )
        normalized = self._normalize_overrides(name, overrides)
        theme = Theme(name, parent, normalized)
        self._themes[name] = theme
        self._children.setdefault(name, set())
        if parent is not None:
            self._children[parent].add(name)
        # 父主题必然先于子主题创建，其链缓存已存在，直接派生即可
        self._chains[name] = (
            (name,) + self._chains[parent] if parent is not None else (name,)
        )
        return theme

    def set_parent(self, name, new_parent):
        """修改继承关系；引用未知父主题或成环则拒绝（状态不变）。"""
        if name not in self._themes:
            raise ThemeNotFoundError(name, location=f"themes[{name!r}].parent")
        if new_parent is not None and new_parent not in self._themes:
            raise ParentThemeNotFoundError(name, new_parent, [name, new_parent])
        if new_parent == name:
            raise InheritanceCycleError([name, name])
        # 成环检查：new_parent 的祖先链里不能出现 name
        if new_parent is not None:
            ancestor_chain = self.inheritance_chain(new_parent)
            if name in ancestor_chain:
                cycle = [name] + list(
                    ancestor_chain[: ancestor_chain.index(name) + 1]
                )
                raise InheritanceCycleError(cycle)
        old_parent = self._themes[name].parent
        if old_parent == new_parent:
            return
        self._themes[name].parent = new_parent
        if old_parent is not None:
            self._children[old_parent].discard(name)
        if new_parent is not None:
            self._children.setdefault(new_parent, set()).add(name)
        # 继承几何变化：所有链缓存作废，所有解析缓存作废（父链可能改变来源）
        self._chains.clear()
        self._cache.clear()

    @property
    def theme_names(self):
        """所有主题名，按字典序稳定返回。"""
        return tuple(sorted(self._themes))

    def get_theme(self, name):
        try:
            return self._themes[name]
        except KeyError:
            raise ThemeNotFoundError(name)

    def inheritance_chain(self, name):
        """返回 ``(主题自身, 父, 祖父, ..., 根主题)`` 的完整继承链。"""
        if name not in self._themes:
            raise ThemeNotFoundError(name, location="inheritance_chain()")
        cached = self._chains.get(name)
        if cached is not None:
            return cached
        chain = [name]
        cur = self._themes[name].parent
        seen = set()
        while cur is not None:
            if cur in seen:  # 双保险：正常路径下环已在写入时被拦截
                raise InheritanceCycleError(chain + [cur])
            seen.add(cur)
            chain.append(cur)
            cur = self._themes[cur].parent
        result = tuple(chain)
        self._chains[name] = result
        return result

    def descendants(self, name):
        """返回主题自身及其全部下游子孙，按名称字典序稳定返回。"""
        if name not in self._themes:
            raise ThemeNotFoundError(name, location="descendants()")
        result = []
        stack = [name]
        seen = set()
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            result.append(cur)
            for child in self._children.get(cur, ()):  # 集合，顺序无关
                stack.append(child)
        return tuple(sorted(result))

    def themes_in_topo_order(self):
        """父先于子的稳定拓扑序（同父下按主题名字典序）。"""
        roots = sorted(
            n for n, t in self._themes.items() if t.parent is None
        )
        order = []

        def visit(node):
            order.append(node)
            for child in sorted(self._children.get(node, ())):
                visit(child)

        for root in roots:
            visit(root)
        return order

    # ------------------------------------------------------------------ #
    # 覆盖与增量重算
    # ------------------------------------------------------------------ #
    def set_override(self, theme_name, variable_id, value):
        """设置/修改某主题对某变量的覆盖，返回受影响而被重算的主题名列表。

        只有该主题及其下游子孙可能受影响；其余主题的缓存条目原样保留。
        """
        theme = self.get_theme(theme_name)
        variable = self.get_variable(variable_id)
        location = f"themes[{theme_name!r}].overrides[{variable_id!r}]"
        normalized = variable._type.validate(value, variable_id, location)
        theme.overrides[variable_id] = normalized
        affected = self.descendants(theme_name)
        for down in affected:
            bucket = self._cache.get(down)
            if bucket is not None:
                bucket[variable_id] = self._resolve_one(down, variable_id)
        return list(affected)

    def remove_override(self, theme_name, variable_id):
        """删除某主题对某变量的自身覆盖（语义等价于覆盖改为沿链回落）。

        返回受影响主题名列表；本来就没有覆盖时不做任何改动。
        """
        theme = self.get_theme(theme_name)
        if variable_id not in self._variables:
            raise VariableNotFoundError(
                variable_id,
                location=f"themes[{theme_name!r}].overrides",
            )
        if variable_id not in theme.overrides:
            return []
        del theme.overrides[variable_id]
        affected = self.descendants(theme_name)
        for down in affected:
            bucket = self._cache.get(down)
            if bucket is not None:
                bucket[variable_id] = self._resolve_one(down, variable_id)
        return list(affected)

    def theme_overrides(self, theme_name):
        """返回某主题自身覆盖的 ``{变量标识: 规范化取值}`` 副本，按标识排序。"""
        theme = self.get_theme(theme_name)
        return {k: theme.overrides[k] for k in sorted(theme.overrides)}

    # ------------------------------------------------------------------ #
    # 解析与来源查询
    # ------------------------------------------------------------------ #
    def resolve(self, theme_name, variable_id):
        """解析某主题下某变量的最终取值与来源（需求 6）。"""
        self.get_theme(theme_name)
        self.get_variable(variable_id)
        bucket = self._cache.setdefault(theme_name, {})
        cached = bucket.get(variable_id)
        if cached is None:
            cached = self._resolve_one(theme_name, variable_id)
            bucket[variable_id] = cached
        return cached

    def resolve_all(self, theme_name):
        """解析某主题下全部变量，返回按变量标识排序的 ``{id: ResolvedValue}``。"""
        self.get_theme(theme_name)
        bucket = self._cache.setdefault(theme_name, {})
        for variable_id in self.variable_ids:
            if variable_id not in bucket:
                bucket[variable_id] = self._resolve_one(
                    theme_name, variable_id
                )
        return {vid: bucket[vid] for vid in self.variable_ids}

    def override_themes(self, variable_id):
        """该变量被哪些主题以自身覆盖给出过取值，按主题名字典序稳定返回。"""
        self.get_variable(variable_id)
        return tuple(
            name
            for name in self.theme_names
            if variable_id in self._themes[name].overrides
        )

    def _resolve_one(self, theme_name, variable_id):
        """沿继承链查找第一个自身覆盖；找不到则回落变量默认值。"""
        chain = self.inheritance_chain(theme_name)
        for ancestor in chain:
            overrides = self._themes[ancestor].overrides
            if variable_id in overrides:
                return ResolvedValue(
                    variable_id,
                    overrides[variable_id],
                    source=ancestor,
                    used_default=False,
                    chain=chain,
                )
        variable = self._variables[variable_id]
        return ResolvedValue(
            variable_id,
            variable.default,
            source=None,
            used_default=True,
            chain=chain,
        )

    # ------------------------------------------------------------------ #
    # 冲突检测（需求 5）
    # ------------------------------------------------------------------ #
    def conflicts(self, theme_name=None, variable_id=None):
        """列出继承链上的互相矛盾取值，稳定排序。

        * 不给参数：所有主题视角下的全部冲突（按主题拓扑序、变量标识排序）；
        * 给 ``theme_name``：只看该主题继承链上可见的冲突；
        * 再给 ``variable_id``：只看该变量。
        同一组矛盾在下游多个主题链上可见时会分别各出一条记录，
        因为「涉及主题」在不同视角下的继承链不同。
        """
        if variable_id is not None:
            self.get_variable(variable_id)
        if theme_name is not None:
            targets = [self.get_theme(theme_name).name]
        else:
            targets = self.themes_in_topo_order()
        records = []
        for target in targets:
            chain = self.inheritance_chain(target)
            var_ids = (
                (variable_id,) if variable_id is not None else self.variable_ids
            )
            for vid in var_ids:
                assignments = [
                    (t, self._themes[t].overrides[vid])
                    for t in chain
                    if vid in self._themes[t].overrides
                ]
                distinct = {value for _, value in assignments}
                if len(distinct) >= 2:
                    records.append(ConflictRecord(vid, target, assignments))
        return records

    # ------------------------------------------------------------------ #
    # 内部辅助
    # ------------------------------------------------------------------ #
    def _normalize_overrides(self, theme_name, overrides):
        """批量校验覆盖：未知变量拒绝，类型不符带位置拒绝（全部失败即整体失败）。"""
        if overrides is None:
            return {}
        if not isinstance(overrides, dict):
            raise InvalidValueError(
                "<multiple>", "映射 {变量标识: 取值}", type(overrides).__name__,
                f"themes[{theme_name!r}].overrides",
                detail="overrides 必须是字典",
            )
        normalized = {}
        for variable_id, raw in overrides.items():
            if variable_id not in self._variables:
                raise VariableNotFoundError(
                    variable_id,
                    location=f"themes[{theme_name!r}].overrides[{variable_id!r}]",
                )
            variable = self._variables[variable_id]
            location = f"themes[{theme_name!r}].overrides[{variable_id!r}]"
            normalized[variable_id] = variable._type.validate(
                raw, variable_id, location
            )
        return normalized

    def _replace_state(self, variables, themes):
        """持久化载入成功后的原子状态替换；仅在全部校验通过后调用。"""
        self._variables = variables
        self._themes = themes
        self._children = {name: set() for name in themes}
        for name, theme in themes.items():
            if theme.parent is not None:
                self._children[theme.parent].add(name)
        self._chains.clear()
        self._cache.clear()
        for name in themes:  # 预热链缓存，顺带兜底环检测
            self.inheritance_chain(name)
