"""复现脚本：随机场景下比对 局部重排 vs 从头重排 的全部可观测结果。"""
import random
import sys
from datetime import datetime, timedelta

sys.path.insert(0, ".")
from scheduler import SchedulingEngine, ManualClock, TimeWindow

BASE = datetime(2026, 9, 14)
dt = lambda h: BASE + timedelta(hours=h)


def build(seed, with_leave=None, with_avail=None):
    """构造同一初始场景；with_leave/with_avail 在排班前应用（用于从头重排参照）。"""
    rng = random.Random(seed)
    eng = SchedulingEngine(clock=ManualClock(BASE))
    eng.add_store("st1")
    skills = ["a", "b"]
    n_shifts = rng.randint(4, 7)
    for i in range(n_shifts):
        start_h = rng.choice([0, 4, 8, 12, 16, 20]) + rng.choice([0, 24, 48])
        req = [rng.choice(skills)]
        eng.add_shift(f"S{i}", "st1", dt(start_h), dt(start_h + 8), req)
    n_emp = rng.randint(2, 4)
    for j in range(n_emp):
        eid = f"E{j}"
        eskills = [s for s in skills if rng.random() < 0.8] or ["a"]
        avail = [TimeWindow(dt(0), dt(72))]
        if with_leave and eid in with_leave:
            ls, le = with_leave[eid]
            from scheduler.models import subtract_window
            avail = subtract_window(avail, ls, le)
        if with_avail and eid in with_avail:
            avail = with_avail[eid]
        eng.add_employee(eid, eskills, avail, rng.choice([16, 24, 40]))
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


def compare(seed):
    eng = build(seed)
    # 随机请假 + 可用时段变更
    rng = random.Random(seed + 1000)
    eids = sorted(eng.employees)
    leave_emp = rng.choice(eids)
    ls, le = dt(rng.choice([8, 16, 24])), dt(rng.choice([32, 40, 48]))
    eng.employee_leave(leave_emp, ls, le)
    avail_emp = rng.choice(eids)
    new_avail = [TimeWindow(dt(0), dt(40))]
    eng.update_availability(avail_emp, new_avail)

    ref = build(seed, with_leave={leave_emp: (ls, le)}, with_avail={avail_emp: new_avail})

    a, b = observable(eng), observable(ref)
    diffs = [k for k in a if a[k] != b[k]]
    if diffs:
        print(f"seed={seed} 不一致: {diffs}")
        for k in diffs:
            print(f"--- {k} 局部重排:", a[k])
            print(f"--- {k} 从头重排:", b[k])
        return False
    return True


bad = 0
for seed in range(200):
    if not compare(seed):
        bad += 1
        if bad >= 3:
            break
print("不一致场景数:", bad)
