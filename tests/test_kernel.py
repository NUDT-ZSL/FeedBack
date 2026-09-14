"""ResourceKernel 状态机与生命周期测试。

覆盖：登记/重复申请拒绝、初始化失败与中断回退、释放失败重试与失败态、
占用最终归零、强制清理与部分失败隔离、查询排序与字段、重置。
"""

from __future__ import annotations

import unittest

from resource_kernel import (
    InvalidStateError,
    ResourceAlreadyExistsError,
    ResourceBusyError,
    ResourceKernel,
    ResourceNotFoundError,
    ResourceNotOccupiedError,
    ResourceState,
)

from tests.hooks import ScriptedHooks


def make_kernel(
    hooks: ScriptedHooks, max_retries: int = 3
) -> ResourceKernel:
    """构造注入了脚本化回调的内核。"""
    return ResourceKernel(
        initializer=hooks.initializer,
        releaser=hooks.releaser,
        max_retries=max_retries,
    )


class RegistrationTests(unittest.TestCase):
    """登记与基本查询。"""

    def test_register_and_status(self) -> None:
        kernel = ResourceKernel()
        kernel.register("db-slot-1")
        status = kernel.status("db-slot-1")
        self.assertEqual(status["name"], "db-slot-1")
        self.assertEqual(status["state"], ResourceState.IDLE.value)
        self.assertIsNone(status["owner"])
        self.assertEqual(status["occupation_count"], 0)
        self.assertEqual(status["retry_count"], 0)
        self.assertIsNone(status["last_failure_reason"])
        self.assertEqual(status["attempts"], [])

    def test_duplicate_registration_rejected(self) -> None:
        kernel = ResourceKernel()
        kernel.register("a")
        with self.assertRaises(ResourceAlreadyExistsError):
            kernel.register("a")

    def test_empty_name_rejected(self) -> None:
        kernel = ResourceKernel()
        with self.assertRaises(ValueError):
            kernel.register("")

    def test_status_unknown_resource(self) -> None:
        kernel = ResourceKernel()
        with self.assertRaises(ResourceNotFoundError):
            kernel.status("ghost")

    def test_list_all_sorted(self) -> None:
        kernel = ResourceKernel()
        for name in ("c", "a", "b"):
            kernel.register(name)
        self.assertEqual([r["name"] for r in kernel.list_all()], ["a", "b", "c"])


class AcquireTests(unittest.TestCase):
    """申请与重复申请拒绝。"""

    def test_acquire_sets_owner_and_count(self) -> None:
        kernel = ResourceKernel()
        kernel.register("lock-x")
        kernel.acquire("lock-x", "worker-1")
        status = kernel.status("lock-x")
        self.assertEqual(status["state"], ResourceState.OCCUPIED.value)
        self.assertEqual(status["owner"], "worker-1")
        self.assertEqual(status["occupation_count"], 1)

    def test_duplicate_acquire_rejected_and_names_holder(self) -> None:
        kernel = ResourceKernel()
        kernel.register("lock-x")
        kernel.acquire("lock-x", "worker-1")
        with self.assertRaises(ResourceBusyError) as ctx:
            kernel.acquire("lock-x", "worker-2")
        # 拒绝信息必须说明当前持有者。
        self.assertIn("worker-1", str(ctx.exception))
        self.assertEqual(ctx.exception.owner, "worker-1")
        # 原归属与计数不变。
        status = kernel.status("lock-x")
        self.assertEqual(status["owner"], "worker-1")
        self.assertEqual(status["occupation_count"], 1)

    def test_same_owner_reacquire_still_rejected(self) -> None:
        kernel = ResourceKernel()
        kernel.register("r")
        kernel.acquire("r", "owner")
        with self.assertRaises(ResourceBusyError):
            kernel.acquire("r", "owner")

    def test_acquire_unknown_resource(self) -> None:
        kernel = ResourceKernel()
        with self.assertRaises(ResourceNotFoundError):
            kernel.acquire("nope", "owner")

    def test_acquire_blank_owner_rejected(self) -> None:
        kernel = ResourceKernel()
        kernel.register("r")
        with self.assertRaises(ValueError):
            kernel.acquire("r", "")


class InitRollbackTests(unittest.TestCase):
    """初始化失败 / 被打断时必须完整回退到空闲。"""

    def test_init_failure_rolls_back_to_idle(self) -> None:
        hooks = ScriptedHooks(init_plan={"r": ["disk full"]})
        kernel = make_kernel(hooks)
        kernel.register("r")
        with self.assertRaises(InvalidStateError) as ctx:
            kernel.acquire("r", "owner-1")
        self.assertIn("rolled back", str(ctx.exception))

        status = kernel.status("r")
        self.assertEqual(status["state"], ResourceState.IDLE.value)
        self.assertIsNone(status["owner"])
        self.assertEqual(status["occupation_count"], 0)
        self.assertNotIn("owner-1", repr(kernel.to_snapshot()))
        # 失败原因可查询，但不残留归属与计数。
        self.assertEqual(status["last_failure_reason"], "disk full")

    def test_init_exception_interrupt_rolls_back(self) -> None:
        hooks = ScriptedHooks(
            init_plan={"r": [RuntimeError("interrupted mid-init")]}
        )
        kernel = make_kernel(hooks)
        kernel.register("r")
        with self.assertRaises(InvalidStateError):
            kernel.acquire("r", "owner-1")
        status = kernel.status("r")
        self.assertEqual(status["state"], ResourceState.IDLE.value)
        self.assertIsNone(status["owner"])
        self.assertEqual(status["occupation_count"], 0)
        self.assertIn("interrupted mid-init", status["last_failure_reason"])

    def test_immediate_reacquire_after_interrupt_succeeds_clean(self) -> None:
        hooks = ScriptedHooks(
            init_plan={"r": ["boom", None]},
        )
        kernel = make_kernel(hooks)
        kernel.register("r")
        with self.assertRaises(InvalidStateError):
            kernel.acquire("r", "owner-old")
        # 回退后立即申请必须成功。
        kernel.acquire("r", "owner-new")
        status = kernel.status("r")
        self.assertEqual(status["state"], ResourceState.OCCUPIED.value)
        self.assertEqual(status["owner"], "owner-new")
        self.assertEqual(status["occupation_count"], 1)
        # 新一轮申请不残留上一次的失败原因与计数。
        self.assertIsNone(status["last_failure_reason"])
        self.assertEqual(status["retry_count"], 0)
        self.assertEqual(status["attempts"], [])

    def test_failed_init_does_not_consume_owner(self) -> None:
        hooks = ScriptedHooks(init_plan={"r": ["x", None]})
        kernel = make_kernel(hooks)
        kernel.register("r")
        with self.assertRaises(InvalidStateError):
            kernel.acquire("r", "A")
        # B 申请时不应看到 A 是持有者。
        kernel.acquire("r", "B")
        self.assertEqual(kernel.status("r")["owner"], "B")


class ReleaseRetryTests(unittest.TestCase):
    """释放失败、重试、失败态与后续接管。"""

    def test_release_success_goes_released_zero(self) -> None:
        kernel = ResourceKernel()
        kernel.register("r")
        kernel.acquire("r", "owner")
        kernel.release("r")
        status = kernel.status("r")
        self.assertEqual(status["state"], ResourceState.RELEASED.value)
        self.assertIsNone(status["owner"])
        self.assertEqual(status["occupation_count"], 0)
        self.assertTrue(kernel.is_clean("r"))

    def test_release_unoccupied_rejected(self) -> None:
        kernel = ResourceKernel()
        kernel.register("r")
        with self.assertRaises(ResourceNotOccupiedError):
            kernel.release("r")

    def test_release_failure_enters_releasing_and_records_reason(self) -> None:
        hooks = ScriptedHooks(release_plan={"r": ["timeout", None]})
        kernel = make_kernel(hooks, max_retries=3)
        kernel.register("r")
        kernel.acquire("r", "owner")
        kernel.release("r")
        status = kernel.status("r")
        self.assertEqual(status["state"], ResourceState.RELEASING.value)
        self.assertIsNone(status["owner"])
        self.assertEqual(status["occupation_count"], 0)
        self.assertEqual(status["retry_count"], 1)
        self.assertEqual(status["last_failure_reason"], "timeout")
        self.assertEqual(len(status["attempts"]), 1)
        self.assertEqual(status["attempts"][0]["reason"], "timeout")

    def test_retry_success_clears_failure(self) -> None:
        hooks = ScriptedHooks(release_plan={"r": ["timeout", None]})
        kernel = make_kernel(hooks)
        kernel.register("r")
        kernel.acquire("r", "owner")
        kernel.release("r")
        kernel.retry("r")
        status = kernel.status("r")
        self.assertEqual(status["state"], ResourceState.RELEASED.value)
        self.assertEqual(status["retry_count"], 0)
        self.assertIsNone(status["last_failure_reason"])
        # 成功尝试也留痕，原因空串。
        self.assertEqual(len(status["attempts"]), 2)
        self.assertEqual(status["attempts"][1]["reason"], "")

    def test_consecutive_failures_reach_failed_state(self) -> None:
        hooks = ScriptedHooks(
            release_plan={"r": ["e1", "e2", "e3", None]}
        )
        kernel = make_kernel(hooks, max_retries=3)
        kernel.register("r")
        kernel.acquire("r", "owner")
        kernel.release("r")  # 1/3 -> releasing
        self.assertEqual(kernel.status("r")["state"], "releasing")
        kernel.retry("r")    # 2/3 -> releasing
        self.assertEqual(kernel.status("r")["state"], "releasing")
        kernel.retry("r")    # 3/3 -> failed
        status = kernel.status("r")
        self.assertEqual(status["state"], ResourceState.FAILED.value)
        self.assertEqual(status["retry_count"], 3)
        self.assertEqual(status["occupation_count"], 0)
        self.assertIsNone(status["owner"])
        self.assertEqual(status["last_failure_reason"], "e3")

    def test_failed_state_can_be_taken_over_and_recovered(self) -> None:
        hooks = ScriptedHooks(release_plan={"r": ["e1", "e2", "e3", None]})
        kernel = make_kernel(hooks, max_retries=3)
        kernel.register("r")
        kernel.acquire("r", "owner")
        kernel.release("r")
        kernel.retry("r")
        kernel.retry("r")  # failed
        # 不能永久卡住：后续清理流程接管重试，外部恢复后成功。
        kernel.retry("r")
        status = kernel.status("r")
        self.assertEqual(status["state"], ResourceState.RELEASED.value)
        self.assertEqual(status["occupation_count"], 0)

    def test_retry_without_pending_release_rejected(self) -> None:
        kernel = ResourceKernel()
        kernel.register("r")
        with self.assertRaises(ResourceNotOccupiedError):
            kernel.retry("r")

    def test_release_exception_counts_as_failure(self) -> None:
        hooks = ScriptedHooks(
            release_plan={"r": [OSError("broken pipe"), None]}
        )
        kernel = make_kernel(hooks)
        kernel.register("r")
        kernel.acquire("r", "owner")
        kernel.release("r")
        self.assertEqual(kernel.status("r")["state"], "releasing")
        self.assertIn("broken pipe", kernel.status("r")["last_failure_reason"])
        kernel.retry("r")
        self.assertEqual(kernel.status("r")["state"], "released")


class EventualZeroTests(unittest.TestCase):
    """任意次申请/中断/失败/重试后，占用最终归零且可干净再申请。"""

    def test_reacquire_after_full_cycle_has_no_residue(self) -> None:
        hooks = ScriptedHooks(
            init_plan={"r": ["init-fail", None, None]},
            release_plan={"r": ["rel-fail", None]},
        )
        kernel = make_kernel(hooks)
        kernel.register("r")

        with self.assertRaises(InvalidStateError):
            kernel.acquire("r", "owner-1")       # 初始化失败回退
        kernel.acquire("r", "owner-1")           # 再申请成功
        kernel.release("r")                      # 释放失败 -> releasing
        self.assertEqual(kernel.status("r")["state"], "releasing")
        kernel.retry("r")                        # 成功 -> released
        self.assertTrue(kernel.is_clean("r"))

        # 归零后再次申请：不得残留上次归属者或计数。
        kernel.acquire("r", "owner-2")
        status = kernel.status("r")
        self.assertEqual(status["owner"], "owner-2")
        self.assertEqual(status["occupation_count"], 1)
        self.assertEqual(status["retry_count"], 0)
        self.assertIsNone(status["last_failure_reason"])
        self.assertEqual(status["attempts"], [])
        self.assertEqual(hooks.init_calls["r"], 3)

    def test_interleaved_multi_resource_eventually_zero(self) -> None:
        # 验收场景：多资源交错申请、初始化中断、释放失败重试。
        hooks = ScriptedHooks(
            init_plan={
                "a": [None],
                "b": ["init-boom", None],
                "c": [None],
            },
            release_plan={
                "a": ["net timeout", None],
                "b": [None],
                "c": ["e1", "e2", None],
            },
        )
        kernel = make_kernel(hooks, max_retries=3)
        for name in ("a", "b", "c"):
            kernel.register(name)

        kernel.acquire("a", "w1")
        with self.assertRaises(InvalidStateError):
            kernel.acquire("b", "w2")          # b 初始化中断
        kernel.acquire("c", "w3")
        kernel.acquire("b", "w2")              # b 立即再申请成功

        # 交错释放：a 失败停在 releasing，b 一次成功，c 失败两次。
        kernel.release("a")
        kernel.release("b")
        kernel.release("c")
        kernel.retry("c")
        self.assertEqual(
            [r["name"] for r in kernel.list_unreleased()], []
        )  # 进入释放流程后计数已交出，均不算占用
        kernel.retry("a")
        kernel.retry("c")

        for name in ("a", "b", "c"):
            status = kernel.status(name)
            self.assertEqual(status["state"], "released", msg=name)
            self.assertEqual(status["occupation_count"], 0, msg=name)
            self.assertIsNone(status["owner"], msg=name)
        self.assertEqual(kernel.list_unreleased(), [])

    def test_stress_deterministic_cycles(self) -> None:
        # 每个资源跑多轮"申请-释放（可能失败重试）"，最终全部归零。
        names = [f"r{i}" for i in range(6)]
        hooks = ScriptedHooks()
        for i, name in enumerate(names):
            hooks.set_init(name, ["init-fail"] if i % 2 == 0 else [])
            hooks.set_release(name, ["rel-fail"] * (i % 3))  # 0/1/2 次失败
        kernel = make_kernel(hooks, max_retries=5)
        for name in names:
            kernel.register(name)

        for cycle in range(4):
            for name in names:
                try:
                    kernel.acquire(name, f"owner-{cycle}")
                except InvalidStateError:
                    # 偶数资源首轮初始化失败回退，立即重新申请必须成功。
                    self.assertEqual(kernel.status(name)["state"], "idle")
                    kernel.acquire(name, f"owner-{cycle}")
                kernel.release(name)
                while kernel.status(name)["state"] == "releasing":
                    kernel.retry(name)
                self.assertEqual(
                    kernel.status(name)["state"], "released", msg=name
                )

        self.assertEqual(kernel.list_unreleased(), [])
        # 全部归零后再申请一轮，全部成功且无残留。
        for name in names:
            kernel.acquire(name, "final-owner")
            self.assertEqual(kernel.status(name)["owner"], "final-owner")
            self.assertEqual(kernel.status(name)["occupation_count"], 1)


class QueryTests(unittest.TestCase):
    """未归零清单与字段查询。"""

    def test_list_unreleased_only_counts_occupied(self) -> None:
        hooks = ScriptedHooks(release_plan={"a": ["x", None]})
        kernel = make_kernel(hooks)
        for name in ("a", "b", "c"):
            kernel.register(name)
        kernel.acquire("a", "o")
        kernel.acquire("b", "o")
        kernel.release("b")                    # released
        kernel.release("a")                    # releasing, count 0
        unreleased = kernel.list_unreleased()
        self.assertEqual(unreleased, [])       # 释放流程中计数已归零

        kernel.acquire("c", "o")
        unreleased = kernel.list_unreleased()
        self.assertEqual([r["name"] for r in unreleased], ["c"])

    def test_list_unreleased_sorted(self) -> None:
        kernel = ResourceKernel()
        for name in ("z", "m", "a"):
            kernel.register(name)
            kernel.acquire(name, "o")
        self.assertEqual(
            [r["name"] for r in kernel.list_unreleased()], ["a", "m", "z"]
        )


class ForceCleanupTests(unittest.TestCase):
    """强制清理：逐项隔离、汇总、人工处理清单。"""

    def test_cleanup_empty_system(self) -> None:
        kernel = ResourceKernel()
        summary = kernel.force_cleanup()
        self.assertEqual(summary["succeeded"], [])
        self.assertEqual(summary["failed"], [])
        self.assertEqual(summary["skipped"], [])
        self.assertEqual(summary["manual_review"], [])

    def test_cleanup_skips_idle_and_released(self) -> None:
        kernel = ResourceKernel()
        kernel.register("idle-r")
        kernel.register("done-r")
        kernel.acquire("done-r", "o")
        kernel.release("done-r")
        summary = kernel.force_cleanup()
        skipped = {item["name"] for item in summary["skipped"]}
        self.assertEqual(skipped, {"idle-r", "done-r"})
        self.assertEqual(summary["succeeded"], [])

    def test_cleanup_partial_failure_isolation(self) -> None:
        hooks = ScriptedHooks(
            release_plan={"good": [None], "bad": ["always"], "also-good": [None]}
        )
        kernel = make_kernel(hooks, max_retries=1)
        for name in ("good", "bad", "also-good"):
            kernel.register(name)
            kernel.acquire(name, "o")
        summary = kernel.force_cleanup()
        self.assertEqual(summary["succeeded"], ["also-good", "good"])
        self.assertEqual([item["name"] for item in summary["failed"]], ["bad"])
        self.assertIn("always", summary["failed"][0]["detail"])
        # 失败资源进入 failed，计数仍归零并进入人工清单。
        self.assertEqual(kernel.status("bad")["state"], "failed")
        self.assertEqual(kernel.status("bad")["occupation_count"], 0)
        self.assertEqual(summary["manual_review"], ["bad"])
        # 其他资源不受影响。
        self.assertEqual(kernel.status("good")["state"], "released")
        self.assertEqual(kernel.status("also-good")["state"], "released")

    def test_cleanup_releases_releasing_and_failed(self) -> None:
        hooks = ScriptedHooks(
            release_plan={
                "pend": ["e1", None],
                "dead": ["e1", "e2", None],
            }
        )
        kernel = make_kernel(hooks, max_retries=2)
        kernel.register("pend")
        kernel.register("dead")
        kernel.acquire("pend", "o")
        kernel.acquire("dead", "o")
        kernel.release("pend")                 # releasing
        kernel.release("dead")
        kernel.retry("dead")                   # failed (2/2)
        summary = kernel.force_cleanup()       # 外部已恢复
        self.assertEqual(sorted(summary["succeeded"]), ["dead", "pend"])
        self.assertEqual(summary["failed"], [])
        self.assertEqual(summary["manual_review"], [])

    def test_cleanup_history_recorded(self) -> None:
        kernel = ResourceKernel()
        kernel.register("r")
        kernel.force_cleanup()
        kernel.force_cleanup()
        snapshot = kernel.to_snapshot()
        self.assertEqual(len(snapshot["cleanup_history"]), 2)

    def test_cleanup_callback_exception_does_not_stop_others(self) -> None:
        hooks = ScriptedHooks(
            release_plan={"boom": [RuntimeError("kaboom")], "fine": [None]}
        )
        kernel = make_kernel(hooks, max_retries=1)
        for name in ("boom", "fine"):
            kernel.register(name)
            kernel.acquire(name, "o")
        summary = kernel.force_cleanup()
        self.assertEqual(summary["succeeded"], ["fine"])
        self.assertEqual([f["name"] for f in summary["failed"]], ["boom"])
        self.assertIn("kaboom", summary["failed"][0]["detail"])


class ResetTests(unittest.TestCase):
    """终态资源重置。"""

    def test_reset_failed_resource(self) -> None:
        hooks = ScriptedHooks(release_plan={"r": ["x", "y"]})
        kernel = make_kernel(hooks, max_retries=2)
        kernel.register("r")
        kernel.acquire("r", "o")
        kernel.release("r")
        kernel.retry("r")
        self.assertEqual(kernel.status("r")["state"], "failed")
        kernel.reset("r")
        status = kernel.status("r")
        self.assertEqual(status["state"], "idle")
        self.assertEqual(status["retry_count"], 0)
        self.assertIsNone(status["last_failure_reason"])
        self.assertEqual(status["attempts"], [])

    def test_reset_occupied_rejected(self) -> None:
        kernel = ResourceKernel()
        kernel.register("r")
        kernel.acquire("r", "o")
        with self.assertRaises(InvalidStateError):
            kernel.reset("r")


if __name__ == "__main__":
    unittest.main()
