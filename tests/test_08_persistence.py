"""需求 8：JSON 保存/载入——唯一性、合法性、无重叠、不超载重校验；
损坏或字段缺失清晰报错，失败不产生半成品状态。"""

import json
import os
import tempfile
import unittest

from loading import (
    Cargo,
    LoadingSystem,
    PersistenceError,
    Vehicle,
    load_from_file,
    save_to_file,
)
from loading.geometry import Box

from tests._helpers import assert_plan_valid, plan_snapshot


def _populated():
    s = LoadingSystem()
    s.add_vehicle(
        Vehicle("V1", 10, 4, 4, 1000, blocked=(Box(8, 0, 0, 2, 4, 4),))
    )
    s.add_vehicle(Vehicle("V2", 6, 4, 4, 500))
    for i, (d, w, lim, fr) in enumerate(
        [(2, 100, 1, False), (2, 50, 1, False), (3, 200, 0, False),
         (1, 20, 0, True), (2, 300, 1, False)]
    ):
        s.add_cargo(Cargo(f"C{i}", d, d, d, weight=w, stack_limit=lim, fragile=fr))
    s.plan_all()
    return s


class PersistenceRoundTripTest(unittest.TestCase):
    def test_round_trip_preserves_everything(self):
        s = _populated()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "plan.json")
            save_to_file(s, path)
            loaded = load_from_file(path)
        self.assertEqual(plan_snapshot(loaded), plan_snapshot(s))
        self.assertEqual(set(loaded.cargos), set(s.cargos))
        self.assertEqual(set(loaded.vehicles), set(s.vehicles))
        for cid, c in s.cargos.items():
            lc = loaded.cargos[cid]
            self.assertEqual((lc.dims, lc.weight, lc.stack_limit, lc.fragile),
                             (c.dims, c.weight, c.stack_limit, c.fragile))
        for vid, v in s.vehicles.items():
            lv = loaded.vehicles[vid]
            self.assertEqual(lv.blocked, v.blocked)
            self.assertEqual(lv.max_weight, v.max_weight)
        assert_plan_valid(self, loaded)
        # 载入后系统可继续做增量重排
        loaded.add_cargo(Cargo("NEW", 1, 1, 1, weight=5))
        self.assertEqual(plan_snapshot(loaded) is not None, True)

    def test_records_persisted(self):
        s = _populated()
        s.add_cargo(Cargo("Z9", 1, 1, 1, weight=5))
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "plan.json")
            save_to_file(s, path)
            loaded = load_from_file(path)
        self.assertEqual(len(loaded.records), len(s.records))
        self.assertEqual(loaded.records[-1]["action"], "add_cargo")

    def test_save_without_plan(self):
        s = LoadingSystem()
        s.add_cargo(Cargo("C1", 1, 1, 1, weight=1))
        s.add_vehicle(Vehicle("V1", 2, 2, 2, 100))
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "plan.json")
            save_to_file(s, path)
            loaded = load_from_file(path)
        self.assertIsNone(loaded.plan)
        self.assertIn("C1", loaded.cargos)


class CorruptFileTest(unittest.TestCase):
    def setUp(self):
        s = _populated()
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "plan.json")
        save_to_file(s, self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def _raw(self):
        with open(self.path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _write_raw(self, data):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def _mutate(self, mutate):
        data = self._raw()
        mutate(data)
        self._write_raw(data)

    def assertLoadFails(self, needle=""):
        with self.assertRaises(PersistenceError) as cm:
            load_from_file(self.path)
        self.assertIn(needle, str(cm.exception))
        return cm.exception

    def test_broken_json(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write('{"cargos": [,]}')
        self.assertLoadFails("JSON")

    def test_missing_top_level_field(self):
        data = self._raw()
        del data["vehicles"]
        self._write_raw(data)
        self.assertLoadFails("vehicles")

    def test_wrong_format_marker(self):
        self._mutate(lambda d: d.__setitem__("format", "other"))
        self.assertLoadFails("格式")

    def test_missing_cargo_field(self):
        self._mutate(lambda d: d["cargos"][0].pop("weight"))
        self.assertLoadFails("weight")

    def test_bad_cargo_dimension(self):
        self._mutate(lambda d: d["cargos"][0].__setitem__("height", -3))
        self.assertLoadFails("height")

    def test_duplicate_cargo_id(self):
        self._mutate(lambda d: d["cargos"][1].__setitem__("id", d["cargos"][0]["id"]))
        self.assertLoadFails("重复")

    def test_duplicate_vehicle_id(self):
        self._mutate(lambda d: d["vehicles"][1].__setitem__("id", d["vehicles"][0]["id"]))
        self.assertLoadFails("重复")

    def test_blocked_zone_outside_interior(self):
        self._mutate(lambda d: d["vehicles"][0]["blocked"][0].__setitem__("dx", 99))
        self.assertLoadFails("车厢")

    def test_plan_references_unknown_cargo(self):
        self._mutate(lambda d: d["plan"]["V1"][0].__setitem__("cargo", "GHOST"))
        self.assertLoadFails("不存在的货物")

    def test_plan_references_unknown_vehicle(self):
        self._mutate(lambda d: d["plan"].__setitem__("GHOST", []))
        self.assertLoadFails("不存在的车厢")

    def test_plan_duplicate_loading(self):
        first = self._raw()["plan"]["V1"][0]
        self._mutate(lambda d: d["plan"]["V1"].append(dict(first)))
        self.assertLoadFails("重复装载")

    def test_plan_overlap(self):
        # 把 V1 内第二件挪到与第一件完全重合
        self._mutate(lambda d: d["plan"]["V1"][1].update(
            x=d["plan"]["V1"][0]["x"], y=0, z=0, orientation=[0, 1, 2]))
        self.assertLoadFails("非法")

    def test_plan_overweight(self):
        # 把最重货物的两份重量相关数据保留，只调大车厢载重限制的反面：
        # 直接把货物重量调到超过方案所在车厢容量
        def m(d):
            for c in d["cargos"]:
                c["weight"] = 900
        self._mutate(m)
        self.assertLoadFails("载重")

    def test_plan_stack_violation(self):
        # 独立构造确定叠放：A(底)、B 在 A 正上方第 2 层；再把 A 的
        # stack_limit 改为 0，载入必须按堆叠超限拒绝。
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 2, 2, 6, 10000))
        s.add_cargo(Cargo("A", 2, 2, 2, weight=1, stack_limit=1))
        s.add_cargo(Cargo("B", 2, 2, 2, weight=1, stack_limit=1))
        s.plan_all()
        spath = os.path.join(self.tmp.name, "stack.json")
        save_to_file(s, spath)
        with open(spath, "r", encoding="utf-8") as f:
            data = json.load(f)
        for c in data["cargos"]:
            if c["id"] == "A":
                c["stack_limit"] = 0
        with open(spath, "w", encoding="utf-8") as f:
            json.dump(data, f)
        with self.assertRaises(PersistenceError) as cm:
            load_from_file(spath)
        self.assertIn("可堆叠层数", str(cm.exception))

    def test_plan_missing_cargo(self):
        # 从方案中删掉一件货物的放置记录
        self._mutate(lambda d: d["plan"]["V1"].pop())
        self.assertLoadFails("未被装载")

    def test_bad_orientation(self):
        self._mutate(lambda d: d["plan"]["V1"][0].__setitem__(
            "orientation", [0, 0, 1]))
        self.assertLoadFails("朝向")

    def test_bad_coordinates(self):
        self._mutate(lambda d: d["plan"]["V1"][0].__setitem__("x", -1))
        self.assertLoadFails("不能为负")

    def test_missing_placement_field(self):
        self._mutate(lambda d: d["plan"]["V1"][0].pop("z"))
        self.assertLoadFails("缺少字段")

    def test_failure_leaves_caller_state_untouched(self):
        # load_from_file 返回全新对象；调用方自己的系统不受影响
        original = _populated()
        before = plan_snapshot(original)
        self._mutate(lambda d: d["cargos"][0].__setitem__("weight", -1))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)
        self.assertEqual(plan_snapshot(original), before)

    def test_file_not_found(self):
        with self.assertRaises(PersistenceError):
            load_from_file(os.path.join(self.tmp.name, "nope.json"))


if __name__ == "__main__":
    unittest.main()
