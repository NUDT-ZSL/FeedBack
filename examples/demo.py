"""ThemeOracle 功能演示（可直接运行：python examples/demo.py）。

场景：base -> dark -> amoled 三层主题，同一颜色变量在链上取值不同，
演示登记、继承解析、来源查询、覆盖者列表、冲突记录、增量重算与文件往返。
"""

import os
import sys
import tempfile

# Windows 默认控制台可能是 GBK，统一用 UTF-8 输出避免中文乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from themeoracle import DesignSystem, persistence


def main():
    ds = DesignSystem()

    # 1) 视觉变量：标识 / 类型 / 默认值
    ds.add_variable("color.primary", "color", "#3366ff")
    ds.add_variable("color.bg", "color", "#ffffff")
    ds.add_variable("radius.base", "length", "4px")
    ds.add_variable("font.scale", "number", 1.0)
    ds.add_variable("nav.compact", "boolean", False)

    # 2) 主题与继承（父先于子创建）
    ds.add_theme("base", overrides={
        "color.primary": "#3366ff",
        "color.bg": "#f7f8fa",
    })
    ds.add_theme("dark", parent="base", overrides={
        "color.primary": "#6699ff",
        "color.bg": "#14161a",
    })
    ds.add_theme("amoled", parent="dark", overrides={
        "color.bg": "#000000",
        "nav.compact": True,
    })

    print("=" * 68)
    print("1) 逐层解析（与手工推导一致）")
    print("=" * 68)
    for theme in ("base", "dark", "amoled"):
        r = ds.resolve(theme, "color.bg")
        chain = " -> ".join(r.chain)
        print(f"  {theme:7s} color.bg = {r.value!s:9s} 来源={r.source or '变量默认值'}")
        print(f"           继承链：{chain}")

    print()
    print("=" * 68)
    print("2) 最终取值 / 来源 / 被哪些主题覆盖")
    print("=" * 68)
    r = ds.resolve("amoled", "color.primary")
    print(f"  amoled 下 color.primary = {r.value}，生效来源：{r.source}")
    print(f"  color.primary 被这些主题覆盖过：{ds.override_themes('color.primary')}")
    print(f"  radius.base 被覆盖过：{ds.override_themes('radius.base')}"
          f"（amoled 下取默认值 {ds.resolve('amoled', 'radius.base').value}）")

    print()
    print("=" * 68)
    print("3) 矛盾取值：双方保留 + 可读冲突记录")
    print("=" * 68)
    for rec in ds.conflicts("amoled"):
        print(f"  [!] {rec.describe()}")

    print()
    print("=" * 68)
    print("4) 修改基础变量后只重算下游（返回受影响主题，其余缓存对象不动）")
    print("=" * 68)
    ds.resolve_all("base")
    ds.resolve_all("dark")
    ds.resolve_all("amoled")
    untouched = ds.resolve("base", "radius.base")
    affected = ds.set_override("dark", "color.primary", "#7aa2ff")
    print(f"  修改 dark 的 color.primary，受影响主题：{affected}")
    print(f"  amoled 新值={ds.resolve('amoled', 'color.primary').value}，"
          f"base 不变={ds.resolve('base', 'color.primary').value}")
    print(f"  与本次修改无关的 base/radius.base 缓存对象保持同一对象："
          f"{ds.resolve('base', 'radius.base') is untouched}")

    print()
    print("=" * 68)
    print("5) 单文件保存 / 重新载入，解析结果与冲突快照完全一致")
    print("=" * 68)
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "design-system.json")
        persistence.save(ds, path)
        restored = persistence.load(path)
        same = all(
            ds.resolve(t, v).value == restored.resolve(t, v).value
            for t in ds.theme_names for v in ds.variable_ids
        )
        print(f"  文件：{path}")
        print(f"  重载后全部变量解析一致：{same}")
        print(f"  重载后冲突条数：{len(restored.conflicts())}")

    print()
    print("=" * 68)
    print("6) 错误示范：类型不符 / 成环 / 未知父主题，都带位置或链条")
    print("=" * 68)
    from themeoracle import InvalidValueError, InheritanceCycleError

    try:
        ds.add_variable("bad", "length", 16)  # 数字而非 "16px"
    except InvalidValueError as exc:
        print(f"  类型不符：{exc}")

    try:
        ds.set_parent("base", "amoled")  # base <- dark <- amoled <- base
    except InheritanceCycleError as exc:
        print(f"  继承成环：{exc}")


if __name__ == "__main__":
    main()
