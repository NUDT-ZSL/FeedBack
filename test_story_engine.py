"""story_engine 测试 —— 覆盖：

1. 分支命中顺序（同 choice 多分支按列表首条命中即停；all/any/not 组合与各比较符）
2. 重复与迟到事件幂等（不重复触发 on_enter、不推进节点、零变更）
3. 存档 JSON 往返一致（restore 后重放崩溃后那批事件，逐条完全一致）
4. 跨版本迁移补齐（restore 自动 migrate + 直接调用 migrate 链）
5. 非法脚本/存档/事件报错（带 node_id / seq 上下文，状态不半更新）
"""

import copy
import json

import pytest

from story_engine import StoryEngine, StoryError


# --------------------------------------------------------------------- #
# 测试用脚本（script v2，含 v1->v2 迁移）
# --------------------------------------------------------------------- #
def _effect(op, var, value):
    return {"op": op, "var": var, "value": value}


def _leaf(var, cmp, value):
    return {"var": var, "cmp": cmp, "value": value}


SCRIPT = {
    "version": 2,
    "nodes": {
        "start": {
            "on_enter": [],
            "transitions": [
                # 同一 choice "go" 有三条候选，严格从上往下首条命中即停
                {"choice": "go", "when": _leaf("courage", "gte", 10), "to": "hidden"},
                {"choice": "go", "when": _leaf("trust", "gte", 5), "to": "camp"},
                {"choice": "go",
                 "when": {"not": _leaf("locked", "eq", 1)}, "to": "forest"},
            ],
        },
        "hidden": {
            "on_enter": [_effect("set", "been_hidden", 1)],
            "transitions": [
                {"choice": "next", "when": _leaf("been_hidden", "eq", 1), "to": "end"},
            ],
        },
        "camp": {
            "on_enter": [_effect("set", "place", 2), _effect("inc", "trust", 1)],
            "transitions": [
                {"choice": "talk", "when": {"any": [
                    _leaf("place", "eq", 2),   # 恒真
                    _leaf("trust", "lt", 0),
                ]}, "to": "end"},
            ],
        },
        "forest": {
            "on_enter": [_effect("set", "play1", 1)],
            "transitions": [
                {"choice": "next", "when": _leaf("play1", "eq", 1), "to": "end"},
            ],
        },
        "end": {"on_enter": [_effect("set", "done", 1)], "transitions": []},
    },
    "migrations": {
        1: [_effect("set", "intro_seen", 1)],
    },
}


@pytest.fixture
def script():
    return copy.deepcopy(SCRIPT)


@pytest.fixture
def engine(script):
    return StoryEngine(script)


def replay(script, events):
    eng = StoryEngine(copy.deepcopy(script))
    return [eng.apply(e) for e in events]


# --------------------------------------------------------------------- #
# 1. 分支命中顺序
# --------------------------------------------------------------------- #
class TestTransitionOrder:
    def test_first_match_wins_default_falls_to_third_branch(self, engine):
        # courage=0/trust=0 跳过前两条，locked 未设置(=0) 使 not 成立 -> forest
        r = engine.apply({"seq": 1, "choice": "go"})
        assert r["node"] == "forest"
        assert r["applied"] == [_effect("set", "play1", 1)]
        assert r["flags"] == {"play1": 1}
        assert r["rejected"] is None

    def test_second_branch_when_first_condition_fails(self, script):
        eng = StoryEngine(script)
        eng.restore({"version": 2, "node": "start", "flags": {"trust": 9},
                     "last_seq": None, "seen": []})
        r = eng.apply({"seq": 1, "choice": "go"})
        assert r["node"] == "camp"               # courage<10 跳过第 1 条
        assert r["flags"]["place"] == 2
        assert r["flags"]["trust"] == 10         # on_enter: inc trust 1
        assert "been_hidden" not in r["flags"]

    def test_first_branch_wins_even_if_second_also_true(self, script):
        eng = StoryEngine(script)
        eng.restore({"version": 2, "node": "start",
                     "flags": {"courage": 10, "trust": 9},
                     "last_seq": None, "seen": []})
        r = eng.apply({"seq": 1, "choice": "go"})
        assert r["node"] == "hidden"             # 第 1 条优先，不会落到 camp
        assert r["flags"] == {"courage": 10, "trust": 9, "been_hidden": 1}

    def test_all_branches_fail_when_locked(self, engine):
        engine.restore({"version": 2, "node": "start", "flags": {"locked": 1},
                        "last_seq": None, "seen": []})
        r = engine.apply({"seq": 1, "choice": "go"})
        assert r == {"rejected": "no_transition", "seq": 1}
        snap = engine.snapshot()
        assert snap["node"] == "start"
        assert snap["flags"] == {"locked": 1}    # 零变更

    def test_unknown_choice_is_no_transition(self, engine):
        r = engine.apply({"seq": 1, "choice": "does_not_exist"})
        assert r == {"rejected": "no_transition", "seq": 1}
        assert engine.snapshot()["node"] == "start"

    @pytest.mark.parametrize("cmp,threshold,value,expected", [
        ("eq", 1, 1, True), ("eq", 1, 2, False),
        ("gt", 1, 2, True), ("gt", 1, 1, False),
        ("gte", 1, 1, True), ("gte", 2, 1, False),
        ("lt", 2, 1, True), ("lt", 1, 1, False),
        ("lte", 1, 1, True), ("lte", 0, 1, False),
    ])
    def test_all_leaf_comparators(self, cmp, threshold, value, expected):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": [
                    {"choice": "go", "when": _leaf("x", cmp, threshold), "to": "b"},
                ]},
                "b": {"on_enter": [], "transitions": []},
            },
        }
        eng = StoryEngine(script)
        if value:
            eng.restore({"version": 1, "node": "a", "flags": {"x": value},
                         "last_seq": None, "seen": []})
        r = eng.apply({"seq": 1, "choice": "go"})
        if expected:
            assert r["node"] == "b"
        else:
            assert r["rejected"] == "no_transition"

    def test_unset_flag_defaults_to_zero(self):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": [
                    {"choice": "go", "when": _leaf("n", "lte", 0), "to": "b"},
                ]},
                "b": {"on_enter": [], "transitions": []},
            },
        }
        r = StoryEngine(script).apply({"seq": 1, "choice": "go"})
        assert r["node"] == "b"

    def test_not_all_any_composition(self):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": [
                    {"choice": "x", "to": "b", "when": {"not": {"all": [
                        _leaf("p", "eq", 1),
                        {"any": [_leaf("q", "gt", 0), _leaf("r", "lt", 0)]},
                    ]}}},
                ]},
                "b": {"on_enter": [_effect("set", "reached", 1)], "transitions": []},
            },
        }
        # p=1 且 (q>0 或 r<0) -> 内层 all 真 -> not 假 -> 无匹配
        eng = StoryEngine(copy.deepcopy(script))
        eng.restore({"version": 1, "node": "a", "flags": {"p": 1, "q": 5},
                     "last_seq": None, "seen": []})
        assert eng.apply({"seq": 1, "choice": "x"})["rejected"] == "no_transition"

        # q/r 都不满足 -> all 假 -> not 真 -> 命中
        eng2 = StoryEngine(copy.deepcopy(script))
        eng2.restore({"version": 1, "node": "a",
                      "flags": {"p": 1, "q": 0, "r": 0},
                      "last_seq": None, "seen": []})
        r = eng2.apply({"seq": 1, "choice": "x"})
        assert r["node"] == "b" and r["flags"]["reached"] == 1

    def test_inc_then_unset_removes_flag(self):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": [
                    {"choice": "go", "when": _leaf("n", "lte", 0), "to": "b"},
                ]},
                "b": {"on_enter": [
                    _effect("inc", "n", 3),
                    _effect("unset", "n", 0),  # unset 的 value 按规范仍为 int，求值时忽略
                ], "transitions": []},
            },
        }
        r = StoryEngine(script).apply({"seq": 1, "choice": "go"})
        assert r["node"] == "b"
        assert r["flags"] == {}              # inc 后又被 unset 移除


# --------------------------------------------------------------------- #
# 2. 重复与迟到事件幂等
# --------------------------------------------------------------------- #
class TestIdempotency:
    def test_duplicate_seq_rejected_with_zero_change(self, engine):
        r1 = engine.apply({"seq": 5, "choice": "go"})
        assert r1["node"] == "forest"
        snap_before = engine.snapshot()

        r2 = engine.apply({"seq": 5, "choice": "go"})
        assert r2 == {"rejected": "duplicate", "seq": 5}
        assert engine.snapshot() == snap_before   # on_enter 没重复触发

    def test_duplicate_seq_with_different_choice_still_rejected(self, engine):
        engine.apply({"seq": 7, "choice": "go"})
        r = engine.apply({"seq": 7, "choice": "talk"})
        assert r == {"rejected": "duplicate", "seq": 7}
        assert engine.snapshot()["node"] == "forest"

    def test_late_event_below_watermark_is_duplicate(self, engine):
        engine.apply({"seq": 10, "choice": "go"})    # -> forest
        engine.apply({"seq": 11, "choice": "next"})  # -> end
        snap = engine.snapshot()
        r = engine.apply({"seq": 9, "choice": "next"})  # 迟到
        assert r == {"rejected": "duplicate", "seq": 9}
        assert engine.snapshot() == snap

    def test_gap_then_late_event(self, engine):
        # 10 到 forest，12 跳号到 end，之后 11 到达（< 水位线 12）-> duplicate
        assert engine.apply({"seq": 10, "choice": "go"})["node"] == "forest"
        assert engine.apply({"seq": 12, "choice": "next"})["node"] == "end"
        r = engine.apply({"seq": 11, "choice": "next"})
        assert r == {"rejected": "duplicate", "seq": 11}

    def test_no_transition_does_not_consume_seq(self, engine):
        assert engine.apply({"seq": 3, "choice": "nope"})["rejected"] == "no_transition"
        r = engine.apply({"seq": 3, "choice": "go"})  # 同一 seq 仍可正常投递
        assert r["node"] == "forest"


# --------------------------------------------------------------------- #
# 3. 存档 JSON 往返 + 崩溃重放一致
# --------------------------------------------------------------------- #
class TestSnapshotRestore:
    def test_json_roundtrip_and_crash_replay(self, script):
        prefix = [{"seq": 1, "choice": "go"}]
        suffix = [{"seq": 2, "choice": "next"}]

        # 崩溃前：先跑前缀，存档，再跑后缀
        eng = StoryEngine(copy.deepcopy(script))
        prefix_results = [eng.apply(e) for e in prefix]
        snap = json.loads(json.dumps(eng.snapshot()))
        suffix_results = [eng.apply(e) for e in suffix]

        # 崩溃后：从存档恢复，重放后缀，逐条结果必须一致
        eng2 = StoryEngine(copy.deepcopy(script))
        eng2.restore(snap)
        replayed_suffix = [eng2.apply(e) for e in suffix]
        assert replayed_suffix == suffix_results

        # 拼起来等于从头跑完整事件流
        full = prefix + suffix
        assert prefix_results + suffix_results == replay(script, full)
        # 重放结束后两边存档也一致
        assert eng2.snapshot() == eng.snapshot()

    def test_restore_then_duplicate_old_event(self, script):
        eng = StoryEngine(copy.deepcopy(script))
        eng.apply({"seq": 1, "choice": "go"})
        eng2 = StoryEngine(copy.deepcopy(script))
        eng2.restore(json.loads(json.dumps(eng.snapshot())))
        assert eng2.apply({"seq": 1, "choice": "go"}) == {
            "rejected": "duplicate", "seq": 1}
        assert eng2.snapshot()["node"] == "forest"

    def test_fresh_snapshot_roundtrip(self, engine):
        raw = json.dumps(engine.snapshot())
        engine.restore(json.loads(raw))
        assert engine.snapshot()["node"] == "start"
        assert engine.snapshot()["last_seq"] is None

    def test_snapshot_is_deep_copy(self, engine):
        engine.apply({"seq": 1, "choice": "go"})
        snap = engine.snapshot()
        snap["flags"]["play1"] = 999
        snap["seen"].append(12345)
        real = engine.snapshot()
        assert real["flags"]["play1"] == 1
        assert 12345 not in real["seen"]

    def test_apply_result_flags_is_copy(self, engine):
        r = engine.apply({"seq": 1, "choice": "go"})
        r["flags"]["play1"] = 42
        assert engine.snapshot()["flags"]["play1"] == 1

    def test_constructor_does_not_fire_start_on_enter(self):
        # 构造不等于“进入起始节点”：起始节点 on_enter 不应触发
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [_effect("set", "boot", 1)], "transitions": [
                    {"choice": "x", "when": _leaf("boot", "eq", 0), "to": "b"},
                ]},
                "b": {"on_enter": [], "transitions": []},
            },
        }
        eng = StoryEngine(script)
        assert eng.snapshot()["flags"] == {}
        assert eng.apply({"seq": 1, "choice": "x"})["node"] == "b"


# --------------------------------------------------------------------- #
# 4. 跨版本迁移
# --------------------------------------------------------------------- #
class TestMigration:
    def test_restore_old_snapshot_auto_migrates(self, engine):
        old = {"version": 1, "node": "start", "flags": {"trust": 3},
               "last_seq": 4, "seen": [3, 4]}
        engine.restore(old)
        snap = engine.snapshot()
        assert snap["version"] == 2
        assert snap["flags"]["intro_seen"] == 1   # v1->v2 迁移补齐
        assert snap["flags"]["trust"] == 3         # 原有旗标保留
        assert snap["last_seq"] == 4
        assert snap["node"] == "start"

    def test_restore_does_not_mutate_input(self, engine):
        old = {"version": 1, "node": "start", "flags": {"trust": 3},
               "last_seq": None, "seen": []}
        saved = copy.deepcopy(old)
        engine.restore(old)
        assert old == saved

    def test_migrate_standalone_chain(self, script):
        script["version"] = 3
        script["migrations"][2] = [_effect("inc", "intro_seen", 1)]
        eng = StoryEngine(script)
        old = {"version": 1, "node": "start", "flags": {},
               "last_seq": None, "seen": []}
        out = eng.migrate(old, 3)
        assert out["version"] == 3
        assert out["flags"]["intro_seen"] == 2      # 先 set 1 再 inc 1
        assert eng.snapshot()["flags"] == {}        # 引擎自身状态不受影响
        assert old["version"] == 1                  # 入参不改

    def test_migrate_same_version_is_noop(self, engine):
        old = {"version": 2, "node": "start", "flags": {"a": 1},
               "last_seq": None, "seen": []}
        assert engine.migrate(old, 2) == old

    def test_missing_migration_raises_and_leaves_state_clean(self, script):
        script["version"] = 3   # 只有 1->2 规则，缺 2->3
        eng = StoryEngine(script)
        old = {"version": 1, "node": "start", "flags": {},
               "last_seq": None, "seen": []}
        with pytest.raises(StoryError, match="missing migration"):
            eng.restore(old)
        snap = eng.snapshot()                        # 失败后仍是初始状态
        assert snap["node"] == "start" and snap["flags"] == {}

    def test_failed_restore_keeps_previous_state(self, engine):
        engine.apply({"seq": 1, "choice": "go"})     # 已走到 forest
        bad = {"version": 2, "node": "ghost", "flags": {},
               "last_seq": None, "seen": []}
        with pytest.raises(StoryError):
            engine.restore(bad)
        snap = engine.snapshot()                     # 旧状态完好
        assert snap["node"] == "forest"
        assert snap["flags"] == {"play1": 1}

    def test_newer_snapshot_than_script_raises(self, engine):
        with pytest.raises(StoryError, match="newer than script"):
            engine.restore({"version": 9, "node": "start", "flags": {},
                            "last_seq": None, "seen": []})

    def test_migrate_target_too_new(self, engine):
        snap = {"version": 2, "node": "start", "flags": {},
                "last_seq": None, "seen": []}
        with pytest.raises(StoryError, match="newer than script"):
            engine.migrate(snap, 99)

    def test_migrate_downgrade_rejected(self, engine):
        snap = {"version": 2, "node": "start", "flags": {},
                "last_seq": None, "seen": []}
        with pytest.raises(StoryError, match="downgrade"):
            engine.migrate(snap, 1)


# --------------------------------------------------------------------- #
# 5. 非法脚本 / 条件 / 事件
# --------------------------------------------------------------------- #
class TestInvalidScript:
    def test_transition_to_missing_node_raises_with_node_id(self):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": [
                    {"choice": "go", "when": _leaf("x", "eq", 0), "to": "ghost"},
                ]},
            },
        }
        with pytest.raises(StoryError, match="'a'"):
            StoryEngine(script)

    def test_bad_leaf_cmp_raises_with_node_id(self):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": [
                    {"choice": "go",
                     "when": {"var": "x", "cmp": "==", "value": 0}, "to": "b"},
                ]},
                "b": {"on_enter": [], "transitions": []},
            },
        }
        with pytest.raises(StoryError, match="'a'"):
            StoryEngine(script)

    def test_empty_all_raises(self):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": [
                    {"choice": "go", "when": {"all": []}, "to": "b"},
                ]},
                "b": {"on_enter": [], "transitions": []},
            },
        }
        with pytest.raises(StoryError, match="'a'"):
            StoryEngine(script)

    def test_not_condition_wrong_shape(self):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": [
                    {"choice": "go", "when": {"not": []}, "to": "b"},
                ]},
                "b": {"on_enter": [], "transitions": []},
            },
        }
        with pytest.raises(StoryError, match="'a'"):
            StoryEngine(script)

    def test_cond_with_two_operator_keys(self):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": [
                    {"choice": "go",
                     "when": {"var": "x", "cmp": "eq", "value": 0,
                              "all": [_leaf("y", "eq", 0)]},
                     "to": "b"},
                ]},
                "b": {"on_enter": [], "transitions": []},
            },
        }
        with pytest.raises(StoryError):
            StoryEngine(script)

    def test_bad_effect_op_raises_with_node_id(self):
        script = {
            "version": 1,
            "nodes": {
                "a": {"on_enter": [], "transitions": []},
                "b": {"on_enter": [{"op": "add", "var": "x", "value": 1}],
                      "transitions": []},
            },
        }
        with pytest.raises(StoryError, match="'b'"):
            StoryEngine(script)

    def test_root_must_be_object(self):
        with pytest.raises(StoryError):
            StoryEngine([])

    def test_missing_version(self):
        with pytest.raises(StoryError):
            StoryEngine({"nodes": {"a": {"on_enter": [], "transitions": []}}})

    def test_empty_nodes(self):
        with pytest.raises(StoryError):
            StoryEngine({"version": 1, "nodes": {}})

    def test_bool_is_not_int_for_version(self):
        with pytest.raises(StoryError):
            StoryEngine({"version": True, "nodes": {
                "a": {"on_enter": [], "transitions": []}}})

    def test_invalid_event_seq(self, engine):
        with pytest.raises(StoryError, match="seq"):
            engine.apply({"seq": "1", "choice": "go"})

    def test_invalid_event_choice_mentions_seq(self, engine):
        with pytest.raises(StoryError, match="seq=1"):
            engine.apply({"seq": 1, "choice": 42})

    def test_restore_bad_node(self, engine):
        with pytest.raises(StoryError):
            engine.restore({"version": 2, "node": "ghost", "flags": {},
                            "last_seq": None, "seen": []})
