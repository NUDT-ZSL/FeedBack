"""压力测试：随机场景下三方比对（事件驱动 vs 从头重排 vs 导出载入）。"""
import random
import sys
import tempfile
from datetime import datetime, timedelta

sys.path.insert(0, ".")
from scheduler import SchedulingEngine, ManualClock, TimeWindow
from scheduler.models import subtract_window

BASE = datetime(2026, 9, 14)
dt = lambda h: BASE + timedelta(hours=h)


def gen_scenario(seed):
    """返回 (shifts, employees, events)。events: [('leave', eid, s, e), ('avail', eid, wins)]"""
    rng = random.Random(seed)
    skills = ["a", "b"]
    shifts = []
    for i in range(rng.randint(4, 8)):
        start_h = rng.choice([0, 6, 8, 14, 20, 22]) + rng.choice([0, 24, 48])
        shifts.append((f"S{i}", "st1", dt(start_h), dt(start_h + rng.choice([4, 8])),
                       [rng.choice(skills)]))
    rng.shuffle(shifts)  # 乱序添加
    employees = []
    for j in range(rng.randint(2, 4)):
        eid = f"E{j}"
        eskills = [s for s in skills if rng.random() < 0.8] or ["a"]
        employees.append((eid, eskills, [TimeWindow(dt(0), dt(96))], rng.choice([12, 20, 40])))
    events = []
    eids = [e[0] for e in employees]
    for _ in range(rng.randint(1, 2)):
        eid = rng.choice(eids)
        if rng.random() < 0.5:
            s = rng.choice([8, 20, 30])
            events.append(("leave", eid, dt(s), dt(s + rng.choice([6, 18]))))
        else:
            events.append(("avail", eid, [TimeWindow(dt(rng.choice([0, 12])), dt(rng.choice([60, 96])))]))
    return shifts, employees, events


def build(shifts, employees, events=()):
    eng = SchedulingEngine(clock=ManualClock(BASE))
    eng.add_store("st1")
    for sid, st, s, e, req in shifts:
        eng.add_shift(sid, st, s, e, req)
    for eid, eskills, avail, maxh in employees:
        eng.add_employee(eid, eskills, avail, maxh)
    eng.schedule()
    for ev in events:
        if ev[0] == "leave":
            eng.employee_leave(ev[1], ev[2], ev[3])
        else:
            eng.update_availability(ev[1], ev[2])
    return eng


def build_reference(shifts, employees, events):
    """从头重排参照：先应用事件再一次性排班。"""
    avail_map = {e[0]: list(e[2]) for e in employees}
    for ev in events:
        if ev[0] == "leave":
            avail_map[ev[1]] = subtract_window(avail_map[ev[1]], ev[2], ev[3])
        else:
            avail_map[ev[1]] = list(ev[2])
    eng = SchedulingEngine(clock=ManualClock(BASE))
    eng.add_store("st1")
    for sid, st, s, e, req in shifts:
        eng.add_shift(sid, st, s, e, req)
    for eid, eskills, _, maxh in employees:
        eng.add_employee(eid, eskills, avail_map[eid], maxh)
    eng.schedule()
    return eng


def observable(eng):
    return {
        "assignments": eng.assignments(),
        "store": eng.get_store_schedule("st1"),
        "employees": {eid: eng.get_employee_schedule(eid) for eid in sorted(eng.employees)},
        "gaps": {sid: eng.get_shift_gap(sid) for sid in sorted(eng.shifts)},
        "fairness": eng.fairness_report(),
    }


bad = 0
for seed in range(300):
    shifts, employees, events = gen_scenario(seed)
    eng = build(shifts, employees, events)
    ref = build_reference(shifts, employees, events)
    with tempfile.TemporaryDirectory() as tmp:
        p = tmp + "/s.json"
        eng.save(p)
        loaded = SchedulingEngine.load(p)
    obs = [(eng, "事件驱动"), (ref, "从头重排"), (loaded, "导出载入")]
    base = observable(obs[0][0])
    for other, name in obs[1:]:
        o = observable(other)
        diffs = [k for k in base if base[k] != o[k]]
        if diffs:
            bad += 1
            print(f"seed={seed} [{name}] 不一致: {diffs}")
            for k in diffs:
                print(f"  事件驱动 {k}:", base[k])
                print(f"  {name} {k}:", o[k])
            break
    if bad >= 5:
        break
print("完成，不一致场景数:", bad)
