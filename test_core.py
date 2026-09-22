# -*- coding: utf-8 -*-
"""核心逻辑验证：循环依赖、调度、失败传播与恢复、完工顺序一致性、
素材替换影响范围、机器暂停、断点续跑。运行: python test_core.py"""
from __future__ import annotations

import os
import tempfile

from scheduler_core import (Machine, Material, Task, build_dependencies,
                            detect_cycle, load_manifest)
from scheduler_engine import (AFFECTED, BLOCKED, DONE, FAILED, RUNNING,
                              WAITING, Engine)


def _mat(tid, **kw):
    base = dict(duration=3, uses=[], depends_on=[], produces=[], machine_type="any")
    base.update(kw, id=tid, name=tid)
    return Task(**base)


def _mach(mid, windows=None, mtype="any"):
    return Machine(mid, mid, mtype, windows or [(0, 10 ** 9)])


def _run(eng, ticks):
    for _ in range(ticks):
        with eng.lock:
            eng._tick()


def test_implicit_deps_and_cycle():
    tasks = {
        "a": _mat("a", produces=["x"]),
        "b": _mat("b", uses=["x"]),                       # 隐式依赖 a
        "c": _mat("c", uses=["x"], depends_on=["b"]),
    }
    deps = build_dependencies(tasks)
    assert deps["b"] == {"a"}, deps
    assert deps["c"] == {"a", "b"}, deps

    bad = {"a": _mat("a", depends_on=["c"]),
           "b": _mat("b", depends_on=["a"]),
           "c": _mat("c", depends_on=["b"])}
    try:
        Engine({}, {}, bad)
    except ValueError as e:
        assert "循环依赖" in str(e)
    else:
        raise AssertionError("循环依赖未被拒绝")
    print("ok  隐式依赖识别 + 循环依赖拒绝")


def _chain_manifest():
    # 链 t01 -> t02 -> t03（通过中间素材 x/y），t04 与链无关
    tasks = {
        "t01": _mat("t01", duration=3, produces=["x"]),
        "t02": _mat("t02", duration=4, uses=["x"], produces=["y"]),
        "t03": _mat("t03", duration=4, uses=["y"]),
        "t04": _mat("t04", duration=2),
    }
    machines = {"m1": _mach("m1"), "m2": _mach("m2")}
    return machines, tasks


def test_failure_isolation_and_order():
    machines, tasks = _chain_manifest()
    eng0 = Engine({}, machines, tasks, tick_sim=1)
    _run(eng0, 60)
    normal = eng0.completion_order

    machines, tasks = _chain_manifest()
    eng = Engine({}, machines, tasks, tick_sim=1)
    blocked_seen = None
    for i in range(60):
        if i == 4 and eng.status["t02"] == RUNNING:
            assert eng.fail_task("t02")
            blocked_seen = dict(eng.status)
            eng.retry_task("t02")  # 立即重试，自动恢复受阻下游
        with eng.lock:
            eng._tick()
        if eng.finished:
            break
    # 只有下游 t03 受阻，无关任务 t04 未受阻且继续推进
    assert blocked_seen["t03"] == BLOCKED
    assert blocked_seen["t04"] in (RUNNING, DONE)
    assert all(s == DONE for s in eng.status.values()), eng.status
    assert eng.completion_order == normal, (eng.completion_order, normal)
    print("ok  失败只阻断下游、重试自动恢复、完工顺序一致:", " -> ".join(normal))


def test_blocked_stays_until_retry():
    machines, tasks = _chain_manifest()
    eng = Engine({}, machines, tasks, tick_sim=1)
    for i in range(6):
        if i == 4 and eng.status["t02"] == RUNNING:
            eng.fail_task("t02")
        with eng.lock:
            eng._tick()
    assert eng.status["t02"] == FAILED
    assert eng.status["t03"] == BLOCKED
    assert eng.status["t04"] == DONE
    assert eng.retry_task("t02")
    _run(eng, 30)
    assert eng.status["t03"] == DONE
    print("ok  未重试前下游保持受阻，重试后恢复完成")


def test_machine_window_and_pause():
    tasks = {"a": _mat("a", duration=5, machine_type="gpu"),
             "b": _mat("b", duration=5, machine_type="gpu")}
    machines = {"g1": _mach("g1", [(0, 3)], "gpu"),   # 时段内放不下 5s
                "g2": _mach("g2", [(0, 99)], "gpu")}
    eng = Engine({}, machines, tasks, tick_sim=1)
    _run(eng, 1)
    assert eng.status["a"] == RUNNING and eng.on_machine["a"] == "g2"
    eng.pause_machine("g2")  # 暂停后任务被撤下，队列等待
    _run(eng, 1)
    assert eng.status["a"] == WAITING and eng.on_machine == {}
    machines["g1"].windows = [(0, 99)]  # g1 可用后接力
    eng.resume_machine("g2")
    _run(eng, 12)
    assert all(s == DONE for s in eng.status.values()), eng.status
    print("ok  可用时段约束 + 机器暂停/恢复后队列重新安排")


def test_material_replace():
    materials = {"x": Material("x", "素材x")}
    tasks = {
        "a": _mat("a", duration=1, produces=["x"]),
        "b": _mat("b", duration=1, uses=["x"]),
        "c": _mat("c", duration=1, depends_on=["b"]),
        "d": _mat("d", duration=8, uses=["x"]),   # 替换时尚未开始
    }
    machines = {"m": _mach("m")}
    eng = Engine(materials, machines, tasks, tick_sim=1)
    _run(eng, 5)
    assert eng.status["b"] == DONE and eng.status["c"] == DONE
    assert eng.status["d"] in (RUNNING, WAITING)
    eng.replace_material("x")  # b 已完成、d 进行中 -> 都受影响；a 是产出方不算
    affected = eng.material_pending["x"]["tasks"]
    assert "b" in affected and "d" in affected and "a" not in affected
    assert eng.status["b"] == AFFECTED
    eng.material_decision("x", rerun=True)
    # b 及其下游 c 一并重跑；a 未受影响保持完成
    assert eng.status["a"] == DONE
    assert eng.status["b"] == WAITING and eng.status["c"] == WAITING
    _run(eng, 20)
    assert all(s == DONE for s in eng.status.values()), eng.status
    print("ok  素材替换圈定受影响范围，重跑级联下游并最终全部完成")


def test_checkpoint_resume():
    materials = {"x": Material("x", "素材x")}
    tasks = {"a": _mat("a", duration=3, produces=["x"]),
             "b": _mat("b", duration=3, uses=["x"])}
    machines = {"m": _mach("m")}
    with tempfile.TemporaryDirectory() as td:
        cp = os.path.join(td, "state.json")
        eng = Engine(materials, machines, tasks, checkpoint_path=cp, tick_sim=1)
        _run(eng, 4)
        assert eng.status["a"] == DONE and eng.status["b"] == RUNNING
        materials2 = {"x": Material("x", "素材x")}
        eng2 = Engine(materials2,
                      {"m": _mach("m")},
                      {k: Task(v.id, v.name, v.duration, v.uses, v.depends_on,
                               v.produces, v.machine_type)
                       for k, v in tasks.items()},
                      checkpoint_path=cp, tick_sim=1)
        assert eng2.now == 4 and eng2.status["a"] == DONE
        _run(eng2, 6)
        assert all(s == DONE for s in eng2.status.values())
    print("ok  检查点落盘并从断点恢复，无需从头再来")


def test_manifest_sample():
    materials, machines, tasks = load_manifest(
        os.path.join(os.path.dirname(__file__), "manifest.json"))
    deps = build_dependencies(tasks)
    detect_cycle(deps)
    assert deps["t04"] == {"t01"}          # uses m_cut_a -> 隐式依赖 t01
    assert deps["t10"] == {"t01", "t03"}   # m_cut_a / m_cut_b
    eng = Engine(materials, machines, tasks, tick_sim=1)
    _run(eng, 300)
    assert all(s == DONE for s in eng.status.values()), eng.status
    print("ok  示例清单整批排程完成，共", len(tasks), "个任务")


if __name__ == "__main__":
    test_implicit_deps_and_cycle()
    test_failure_isolation_and_order()
    test_blocked_stays_until_retry()
    test_machine_window_and_pause()
    test_material_replace()
    test_checkpoint_resume()
    test_manifest_sample()
    print("\n全部测试通过")
