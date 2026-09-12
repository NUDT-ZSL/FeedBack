# -*- coding: utf-8 -*-
"""solver.py 的测试。

覆盖：
- 版本号比较（点分补 0、不同长度、alpha/beta/rc 预发布序、大小写、序号）
- 约束解析与 ConstraintSyntaxError（出错片段）
- 三包两跳正常求解、多依赖方合取、最高版本优先、结果确定可复现
- 无解冲突解释（字段内容：包名、父包、约束原文、reason）
- 循环依赖（可解的环 + 环上打架）、64 层深度上限
- 边界：不存在的包、空区间、deps 重复声明、版本列表为空、root 无 deps
- 失败时不返回半成品（resolved 为空）
"""

import copy

import pytest

from solver import (
    ConstraintSyntaxError,
    RecursionLimitError,
    Solver,
    compare_versions,
    parse_constraint,
    parse_version,
)


# --------------------------------------------------------------------------- #
# 版本号比较
# --------------------------------------------------------------------------- #


class TestVersionComparison:
    @pytest.mark.parametrize(
        "a,b,expected",
        [
            # 基本大小关系
            ("1.2.3", "1.2.4", -1),
            ("2.0.0", "1.9.9", 1),
            ("1.2.3", "1.2.3", 0),
            # 不同长度，缺失段补 0
            ("1.2", "1.2.0", 0),
            ("1.2.0.0", "1.2", 0),
            ("1.2.3", "1.2.3.0", 0),
            ("1.2.3.4", "1.2.3", 1),
            ("1.2.3.4", "1.2.3.1", 1),
            ("1", "1.0.0.0", 0),
            # 数值按整数比较，不是字典序
            ("1.10.0", "1.9.0", 1),
            # 预发布排在正式版之前
            ("1.0.0-alpha", "1.0.0", -1),
            ("1.0.0-beta", "1.0.0", -1),
            ("1.0.0-rc", "1.0.0", -1),
            # alpha < beta < rc < release
            ("1.0.0-alpha", "1.0.0-beta", -1),
            ("1.0.0-beta", "1.0.0-rc", -1),
            ("1.0.0-rc", "1.0.0-alpha", 1),
            # 预发布序号
            ("1.0.0-alpha", "1.0.0-alpha2", -1),
            ("1.0.0-alpha2", "1.0.0-beta1", -1),
            ("1.0.0-beta1", "1.0.0-beta2", -1),
            ("1.0.0-rc1", "1.0.0-rc2", -1),
            ("1.0.0-rc2", "1.0.0", -1),
            # 不同基础版本时预发布不影响大序
            ("2.0.0-alpha", "1.9.9", 1),
            # 后缀大小写不敏感
            ("1.0.0-RC1", "1.0.0-rc1", 0),
            ("1.0.0-Alpha", "1.0.0-alpha", 0),
        ],
    )
    def test_ordering(self, a, b, expected):
        assert compare_versions(a, b) == expected
        # 反向比较必须对称
        assert compare_versions(b, a) == -expected

    def test_total_order_chain(self):
        chain = [
            "1.0.0-alpha",
            "1.0.0-alpha2",
            "1.0.0-beta",
            "1.0.0-beta2",
            "1.0.0-rc1",
            "1.0.0-rc9",
            "1.0.0",
            "1.0.1-alpha",
            "1.0.1",
            "1.2",
            "1.2.3",
            "1.2.3.4",
        ]
        for smaller, larger in zip(chain, chain[1:]):
            assert compare_versions(smaller, larger) < 0, (smaller, larger)

    @pytest.mark.parametrize("bad", ["", "   ", "1.a.2", "1..2", ".1.2", "1.2-", "1.2-foo", "1.2.3-gamma"])
    def test_invalid_versions_raise(self, bad):
        with pytest.raises(ConstraintSyntaxError):
            parse_version(bad)

    def test_parse_equal_versions_are_equal(self):
        assert parse_version("1.2") == parse_version("1.2.0.0")
        assert parse_version("1.0-RC2") == parse_version("1.0.0-rc2")


# --------------------------------------------------------------------------- #
# 约束解析
# --------------------------------------------------------------------------- #


class TestConstraintParsing:
    def test_all_operators(self):
        specs = {
            ">=1.0": ">=",
            "<=2.0": "<=",
            ">1.0": ">",
            "<2.0": "<",
            "==1.5.0": "==",
            "!=1.5.0": "!=",
        }
        for spec, expected_op in specs.items():
            parsed = parse_constraint(spec)
            assert len(parsed) == 1
            assert parsed[0][0] == expected_op
            assert parsed[0][1].raw == spec[len(expected_op):]

    def test_conjunction(self):
        parsed = parse_constraint(">=1.2,<2,!=1.5.0")
        assert [(op, ver.raw) for op, ver in parsed] == [
            (">=", "1.2"),
            ("<", "2"),
            ("!=", "1.5.0"),
        ]

    def test_whitespace_tolerated(self):
        parsed = parse_constraint(">= 1.2 , < 2")
        assert [(op, ver.raw) for op, ver in parsed] == [(">=", "1.2"), ("<", "2")]

    def test_blank_spec_means_unconstrained(self):
        assert parse_constraint("") == []
        assert parse_constraint("   ") == []

    @pytest.mark.parametrize(
        "spec,fragment",
        [
            ("1.0", "1.0"),                  # 缺操作符
            ("=1.0", "=1.0"),               # 不支持单等号
            (">=1.0,<", "<"),               # 第二段缺版本
            (">=1.0,,<2.0", ""),            # 空片段
            (">=1.0,", ""),                 # 末尾空片段
            (">>1.0", ">>1.0"),             # 非法操作符
            (">=1.x", ">=1.x"),             # 版本号非法
        ],
    )
    def test_syntax_error_carries_fragment(self, spec, fragment):
        with pytest.raises(ConstraintSyntaxError) as exc_info:
            parse_constraint(spec)
        assert exc_info.value.fragment == fragment

    def test_prerelease_in_constraint(self):
        parsed = parse_constraint(">=1.0.0-rc1")
        assert parsed[0][1] == parse_version("1.0.0-rc1")


# --------------------------------------------------------------------------- #
# 正常求解
# --------------------------------------------------------------------------- #


def v(version, deps=None):
    return {"version": version, "deps": deps or []}


class TestSolveHappyPath:
    def test_three_packages_two_hops(self):
        # app -> lib -> util，三包两跳；每个包多个版本，应选最高可行。
        root = {
            "name": "app",
            "version": "1.0",
            "deps": [{"name": "lib", "spec": ">=1.2,<2"}],
        }
        packages = {
            "lib": [
                v("1.9.0", [{"name": "util", "spec": ">=3.0"}]),
                v("1.5.0", [{"name": "util", "spec": ">=2.0"}]),
                v("1.1.0", []),  # 不满足 root 约束
                v("2.0.0", []),  # 超出 <2
            ],
            "util": [v("3.1.0"), v("3.0.0"), v("2.9.0")],
        }
        result = Solver().solve(root, packages)
        assert result.ok is True
        assert result.conflicts == []
        assert result.resolved == {"lib": "1.9.0", "util": "3.1.0"}

    def test_highest_feasible_with_prereleases(self):
        root = {"name": "app", "deps": [{"name": "lib", "spec": ">=1.0"}]}
        packages = {"lib": [v("2.0.0-rc1"), v("1.5.0"), v("1.5.0-rc3"), v("1.0.0")]}
        result = Solver().solve(root, packages)
        # 正式版 1.5.0 高于一切 1.x 预发布，但 2.0.0-rc1 因基础版本 2 更高而胜出
        assert result.resolved == {"lib": "2.0.0-rc1"}

    def test_multiple_parents_intersection(self):
        # a 与 b 都要 lib：a 要 >=1.0,<2，b 要 >=1.5，合取后 1.9 胜出而非 2.0。
        root = {
            "name": "app",
            "deps": [
                {"name": "a", "spec": "==1.0"},
                {"name": "b", "spec": "==1.0"},
            ],
        }
        packages = {
            "a": [v("1.0", [{"name": "lib", "spec": ">=1.0,<2"}])],
            "b": [v("1.0", [{"name": "lib", "spec": ">=1.5"}])],
            "lib": [v("2.0.0"), v("1.9.0"), v("1.5.0"), v("0.9.0")],
        }
        result = Solver().solve(root, packages)
        assert result.ok
        assert result.resolved["lib"] == "1.9.0"

    def test_backtracking_lower_version_when_highest_fails(self):
        # lib 2.0 要求 util>=2，但 util 只有 1.x；必须回溯到 lib 1.0。
        root = {"name": "app", "deps": [{"name": "lib", "spec": ">=1.0"}]}
        packages = {
            "lib": [
                v("2.0.0", [{"name": "util", "spec": ">=2.0"}]),
                v("1.0.0", [{"name": "util", "spec": ">=1.0"}]),
            ],
            "util": [v("1.5.0")],
        }
        result = Solver().solve(root, packages)
        assert result.ok
        assert result.resolved == {"lib": "1.0.0", "util": "1.5.0"}

    def test_deterministic_repeatable(self):
        root = {"name": "app", "deps": [{"name": "lib", "spec": ""}]}
        packages = {"lib": [v(ver) for ver in ["1.0.0", "3.0.0", "2.0.0"]]}
        first = Solver().solve(root, packages)
        second = Solver().solve(copy.deepcopy(root), copy.deepcopy(packages))
        assert first.resolved == second.resolved == {"lib": "3.0.0"}

    def test_root_without_deps(self):
        result = Solver().solve({"name": "app", "version": "1.0"}, {})
        assert result.ok
        assert result.resolved == {}
        assert result.conflicts == []

    def test_duplicate_dep_entries_same_package_intersect(self):
        # root 的 deps 里对 lib 声明两次：>=1.0 与 <2，合取后 1.x 最高版。
        root = {
            "name": "app",
            "deps": [
                {"name": "lib", "spec": ">=1.0"},
                {"name": "lib", "spec": "<2"},
            ],
        }
        packages = {"lib": [v("2.0.0"), v("1.9.0"), v("0.8.0")]}
        result = Solver().solve(root, packages)
        assert result.ok
        assert result.resolved == {"lib": "1.9.0"}


# --------------------------------------------------------------------------- #
# 冲突与无解
# --------------------------------------------------------------------------- #


class TestConflicts:
    def test_missing_package(self):
        root = {"name": "app", "deps": [{"name": "ghost", "spec": ">=1.0"}]}
        result = Solver().solve(root, {})
        assert result.ok is False
        assert result.resolved == {}  # 不返回半成品
        assert len(result.conflicts) == 1
        conflict = result.conflicts[0]
        assert conflict.package == "ghost"
        assert conflict.reason == "missing"
        # 字段内容：谁要求的、原文是什么
        assert len(conflict.origins) == 1
        origin = conflict.origins[0]
        assert origin.parent == "app"
        assert origin.raw == ">=1.0"

    def test_empty_version_list(self):
        root = {"name": "app", "deps": [{"name": "lib", "spec": ">=1.0"}]}
        result = Solver().solve(root, {"lib": []})
        assert not result.ok
        assert result.resolved == {}
        (conflict,) = result.conflicts
        assert conflict.package == "lib"
        assert conflict.reason == "empty"
        assert conflict.origins[0].parent == "app"
        assert conflict.origins[0].raw == ">=1.0"

    def test_empty_interval_single_spec(self):
        root = {"name": "app", "deps": [{"name": "lib", "spec": ">=2,<1"}]}
        packages = {"lib": [v("1.0.0"), v("2.0.0")]}
        result = Solver().solve(root, packages)
        assert not result.ok
        (conflict,) = result.conflicts
        assert conflict.package == "lib"
        assert conflict.reason == "no_match"
        raws = [o.raw for o in conflict.origins]
        assert raws == [">=2,<1"]
        assert conflict.origins[0].parent == "app"

    def test_conflicting_parents_explanation_has_both_sides(self):
        # a 要 lib<2，b 要 lib>=2：区间为空，解释里必须同时出现 a、b 两个父包
        # 以及两段约束原文。
        root = {
            "name": "app",
            "deps": [
                {"name": "a", "spec": "==1.0"},
                {"name": "b", "spec": "==1.0"},
            ],
        }
        packages = {
            "a": [v("1.0", [{"name": "lib", "spec": "<2"}])],
            "b": [v("1.0", [{"name": "lib", "spec": ">=2"}])],
            "lib": [v("1.9.0"), v("2.0.0"), v("3.0.0")],
        }
        result = Solver().solve(root, packages)
        assert not result.ok
        assert result.resolved == {}
        lib_conflicts = [c for c in result.conflicts if c.package == "lib"]
        assert len(lib_conflicts) == 1
        conflict = lib_conflicts[0]
        assert conflict.reason == "no_match"
        parents = {o.parent for o in conflict.origins}
        assert parents == {"a", "b"}
        by_parent = {o.parent: o.raw for o in conflict.origins}
        assert by_parent["a"] == "<2"
        assert by_parent["b"] == ">=2"

    def test_no_version_satisfies_conjunction_explanation(self):
        # root 直接给合取，排除掉所有版本（!=1.5.0 且只剩 1.5.0 可选区间内）。
        root = {"name": "app", "deps": [{"name": "lib", "spec": ">=1.0,<2,!=1.5.0"}]}
        packages = {"lib": [v("1.5.0"), v("2.0.0")]}
        result = Solver().solve(root, packages)
        assert not result.ok
        (conflict,) = result.conflicts
        assert conflict.package == "lib"
        assert conflict.reason == "no_match"
        assert conflict.origins[0].raw == ">=1.0,<2,!=1.5.0"
        assert conflict.origins[0].parent == "app"

    def test_duplicate_dep_entries_contradictory_explained(self):
        root = {
            "name": "app",
            "deps": [
                {"name": "lib", "spec": ">=2"},
                {"name": "lib", "spec": "<2"},
            ],
        }
        packages = {"lib": [v("1.0.0"), v("2.0.0")]}
        result = Solver().solve(root, packages)
        assert not result.ok
        (conflict,) = result.conflicts
        raws = [o.raw for o in conflict.origins]
        assert raws == [">=2", "<2"]
        assert all(o.parent == "app" for o in conflict.origins)

    def test_missing_transitive_dependency_reports_chain(self):
        # lib 选中后才发现它要的 util 不存在；冲突要指出父包是 lib。
        root = {"name": "app", "deps": [{"name": "lib", "spec": "==1.0"}]}
        packages = {"lib": [v("1.0", [{"name": "util", "spec": ""}])]}
        result = Solver().solve(root, packages)
        assert not result.ok
        util = [c for c in result.conflicts if c.package == "util"]
        assert len(util) == 1
        assert util[0].reason == "missing"
        assert util[0].origins[0].parent == "lib"

    def test_bad_spec_in_unselected_version_still_raises(self):
        # lib 2.0 不会被选中（root 钉 1.0），但其 spec 非法仍须预检报错。
        root = {"name": "app", "deps": [{"name": "lib", "spec": "==1.0"}]}
        packages = {
            "lib": [v("1.0"), v("2.0", [{"name": "util", "spec": "oops"}])],
            "util": [v("1.0")],
        }
        with pytest.raises(ConstraintSyntaxError):
            Solver().solve(root, packages)


# --------------------------------------------------------------------------- #
# 循环依赖与递归深度
# --------------------------------------------------------------------------- #


class TestCyclesAndDepth:
    def test_simple_cycle_resolves(self):
        # a -> b -> a；两版本可行即可解出，不死循环。
        root = {"name": "app", "deps": [{"name": "a", "spec": ">=1.0"}]}
        packages = {
            "a": [
                v("1.0.0", [{"name": "b", "spec": ">=1.0"}]),
            ],
            "b": [
                v("2.0.0", [{"name": "a", "spec": "<2"}]),
                v("1.0.0", [{"name": "a", "spec": ">=2"}]),  # 与 a 1.0 冲突
            ],
        }
        result = Solver().solve(root, packages)
        assert result.ok
        assert result.resolved == {"a": "1.0.0", "b": "2.0.0"}

    def test_cycle_with_contradiction_conflicts(self):
        # a 1 -> b（任何版本都要求 a>=2），环上约束互斥；只能报冲突。
        root = {"name": "app", "deps": [{"name": "a", "spec": "==1.0"}]}
        packages = {
            "a": [v("1.0.0", [{"name": "b", "spec": ""}])],
            "b": [v("1.0.0", [{"name": "a", "spec": ">=2"}])],
        }
        result = Solver().solve(root, packages)
        assert not result.ok
        a_conflicts = [c for c in result.conflicts if c.package == "a"]
        assert a_conflicts, result.conflicts
        conflict = a_conflicts[0]
        parents = {o.parent for o in conflict.origins}
        assert "app" in parents and "b" in parents
        by_parent = {o.parent: o.raw for o in conflict.origins}
        assert by_parent["app"] == "==1.0"
        assert by_parent["b"] == ">=2"

    def test_self_dependency_resolves(self):
        root = {"name": "app", "deps": [{"name": "x", "spec": "==1.0"}]}
        packages = {"x": [v("1.0", [{"name": "x", "spec": "<2"}])]}
        result = Solver().solve(root, packages)
        assert result.ok
        assert result.resolved == {"x": "1.0"}

    def _chain_packages(self, length):
        """root -> p0 -> p1 -> ... -> p(length-1)，直链 length 层。"""
        packages = {}
        for i in range(length):
            if i + 1 < length:
                packages["p%d" % i] = [v("1.0", [{"name": "p%d" % (i + 1), "spec": ""}])]
            else:
                packages["p%d" % i] = [v("1.0")]
        return packages

    def test_chain_at_depth_limit_resolves(self):
        # root 直接依赖为第 1 层；64 层直链（p0..p63）恰好允许。
        packages = self._chain_packages(64)
        root = {"name": "app", "deps": [{"name": "p0", "spec": ""}]}
        result = Solver().solve(root, packages)
        assert result.ok
        assert len(result.resolved) == 64

    def test_chain_beyond_limit_raises(self):
        packages = self._chain_packages(65)
        root = {"name": "app", "deps": [{"name": "p0", "spec": ""}]}
        with pytest.raises(RecursionLimitError):
            Solver().solve(root, packages)

    def test_cycle_does_not_consume_depth_budget(self):
        # 长直链末端挂一个环，环不应累计深度导致误报。
        packages = self._chain_packages(63)
        packages["p62"] = [v("1.0", [{"name": "loopy", "spec": ""}])]
        packages["loopy"] = [v("1.0", [{"name": "loopy", "spec": ""}])]
        root = {"name": "app", "deps": [{"name": "p0", "spec": ""}]}
        result = Solver().solve(root, packages)
        assert result.ok
        assert result.resolved["loopy"] == "1.0"
