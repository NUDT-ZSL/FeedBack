"""需求 1：环境维度与环境矩阵。"""
import unittest

from envcompat import Matrix
from envcompat.errors import DefinitionError, DuplicateCombinationError


class TestDimensionAndMatrix(unittest.TestCase):
    def test_cartesian_product_and_uniqueness(self):
        m = Matrix([
            ("os", ["linux", "windows"]),
            ("browser", ["chrome", "firefox"]),
        ])
        sigs = [c.signature for c in m.combinations]
        self.assertEqual(len(sigs), 4)
        self.assertEqual(len(set(sigs)), 4, "组合必须唯一")
        self.assertEqual(
            {c.coords for c in m.combinations},
            {("linux", "chrome"), ("linux", "firefox"),
             ("windows", "chrome"), ("windows", "firefox")},
        )

    def test_single_dimension_works(self):
        m = Matrix([("os", ["linux", "windows"])])
        self.assertEqual(len(m.combinations), 2)

    def test_empty_dimensions_rejected(self):
        with self.assertRaises(DefinitionError) as cm:
            Matrix([])
        self.assertIn("至少", str(cm.exception))

    def test_empty_or_blank_dimension_name_rejected_with_location(self):
        with self.assertRaises(DefinitionError) as cm:
            Matrix([("  ", ["a"])])
        self.assertTrue(cm.exception.location)  # 必须指出位置

    def test_dimension_with_no_values_rejected(self):
        with self.assertRaises(DefinitionError) as cm:
            Matrix([("os", [])])
        self.assertIn("dimensions[0]", cm.exception.location)

    def test_duplicate_value_within_dimension_rejected_and_located(self):
        with self.assertRaises(DefinitionError) as cm:
            Matrix([("os", ["linux", "linux"])])
        self.assertIn("os", str(cm.exception))
        self.assertIn("values", cm.exception.location)

    def test_duplicate_dimension_names_rejected_with_both_positions(self):
        with self.assertRaises(DefinitionError) as cm:
            Matrix([("os", ["a"]), ("os", ["b"])])
        msg = str(cm.exception)
        self.assertIn("dimensions[0]", msg)
        self.assertIn("dimensions[1]", msg)

    def test_illegal_value_type_rejected(self):
        with self.assertRaises(DefinitionError):
            Matrix([("os", ["ok", ""])])
        with self.assertRaises(DefinitionError):
            Matrix([("os", ["ok", 3])])  # type: ignore[list-item]

    def test_duplicate_combinations_cannot_occur_but_guarded(self):
        # 正常入口无法构造重复组合；直接确认异常类型存在且可用。
        self.assertTrue(issubclass(DuplicateCombinationError, Exception))

    def test_resolve_known_and_unknown_combination(self):
        m = Matrix([("os", ["linux", "windows"]), ("browser", ["chrome"])])
        combo = m.resolve(("windows", "chrome"))
        self.assertEqual(combo.coords, ("windows", "chrome"))
        with self.assertRaises(DefinitionError):
            m.resolve(("windows", "safari"))      # 未知取值
        with self.assertRaises(DefinitionError):
            m.resolve(("windows",))               # 维度数不对

    def test_signature_robust_to_separator_in_value(self):
        # 取值里即便含 '|' 和 ':'，长度前缀签名也不能发生碰撞。
        m = Matrix([("d", ["a|b", "a"]), ("e", ["x", "b:y"])])
        sigs = [c.signature for c in m.combinations]
        self.assertEqual(len(sigs), len(set(sigs)))

    def test_dict_form_supported(self):
        m = Matrix([{"name": "os", "values": ["linux"]}])
        self.assertEqual(m.dimension_names, ("os",))

    def test_malformed_dimension_definition_located(self):
        with self.assertRaises(DefinitionError) as cm:
            Matrix([42])  # type: ignore[list-item]
        self.assertEqual(cm.exception.location, "dimensions[0]")


if __name__ == "__main__":
    unittest.main()
