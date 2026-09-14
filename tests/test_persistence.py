"""JSON 快照导出/导入往返与损坏文件处理测试。"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from resource_kernel import (
    PersistenceError,
    ResourceKernel,
    export_to_file,
    import_from_file,
)

from tests.hooks import ScriptedHooks


class PersistenceRoundTripTests(unittest.TestCase):
    """导出再导入后状态一致。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "snapshot.json")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _build_busy_kernel(self) -> ResourceKernel:
        hooks = ScriptedHooks(
            init_plan={"b": ["init-oops", None]},
            release_plan={"a": ["timeout", None], "c": ["c1", "c2", "c3"]},
        )
        kernel = ResourceKernel(
            initializer=hooks.initializer,
            releaser=hooks.releaser,
            max_retries=2,
        )
        for name in ("a", "b", "c"):
            kernel.register(name)
        kernel.acquire("a", "owner-a")
        with self.assertRaises(Exception):
            kernel.acquire("b", "owner-b")   # 初始化失败回退
        kernel.acquire("b", "owner-b")
        kernel.acquire("c", "owner-c")
        kernel.release("a")                 # releasing (1/2)
        kernel.release("c")
        kernel.retry("c")                   # failed (2/2)
        kernel.force_cleanup()              # a 在清理中释放成功（b 也被清理释放）
        kernel.acquire("b", "owner-b")      # 归零后重新申请 b，制造占用态快照
        return kernel

    def test_round_trip_preserves_everything(self) -> None:
        kernel = self._build_busy_kernel()
        before = kernel.to_snapshot()
        export_to_file(kernel, self.path)

        restored = ResourceKernel()
        import_from_file(restored, self.path)
        after = restored.to_snapshot()
        self.assertEqual(before, after)

        # 抽查关键字段。
        self.assertEqual(restored.status("a")["state"], "released")
        self.assertEqual(restored.status("b")["state"], "occupied")
        self.assertEqual(restored.status("b")["owner"], "owner-b")
        self.assertEqual(restored.status("b")["occupation_count"], 1)
        self.assertEqual(restored.status("c")["state"], "failed")
        self.assertEqual(restored.status("c")["retry_count"], 3)
        self.assertEqual(restored.list_unreleased()[0]["name"], "b")
        self.assertEqual(len(after["cleanup_history"]), 1)

    def test_empty_system_round_trip(self) -> None:
        kernel = ResourceKernel()
        export_to_file(kernel, self.path)
        restored = ResourceKernel()
        import_from_file(restored, self.path)
        self.assertEqual(restored.list_all(), [])
        self.assertEqual(restored.to_snapshot(), kernel.to_snapshot())

    def test_export_is_valid_utf8_json(self) -> None:
        kernel = ResourceKernel()
        kernel.register("中文句柄")
        export_to_file(kernel, self.path)
        with open(self.path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        self.assertEqual(data["resources"][0]["name"], "中文句柄")


class CorruptSnapshotTests(unittest.TestCase):
    """损坏/非法快照：报错清晰且内存状态保持不变。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "bad.json")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_missing_file(self) -> None:
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError):
            import_from_file(kernel, os.path.join(self._tmp.name, "missing.json"))

    def test_broken_json(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write("{not json")
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError) as ctx:
            import_from_file(kernel, self.path)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_top_level_not_object(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write("[1, 2, 3]")
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError) as ctx:
            import_from_file(kernel, self.path)
        self.assertIn("JSON object", str(ctx.exception))

    def test_missing_resources_field(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump({"version": 1}, handle)
        kernel = ResourceKernel()
        before = kernel.to_snapshot()
        with self.assertRaises(PersistenceError) as ctx:
            import_from_file(kernel, self.path)
        self.assertIn("'resources'", str(ctx.exception))
        self.assertEqual(kernel.to_snapshot(), before)

    def test_duplicate_name_rejected(self) -> None:
        snapshot = {
            "version": 1,
            "max_retries": 3,
            "resources": [
                {"name": "r", "state": "idle", "owner": None,
                 "occupation_count": 0, "retry_count": 0,
                 "last_failure_reason": None, "attempts": []},
                {"name": "r", "state": "idle", "owner": None,
                 "occupation_count": 0, "retry_count": 0,
                 "last_failure_reason": None, "attempts": []},
            ],
        }
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(snapshot, handle)
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError) as ctx:
            import_from_file(kernel, self.path)
        self.assertIn("duplicate resource name", str(ctx.exception))
        self.assertEqual(kernel.list_all(), [])

    def test_illegal_state_rejected(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "version": 1,
                    "resources": [
                        {"name": "r", "state": "zombie", "owner": None,
                         "occupation_count": 0, "attempts": []}
                    ],
                },
                handle,
            )
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError) as ctx:
            import_from_file(kernel, self.path)
        self.assertIn("illegal state", str(ctx.exception))

    def test_negative_count_rejected(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "version": 1,
                    "resources": [
                        {"name": "r", "state": "idle", "owner": None,
                         "occupation_count": -1, "attempts": []}
                    ],
                },
                handle,
            )
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError) as ctx:
            import_from_file(kernel, self.path)
        self.assertIn("occupation_count", str(ctx.exception))

    def test_occupied_without_owner_rejected(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "version": 1,
                    "resources": [
                        {"name": "r", "state": "occupied", "owner": None,
                         "occupation_count": 1, "attempts": []}
                    ],
                },
                handle,
            )
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError) as ctx:
            import_from_file(kernel, self.path)
        self.assertIn("occupied", str(ctx.exception))

    def test_idle_with_owner_rejected(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "version": 1,
                    "resources": [
                        {"name": "r", "state": "idle", "owner": "ghost",
                         "occupation_count": 0, "attempts": []}
                    ],
                },
                handle,
            )
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError) as ctx:
            import_from_file(kernel, self.path)
        self.assertIn("owner", str(ctx.exception))

    def test_occupied_with_zero_count_rejected(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "version": 1,
                    "resources": [
                        {"name": "r", "state": "occupied", "owner": "o",
                         "occupation_count": 0, "attempts": []}
                    ],
                },
                handle,
            )
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError):
            import_from_file(kernel, self.path)

    def test_bad_max_retries_rejected(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(
                {"version": 1, "max_retries": 0, "resources": []}, handle
            )
        kernel = ResourceKernel()
        with self.assertRaises(PersistenceError):
            import_from_file(kernel, self.path)

    def test_failed_import_keeps_memory_intact(self) -> None:
        kernel = ResourceKernel()
        kernel.register("a")
        kernel.acquire("a", "owner-a")
        before = kernel.to_snapshot()
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write("{broken")
        with self.assertRaises(PersistenceError):
            import_from_file(kernel, self.path)
        self.assertEqual(kernel.to_snapshot(), before)
        self.assertEqual(kernel.status("a")["owner"], "owner-a")


if __name__ == "__main__":
    unittest.main()
