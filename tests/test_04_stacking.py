"""需求 4：堆叠规则——易碎上方无货、累计层数限制、报错指出超限层。"""

import unittest

from loading import Cargo, LoadingSystem, StackRuleError, Vehicle


class StackRuleTest(unittest.TestCase):
    def test_fragile_nothing_above_even_with_space(self):
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 2, 2, 6, 10000))
        s.add_cargo(Cargo("F", 2, 2, 2, weight=1, fragile=True))
        s.add_cargo(Cargo("B", 2, 2, 2, weight=1, stack_limit=2))
        # 只有一根柱子：F 必须在底（体积相同按 id 排序：B<F，B 先放）
        # B 先落底，F 不能放 B 上？F 自身易碎不影响“F 放在别人上方”，
        # 但 B 的 stack_limit=2 允许。然而 F 在上方时 F 上方无货即可。
        s.plan_all()
        f = s.locate_cargo("F")
        b = s.locate_cargo("B")
        # 2x2 车厢只有一个柱位，必然一上一下；易碎者必须在最上方，
        # 其上方不得再有货物。
        self.assertGreater(f["z"], b["z"])
        self.assertEqual(f["level"], 2)

    def test_fragile_at_bottom_blocks_stacking(self):
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 2, 2, 6, 10000))
        # 先放大 id 的易碎货物使它落底，再来一件非易碎无处可去
        s.add_cargo(Cargo("AA", 2, 2, 2, weight=1, fragile=True))
        s.add_cargo(Cargo("BB", 2, 2, 2, weight=1))
        with self.assertRaises(StackRuleError) as cm:
            s.plan_all()
        # AA 先排序（id 小）落底，BB 不能压在易碎品上，无处可去
        self.assertEqual(cm.exception.level, 2)

    def test_cumulative_layer_limit_single_column(self):
        # stack_limit=1：允许上方 1 层（共 2 层），第 3 层必须拒绝
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 2, 2, 8, 10000))
        for i in range(3):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=1, stack_limit=1))
        with self.assertRaises(StackRuleError) as cm:
            s.plan_all()
        self.assertEqual(cm.exception.level, 3)
        self.assertIn("第 3 层超限", str(cm.exception))

    def test_two_layers_allowed(self):
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 2, 2, 8, 10000))
        for i in range(2):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=1, stack_limit=1))
        s.plan_all()
        levels = sorted(p.level for p in s.all_placements())
        self.assertEqual(levels, [1, 2])

    def test_weak_middle_box_limits_whole_column(self):
        # 底层允许 2 层、中层允许 0 层：第三件在第 3 层被中层拒绝
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 2, 2, 10, 10000))
        s.add_cargo(Cargo("A", 2, 2, 2, weight=1, stack_limit=2))
        s.add_cargo(Cargo("B", 2, 2, 2, weight=1, stack_limit=0))
        s.add_cargo(Cargo("D", 2, 2, 2, weight=1, stack_limit=2))
        with self.assertRaises(StackRuleError) as cm:
            s.plan_all()
        self.assertEqual(cm.exception.level, 3)

    def test_zero_limit_column_rejects_second_layer(self):
        # 底面四个柱位中有一个底层货物 limit=0；车厢仅允许两层，
        # 当第二层其余柱位放满后，再放货必须压在 limit=0 的箱上 -> 拒绝。
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 4, 4, 4, 10000))
        labels = ["A0", "A1", "A2", "A3", "B0", "B1", "B2", "B3"]
        for lab in labels:
            s.add_cargo(
                Cargo(lab, 2, 2, 2, weight=1, stack_limit=0 if lab == "A0" else 1)
            )
        with self.assertRaises(StackRuleError) as cm:
            s.plan_all()
        self.assertEqual(cm.exception.level, 2)


if __name__ == "__main__":
    unittest.main()
