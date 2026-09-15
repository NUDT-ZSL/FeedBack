"""端到端示例:覆盖七项需求的主流程。可离线运行: python examples/demo.py"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from synthcore import Engine, dumps, load


def show(title, value):
    print(f"\n== {title} ==")
    print(json.dumps(value, ensure_ascii=False, indent=2, default=str))


eng = Engine()
# 1. 物品与库存
for iid, stock in [("ore", 10), ("coal", 4), ("ingot", 0), ("plate", 0), ("gear", 0)]:
    eng.add_item(iid, stock)

# 2. 配方:增量新增,只重算受影响物品
eng.add_recipe("smelt", {"ore": 2, "coal": 1}, {"ingot": 1})
eng.add_recipe("press", {"ingot": 2}, {"plate": 1})
eng.add_recipe("cut", {"plate": 1}, {"gear": 2})
print("新增 cut 后实际重算的物品:", sorted(eng.last_affected))

# 4. 最优方案(成本最小,平局按配方标识)
eng.add_recipe("cut_v2", {"plate": 1}, {"gear": 2})  # 与 cut 同成本
print("gear 最优配方(同成本取标识最小):", eng.best_recipe("gear"))

# 6. 查询
show("gear 最优方案", eng.best_plan("gear"))
show("gear 依赖树", eng.dependency_tree("gear"))
show("cut 的传递输入", eng.transitive_inputs("cut"))
print("\ningot 与 ore 的依赖关系:", eng.relation("ingot", "ore"))

# 3. 环:互相依赖的配方
eng.add_item("a")
eng.add_item("b")
eng.add_recipe("r_ab", {"a": 1}, {"b": 1})
eng.add_recipe("r_ba", {"b": 1}, {"a": 1})
show("环冲突记录", eng.conflicts)
print("a 可合成:", eng.craftable("a"), " b 可合成:", eng.craftable("b"))

# 5. 配方失效与备选
eng.set_stock("ore", 0)  # 主链断裂
show("smelt 失效后的状态", eng.recipe_status("smelt"))
eng.add_recipe("smelt_alt", {"coal": 3}, {"ingot": 1})  # 备选配方
print("备选配方上线后 ingot 最优配方:", eng.best_recipe("ingot"))

# 7. 导出 / 载入
text = dumps(eng)
eng2 = load(text)
assert eng2.best_recipe("ingot") == eng.best_recipe("ingot")
print("\n导出", len(text), "字节,重新载入后最优配方一致:", eng2.best_recipe("ingot"))

bad = '{"items": [{"id": "x", "stock": -1}], "recipes": []}'
try:
    load(bad)
except Exception as exc:
    print("损坏数据载入报错:", exc)
print("载入失败后原引擎状态不变:", eng2.best_recipe("ingot") == "smelt_alt")
