"""离线合成系统内核(仅标准库)。

用法::

    from synthcore import Engine, load, dumps

    eng = Engine()
    eng.add_item("iron_ore", stock=10)
    eng.add_item("iron_ingot")
    eng.add_recipe("smelt", inputs={"iron_ore": 2}, outputs={"iron_ingot": 1})
    eng.best_plan("iron_ingot")
"""

from .engine import Engine
from .errors import CycleError, NotFoundError, SynthError, ValidationError
from .model import Item, Recipe
from .persistence import dumps, export_state, load, replace_state

__all__ = [
    "Engine",
    "Item",
    "Recipe",
    "SynthError",
    "ValidationError",
    "NotFoundError",
    "CycleError",
    "dumps",
    "export_state",
    "load",
    "replace_state",
]
