"""连锁门店排班引擎（仅标准库，可完全离线运行）。

用法::

    from scheduler import SchedulingEngine, ManualClock, TimeWindow

    engine = SchedulingEngine(clock=ManualClock())
    engine.add_store("store-1", "一号店")
    engine.add_shift("S1", "store-1", start, end, required_skills=["cashier"])
    engine.add_employee("E1", skills=["cashier"], availability=[TimeWindow(a, b)], max_hours=40)
    engine.schedule()
    engine.get_store_schedule("store-1")
"""
from .engine import ManualClock, SchedulingEngine, SystemClock
from .errors import NotFoundError, ScheduleError, ValidationError
from .models import Config, Employee, Shift, Store, TimeWindow
from .persistence import engine_from_dict, engine_to_dict, load_engine, save_engine

__all__ = [
    "SchedulingEngine",
    "SystemClock",
    "ManualClock",
    "ScheduleError",
    "ValidationError",
    "NotFoundError",
    "Config",
    "Employee",
    "Shift",
    "Store",
    "TimeWindow",
    "save_engine",
    "load_engine",
    "engine_to_dict",
    "engine_from_dict",
]
