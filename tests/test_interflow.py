"""interflow 的单元测试（纯标准库 unittest，完全离线）。

覆盖需求 1~8：
定义唯一性 / 目标存在性、迁移记录、条件互斥与覆盖、返回恢复、
批量稳定顺序与整批回滚、查询、文件往返与坏文件拒绝（内存不变）、
多页面多分支验收流与逐步推导比对。
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from interflow import (
    PrototypeEngine, TriggerStep,
    Page, PageState, InteractionElement, Action,
    GOTO, BACK, SET_STATE, SUBMIT,
    save_to_file, load_from_file,
    DefinitionError, DuplicateIdError, TargetNotFoundError,
    ConditionError, MissingVariablesError, BackRejectedError,
    TriggerError, BatchAbortedError, PersistenceError,
)
from interflow.models import DEFAULT_HIT, values_equal


# ---------------------------------------------------------------------- #
# 测试装置
# ---------------------------------------------------------------------- #

def build_demo_engine(drive=False):
    """多页面多分支的交互流：

    home(s0 role=guest)
      btn_go(条件 go 按 role: guest->login, vip->vip, 兜底->denied, 穷尽声明否)
      btn_set 同页切到 s_admin（role=admin）
    login(s0 user="")
      input_name 提交 name -> form.s0
      back_btn 返回
    form(s0 name="", plan="free")
      radio_plan 条件提交：plan=pro -> pay, plan=free -> result, 其它兜底 -> form
      back_btn 返回
    pay(s0 amount=99) -> btn_pay goto result / back_btn
    result(s0) -> home_btn 回 home.s0（无历史压栈之外的显式返回）
    vip(s0) / denied(s0)
    """
    e = PrototypeEngine("home")

    home = Page("home", "s0", [
        PageState("s0", {"role": "guest"}),
        PageState("s_admin", {"role": "admin"}),
    ])
    btn = InteractionElement("btn_go")
    btn.add_action(Action.branch_goto(
        "go", "role",
        [("guest", "login.s0"), ("vip", "vip.s0"), ("admin", "pay.s0")],
        default_target="denied.s0",
    ))
    home.add_element(btn)
    set_btn = InteractionElement("btn_set")
    set_btn.add_action(Action.set_state("become_admin", "s_admin"))
    home.add_element(set_btn)
    home.add_element(_back_element())
    e.add_page(home)

    login = Page("login", "s0", [PageState("s0", {"user": ""})])
    inp = InteractionElement("input_name")
    inp.add_action(Action.submit("submit_name", "user", "form", "s0"))
    login.add_element(inp)
    login.add_element(_back_element())
    e.add_page(login)

    form = Page("form", "s0", [
        PageState("s0", {"name": "", "plan": "free"}),
    ])
    radio = InteractionElement("radio_plan")
    # 提交 plan，再按 plan 条件跳转：这里拆成「提交」与「条件跳转」两个动作
    radio.add_action(Action.submit("set_plan", "plan"))
    radio.add_action(Action.branch_goto(
        "route", "plan",
        [("pro", "pay.s0"), ("free", "result.s0")],
        default_target="form.s0",
    ))
    form.add_element(radio)
    form.add_element(_back_element())
    e.add_page(form)

    pay = Page("pay", "s0", [PageState("s0", {"amount": 99})])
    pay_btn = InteractionElement("btn_pay")
    pay_btn.add_action(Action.goto("finish", "result", "s0"))
    pay.add_element(pay_btn)
    pay.add_element(_back_element())
    e.add_page(pay)

    e.add_page(Page("result", "s0", [PageState("s0", {"done": True})]))
    e.add_page(Page("vip", "s0", [PageState("s0", {})]))
    e.add_page(Page("denied", "s0", [PageState("s0", {})]))

    e.validate()
    e.reset()
    if drive:
        e.trigger("btn_go", "go")                 # -> login, 压栈 home
        e.trigger("input_name", "submit_name", "alice")  # -> form
        e.trigger("radio_plan", "set_plan", "pro")       # 留 form, plan=pro
        e.trigger("radio_plan", "route")                 # -> pay
    return e


def _back_element():
    el = InteractionElement("back_btn")
    el.add_action(Action.back("back"))
    return el


# ---------------------------------------------------------------------- #
# 需求 1：定义、唯一性、目标存在性
# ---------------------------------------------------------------------- #

class TestDefinitions(unittest.TestCase):

    def test_duplicate_page_id_rejected(self):
        e = PrototypeEngine("p")
        e.add_page(Page("p", "s", [PageState("s")]))
        with self.assertRaises(DuplicateIdError):
            e.add_page(Page("p", "s", [PageState("s")]))

    def test_duplicate_state_element_action_ids(self):
        with self.assertRaises(DuplicateIdError):
            Page("p", "s", [PageState("s"), PageState("s")])
        page = Page("p", "s", [PageState("s")])
        page.add_element("e")
        with self.assertRaises(DuplicateIdError):
            page.add_element("e")
        el = InteractionElement("e2")
        el.add_action(Action.back("a"))
        with self.assertRaises(DuplicateIdError):
            el.add_action(Action.back("a"))

    def test_entry_state_must_exist(self):
        with self.assertRaises(DefinitionError):
            Page("p", "missing", [PageState("s")])

    def test_start_page_must_exist(self):
        e = PrototypeEngine("nope")
        e.add_page(Page("p", "s", [PageState("s")]))
        with self.assertRaises(TargetNotFoundError):
            e.validate()

    def test_goto_target_page_must_exist(self):
        e = PrototypeEngine("p")
        page = Page("p", "s", [PageState("s")])
        el = InteractionElement("e")
        el.add_action(Action.goto("g", "ghost"))
        page.add_element(el)
        e.add_page(page)
        with self.assertRaises(TargetNotFoundError):
            e.validate()

    def test_goto_target_state_must_exist(self):
        e = PrototypeEngine("p")
        p1 = Page("p", "s", [PageState("s")])
        el = InteractionElement("e")
        el.add_action(Action.goto("g", "q", "gone"))
        p1.add_element(el)
        e.add_page(p1)
        e.add_page(Page("q", "s", [PageState("s")]))
        with self.assertRaises(TargetNotFoundError):
            e.validate()

    def test_set_state_target_must_exist(self):
        e = PrototypeEngine("p")
        page = Page("p", "s", [PageState("s")])
        el = InteractionElement("e")
        el.add_action(Action.set_state("sw", "gone"))
        page.add_element(el)
        e.add_page(page)
        with self.assertRaises(TargetNotFoundError):
            e.validate()

    def test_pages_may_register_in_any_order(self):
        # 先注册引用方，后注册被引用方，validate 时必须通过
        e = PrototypeEngine("p")
        p1 = Page("p", "s", [PageState("s")])
        el = InteractionElement("e")
        el.add_action(Action.goto("g", "q"))
        p1.add_element(el)
        e.add_page(p1)
        e.add_page(Page("q", "s", [PageState("s")]))
        e.validate()

    def test_id_must_be_nonempty_string_without_dot(self):
        with self.assertRaises(DefinitionError):
            Page("", "s")
        with self.assertRaises(DefinitionError):
            PageState("a.b")
        with self.assertRaises(DefinitionError):
            Action.back("")


# ---------------------------------------------------------------------- #
# 需求 2：推进与迁移记录
# ---------------------------------------------------------------------- #

class TestMigration(unittest.TestCase):

    def test_initial_position_and_clock(self):
        e = build_demo_engine()
        self.assertEqual(e.current_position(), ("home", "s0"))
        self.assertEqual(e.history_depth(), 0)
        self.assertEqual(e.migration_log(), [])

    def test_goto_records_action_source_target_clock(self):
        e = build_demo_engine()
        rec = e.trigger("btn_go", "go")
        self.assertEqual((rec.clock, rec.element_id, rec.action_id, rec.kind),
                         (1, "btn_go", "go", GOTO))
        self.assertEqual(rec.source, ("home", "s0"))
        self.assertEqual(rec.dest, ("login", "s0"))
        self.assertEqual(e.current_position(), ("login", "s0"))
        self.assertEqual([r.clock for r in e.migration_log()], [1])

    def test_set_state_loads_its_snapshot(self):
        e = build_demo_engine()
        rec = e.trigger("btn_set", "become_admin")
        self.assertEqual(rec.source, ("home", "s0"))
        self.assertEqual(rec.dest, ("home", "s_admin"))
        self.assertEqual(e.get_variables(), {"role": "admin"})
        self.assertEqual(e.history_depth(), 0)  # 同页不压栈

    def test_submit_writes_variable(self):
        e = build_demo_engine()
        e.trigger("btn_go", "go")
        rec = e.trigger("input_name", "submit_name", "alice")
        self.assertEqual(rec.kind, SUBMIT)
        self.assertEqual(rec.dest, ("form", "s0"))
        # 目标状态自带快照（name 为空），输入值随跨页落地载入目标快照
        self.assertEqual(e.get_variables(), {"name": "", "plan": "free"})

    def test_submit_without_navigation_keeps_input(self):
        e = build_demo_engine()
        e.trigger("btn_go", "go")
        e.trigger("input_name", "submit_name", "alice")
        rec = e.trigger("radio_plan", "set_plan", "pro")
        self.assertEqual(rec.dest, ("form", "s0"))
        self.assertEqual(e.get_variables()["plan"], "pro")

    def test_unknown_element_or_action_rejected(self):
        e = build_demo_engine()
        with self.assertRaises(TriggerError):
            e.trigger("nope")
        with self.assertRaises(TriggerError):
            e.trigger("btn_go", "nope")

    def test_ambiguous_action_requires_id(self):
        page = Page("p", "s", [PageState("s")])
        el = InteractionElement("e")
        el.add_action(Action.back("a1"))
        el.add_action(Action.back("a2"))
        page.add_element(el)
        e = PrototypeEngine("p")
        e.add_page(page)
        e.reset()
        with self.assertRaises(TriggerError):
            e.trigger("e")

    def test_variables_returned_sorted_copy(self):
        e = build_demo_engine()
        v = e.get_variables()
        self.assertEqual(list(v), ["role"])
        v["role"] = "tampered"
        self.assertEqual(e.get_variables()["role"], "guest")


# ---------------------------------------------------------------------- #
# 需求 3：条件分支
# ---------------------------------------------------------------------- #

class TestConditions(unittest.TestCase):

    def test_branches_must_be_mutually_exclusive(self):
        with self.assertRaises(ConditionError):
            Action.branch_goto(
                "a", "v", [(1, "p"), (1, "q")],
                default_target="p",
            )
        # True 与 1 类型不同，不算重复
        Action.branch_goto(
            "a", "v", [(1, "p"), (True, "q")],
            default_target="p",
        )

    def test_coverage_requires_default_or_exhaustive(self):
        with self.assertRaises(ConditionError):
            Action.branch_goto("a", "v", [("x", "p")])
        Action.branch_goto("a", "v", [("x", "p")],
                           default_target="p")
        Action.branch_goto("a", "v", [("x", "p")], exhaustive=True)

    def test_missing_variable_is_rejected_with_name(self):
        e = PrototypeEngine("p")
        page = Page("p", "s0", [PageState("s0", {})])
        el = InteractionElement("e")
        el.add_action(Action.branch_goto(
            "go", "role", [("guest", "p.s0")], default_target="p.s0"))
        page.add_element(el)
        e.add_page(page)
        e.reset()
        with self.assertRaises(MissingVariablesError) as cm:
            e.trigger("e", "go")
        self.assertEqual(cm.exception.missing, ["role"])
        self.assertIn("role", str(cm.exception))

    def test_uncovered_value_with_exhaustive_rejected(self):
        e = PrototypeEngine("p")
        page = Page("p", "s0", [PageState("s0", {"role": "other"})])
        el = InteractionElement("e")
        el.add_action(Action.branch_goto(
            "go", "role", [("guest", "p.s0")], exhaustive=True))
        page.add_element(el)
        e.add_page(page)
        e.reset()
        with self.assertRaises(ConditionError):
            e.trigger("e", "go")

    def test_default_branch_used(self):
        e = build_demo_engine()
        # role=guest 命中具名分支 -> login
        self.assertEqual(e.trigger("btn_go", "go").dest, ("login", "s0"))
        e.trigger("back_btn", "back")
        # 切到 admin 后再触发条件跳转，命中 admin 分支 -> pay
        e.trigger("btn_set", "become_admin")
        self.assertEqual(e.trigger("btn_go", "go").dest, ("pay", "s0"))
        e.trigger("back_btn", "back")
        # 一个不被任何具名分支覆盖的取值走兜底 -> denied
        e.variables["role"] = "stranger"
        rec = e.trigger("btn_go", "go")
        self.assertEqual(rec.dest, ("denied", "s0"))
        self.assertTrue(rec.to_dict()["default"])

    def test_null_value_is_a_real_branch_value(self):
        e = PrototypeEngine("p")
        page = Page("p", "s0", [PageState("s0", {"v": None})])
        el = InteractionElement("e")
        el.add_action(Action.branch_goto(
            "go", "v", [(None, "p.s0"), ("x", "p.s0")],
            default_target="p.s0"))
        page.add_element(el)
        e.add_page(page)
        e.reset()
        rec = e.trigger("e", "go")
        self.assertFalse(rec.to_dict()["default"])
        self.assertIsNone(rec.branch)

    def test_bool_not_equal_to_int_in_branch(self):
        self.assertFalse(values_equal(True, 1))
        e = PrototypeEngine("p")
        page = Page("p", "s0", [PageState("s0", {"v": True})])
        el = InteractionElement("e")
        el.add_action(Action.branch_goto(
            "go", "v", [(1, "p.s0")], default_target="p.s0"))
        page.add_element(el)
        e.add_page(page)
        e.reset()
        rec = e.trigger("e", "go")
        self.assertTrue(rec.to_dict()["default"])

    def test_which_branch_query(self):
        e = build_demo_engine()
        hit = e.which_branch("btn_go", "go", {"role": "vip"})
        self.assertEqual(hit["target_ref"], "vip.s0")
        self.assertEqual(hit["matched"], "vip")
        self.assertFalse(hit["default"])
        miss = e.which_branch("btn_go", "go", {"role": "??"})
        self.assertTrue(miss["default"])
        self.assertEqual(miss["target_ref"], "denied.s0")
        with self.assertRaises(MissingVariablesError):
            e.which_branch("btn_go", "go", {})


# ---------------------------------------------------------------------- #
# 需求 4：返回恢复
# ---------------------------------------------------------------------- #

class TestBack(unittest.TestCase):

    def test_back_empty_history_rejected(self):
        e = build_demo_engine()
        with self.assertRaises(BackRejectedError) as cm:
            e.trigger("back_btn", "back")
        self.assertIn("无上级页面", str(cm.exception))

    def test_back_restores_page_state_and_snapshot(self):
        e = build_demo_engine()
        # home(role=guest) -> login -> form(plan=free)
        e.trigger("btn_go", "go")
        e.trigger("input_name", "submit_name", "alice")
        self.assertEqual(e.history_depth(), 2)
        # form 的返回回到 login.s0，快照 user=""
        rec = e.trigger("back_btn", "back")
        self.assertEqual(rec.kind, BACK)
        self.assertEqual(rec.source, ("form", "s0"))
        self.assertEqual(rec.dest, ("login", "s0"))
        self.assertEqual(e.current_position(), ("login", "s0"))
        # 历史帧捕获的是「离开 login 那一刻」的活动变量（含刚提交的名字），
        # 故从 form 返回时 user 恢复为 alice
        self.assertEqual(e.get_variables(), {"user": "alice"})
        self.assertEqual(e.history_depth(), 1)
        # 再返回回到 home.s0，role 恢复为 guest
        e.trigger("back_btn", "back")
        self.assertEqual(e.current_position(), ("home", "s0"))
        self.assertEqual(e.get_variables(), {"role": "guest"})
        self.assertEqual(e.history_depth(), 0)

    def test_back_restores_mutated_snapshot(self):
        # home 先切到 admin（同页，不压栈），再跳 pay；返回应恢复 admin 快照
        e = build_demo_engine()
        e.trigger("btn_set", "become_admin")
        e.trigger("btn_go", "go")  # admin -> pay，压栈 home.s_admin
        self.assertEqual(e.current_position(), ("pay", "s0"))
        e.trigger("back_btn", "back")
        self.assertEqual(e.current_position(), ("home", "s_admin"))
        self.assertEqual(e.get_variables(), {"role": "admin"})

    def test_back_then_new_navigation_replaces_frame(self):
        e = build_demo_engine()
        e.trigger("btn_go", "go")          # home -> login，栈:[home]
        e.trigger("back_btn", "back")      # 回 home，栈:[]
        e.trigger("btn_set", "become_admin")
        e.trigger("btn_go", "go")          # admin -> pay，栈:[home.s_admin]
        e.trigger("back_btn", "back")
        self.assertEqual(e.current_position(), ("home", "s_admin"))
        self.assertEqual(e.history_depth(), 0)


# ---------------------------------------------------------------------- #
# 需求 5：连续快速触发，稳定顺序，整批回滚
# ---------------------------------------------------------------------- #

class TestBatch(unittest.TestCase):

    def test_batch_applied_in_stable_order(self):
        # 同一元素上两个「只写变量不导航」的提交动作，动作标识乱序传入，
        # 必须按动作标识升序逐个应用
        e = PrototypeEngine("p")
        page = Page("p", "s0", [PageState("s0", {"a": 0, "b": 0})])
        el = InteractionElement("el")
        el.add_action(Action.submit("write_a", "a"))
        el.add_action(Action.submit("write_b", "b"))
        page.add_element(el)
        e.add_page(page)
        e.reset()
        recs = e.trigger_batch([
            TriggerStep("el", "write_b", 20),
            TriggerStep("el", "write_a", 10),
        ])
        self.assertEqual([r.action_id for r in recs], ["write_a", "write_b"])
        self.assertEqual([r.clock for r in recs], [1, 2])
        self.assertEqual(e.get_variables(), {"a": 10, "b": 20})

    def test_batch_conditional_then_failure_aborts(self):
        # 排序后先应用条件路由（plan=free -> result），再在 result 上找
        # radio_plan 失败 -> 整批回滚，form 上的 plan 保持原值
        e = build_demo_engine()
        e.trigger("btn_go", "go")
        e.trigger("input_name", "submit_name", "bob")  # form, plan=free
        with self.assertRaises(BatchAbortedError) as cm:
            e.trigger_batch([
                TriggerStep("radio_plan", "set_plan", "pro"),
                TriggerStep("radio_plan", "route"),
            ])
        # 排序键：route < set_plan，故 route 先把页面带到 result（跨页），
        # set_plan 在 result 上找不到元素 -> 失败下标 1，整批回滚
        self.assertEqual(cm.exception.index, 1)
        self.assertEqual(e.current_position(), ("form", "s0"))
        self.assertEqual(e.get_variables()["plan"], "free")
        # 批次前已有 go、submit 两条日志，回滚后仍是这两条，无新增
        self.assertEqual(len(e.migration_log()), 2)
        self.assertEqual([r.clock for r in e.migration_log()], [1, 2])

    def test_batch_rolls_back_on_failure(self):
        e = build_demo_engine()
        before_pos = e.current_position()
        before_vars = e.get_variables()
        # 排序后先在 btn_set 上切到 admin，再在不存在的元素 z_ghost 上失败
        with self.assertRaises(BatchAbortedError) as cm:
            e.trigger_batch([
                TriggerStep("z_ghost", "x"),
                TriggerStep("btn_set", "become_admin"),
            ])
        self.assertEqual(cm.exception.index, 1)
        self.assertEqual(cm.exception.completed, 1)
        # 整批回滚：位置、变量、历史、时钟、日志全部恢复
        self.assertEqual(e.current_position(), before_pos)
        self.assertEqual(e.get_variables(), before_vars)
        self.assertEqual(e.history_depth(), 0)
        self.assertEqual(e.migration_log(), [])
        # 预览路径无半迁移：仍可从原状态正常触发
        rec = e.trigger("btn_go", "go")
        self.assertEqual(rec.clock, 1)
        self.assertEqual(e.current_position(), ("login", "s0"))

    def test_batch_rolls_back_history_and_clock(self):
        e = build_demo_engine()
        e.trigger("btn_go", "go")          # -> login, clock=1, 栈深 1
        # 第 0 步返回成功（弹栈），第 1 步触发不存在的动作 -> 回滚
        with self.assertRaises(BatchAbortedError):
            e.trigger_batch([
                TriggerStep("back_btn", "back"),
                TriggerStep("ghost", "x"),
            ])
        self.assertEqual(e.current_position(), ("login", "s0"))
        self.assertEqual(e.history_depth(), 1)
        self.assertEqual([r.clock for r in e.migration_log()], [1])
        self.assertEqual(e.history_frames()[0].page_id, "home")

    def test_batch_stable_order_across_elements(self):
        # 两个只写变量不导航的提交，传入顺序与排序顺序相反
        e = PrototypeEngine("p")
        page = Page("p", "s0", [PageState("s0", {"a": 0, "b": 0})])
        el_b = InteractionElement("z_element")
        el_b.add_action(Action.submit("write", "b"))
        el_a = InteractionElement("a_element")
        el_a.add_action(Action.submit("write", "a"))
        page.add_element(el_b)
        page.add_element(el_a)
        e.add_page(page)
        e.reset()
        recs = e.trigger_batch([
            TriggerStep("z_element", "write", 2),
            TriggerStep("a_element", "write", 1),
        ])
        self.assertEqual([r.element_id for r in recs],
                         ["a_element", "z_element"])
        self.assertEqual(e.get_variables(), {"a": 1, "b": 2})

    def test_empty_batch_is_noop(self):
        e = build_demo_engine()
        self.assertEqual(e.trigger_batch([]), [])
        self.assertEqual(e.current_position(), ("home", "s0"))


# ---------------------------------------------------------------------- #
# 需求 6：查询
# ---------------------------------------------------------------------- #

class TestQueries(unittest.TestCase):

    def test_reachable_paths_stable_and_complete(self):
        e = build_demo_engine()
        paths = e.reachable_paths("home")
        # 每条路径都是 [(page, state), ...]
        self.assertTrue(all(len(p) >= 1 for p in paths))
        self.assertEqual(paths[0], [("home", "s0")])
        # 结果稳定：重复调用一致，且本身有序
        self.assertEqual(paths, e.reachable_paths("home"))
        self.assertEqual(paths, sorted(paths,
                                       key=lambda p: tuple(map(tuple, p))))
        # home 的三个条件分支 + 兜底 + 同页切状态都应作为一步路径出现
        first_steps = {tuple(path[1]) for path in paths if len(path) > 1}
        self.assertEqual(first_steps,
                         {("login", "s0"), ("vip", "s0"),
                          ("pay", "s0"), ("denied", "s0"),
                          ("home", "s_admin")})
        # 可达：login -> form -> pay -> result
        self.assertIn([("home", "s0"), ("login", "s0"),
                       ("form", "s0"), ("pay", "s0"),
                       ("result", "s0")], paths)

    def test_reachable_paths_unknown_page(self):
        e = build_demo_engine()
        with self.assertRaises(TargetNotFoundError):
            e.reachable_paths("ghost")

    def test_history_frames_are_copies(self):
        e = build_demo_engine(drive=True)
        frames = e.history_frames()
        frames[0].variables["role"] = "hacked"
        self.assertEqual(e.history_frames()[0].variables["role"], "guest")


# ---------------------------------------------------------------------- #
# 需求 7：保存 / 载入
# ---------------------------------------------------------------------- #

class TestPersistence(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "proto.json")

    def _write(self, data):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write(data)

    def _load_saved(self, engine=None):
        save_to_file(self.path, engine or build_demo_engine())
        with open(self.path, encoding="utf-8") as fh:
            return json.load(fh)

    def _home(self, data):
        home, = [p for p in data["pages"] if p["id"] == "home"]
        return home

    def _btn_go_action(self, home):
        btn, = [el for el in home["elements"] if el["id"] == "btn_go"]
        return btn["actions"][0]

    def test_roundtrip_after_mixed_navigation(self):
        e = build_demo_engine(drive=True)
        # 当前在 pay；再返回两次，制造非平凡历史
        e.trigger("back_btn", "back")   # -> form
        save_to_file(self.path, e)
        loaded = load_from_file(self.path)
        self.assertEqual(loaded.current_position(), e.current_position())
        self.assertEqual(loaded.get_variables(), e.get_variables())
        self.assertEqual(loaded.history_depth(), e.history_depth())
        self.assertEqual(
            [(f.page_id, f.state_id, f.variables) for f in loaded.history_frames()],
            [(f.page_id, f.state_id, f.variables) for f in e.history_frames()],
        )
        self.assertEqual(
            [r.to_dict() for r in loaded.migration_log()],
            [r.to_dict() for r in e.migration_log()],
        )
        # 载入后可以继续推进，时钟延续
        nxt = loaded.trigger("radio_plan", "set_plan", "free")
        self.assertEqual(nxt.clock, e.clock + 1)

    def test_roundtrip_at_initial_state(self):
        e = build_demo_engine()
        save_to_file(self.path, e)
        loaded = load_from_file(self.path)
        self.assertEqual(loaded.current_position(), ("home", "s0"))
        self.assertEqual(loaded.get_variables(), {"role": "guest"})
        self.assertEqual(loaded.history_depth(), 0)

    def test_missing_field_rejected(self):
        data = self._load_saved()
        del self._home(data)["states"][0]["id"]
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_duplicate_id_in_file_rejected(self):
        data = self._load_saved()
        home = self._home(data)
        home["states"][1]["id"] = home["states"][0]["id"]
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_missing_target_in_file_rejected(self):
        data = self._load_saved()
        self._btn_go_action(self._home(data))["branches"][0]["target"] = "ghost.x"
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_non_exclusive_conditions_in_file_rejected(self):
        data = self._load_saved()
        act = self._btn_go_action(self._home(data))
        act["branches"][1]["value"] = act["branches"][0]["value"]
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_coverage_gap_in_file_rejected(self):
        data = self._load_saved()
        self._btn_go_action(self._home(data))["default_target"] = None
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_history_inconsistency_rejected(self):
        data = self._load_saved(build_demo_engine(drive=True))
        data["runtime"]["history"][0]["variables"]["role"] = "tampered"
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_current_position_inconsistency_rejected(self):
        data = self._load_saved(build_demo_engine(drive=True))
        data["runtime"]["current_state"] = "s_admin"
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_clock_log_mismatch_rejected(self):
        data = self._load_saved(build_demo_engine(drive=True))
        data["runtime"]["clock"] = 999
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_noncontiguous_log_rejected(self):
        data = self._load_saved(build_demo_engine(drive=True))
        data["runtime"]["log"][0]["clock"] = 5
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_log_dest_tamper_rejected(self):
        data = self._load_saved(build_demo_engine(drive=True))
        data["runtime"]["log"][0]["dest"]["page"] = "denied"
        data["runtime"]["log"][0]["dest"]["state"] = "s0"
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_log_source_tamper_rejected(self):
        data = self._load_saved(build_demo_engine(drive=True))
        data["runtime"]["log"][1]["source"]["state"] = "s_admin"
        self._write(json.dumps(data))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_bad_json_and_wrappers_rejected(self):
        self._write("{not json")
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)
        self._write(json.dumps({"format": "wrong", "version": 1}))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)
        self._write(json.dumps({"format": "interflow", "version": 99}))
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_nan_constant_rejected(self):
        self._write('{"format": "interflow", "version": 1, "x": NaN}')
        with self.assertRaises(PersistenceError):
            load_from_file(self.path)

    def test_missing_file_rejected(self):
        with self.assertRaises(PersistenceError):
            load_from_file(os.path.join(self.tmp, "nope.json"))

    def test_failed_load_keeps_memory_state(self):
        good = build_demo_engine(drive=True)
        pos = good.current_position()
        vars_ = good.get_variables()
        depth = good.history_depth()
        log_len = len(good.migration_log())
        # 连续尝试多个坏文件，good 引擎不受任何影响
        self._write("garbage")
        for _ in range(3):
            with self.assertRaises(PersistenceError):
                load_from_file(self.path)
        self.assertEqual(good.current_position(), pos)
        self.assertEqual(good.get_variables(), vars_)
        self.assertEqual(good.history_depth(), depth)
        self.assertEqual(len(good.migration_log()), log_len)
        # 且仍能正常推进
        good.trigger("back_btn", "back")
        self.assertEqual(good.current_position(), ("form", "s0"))


# ---------------------------------------------------------------------- #
# 需求 8：逐步推导比对的多页面验收流
# ---------------------------------------------------------------------- #

class TestAcceptanceWalkthrough(unittest.TestCase):

    def test_path_variables_history_match_manual_derivation(self):
        e = build_demo_engine()
        trace = []

        def snapshot(label):
            trace.append((
                label,
                e.current_position(),
                e.get_variables(),
                e.history_depth(),
            ))

        snapshot("init")
        # 1) home guest --go--> login
        e.trigger("btn_go", "go")
        snapshot("guest->login")
        # 2) 提交名字 -> form
        e.trigger("input_name", "submit_name", "carol")
        snapshot("->form")
        # 3) 选 pro（只写变量）
        e.trigger("radio_plan", "set_plan", "pro")
        snapshot("plan=pro")
        # 4) 条件路由 -> pay
        e.trigger("radio_plan", "route")
        snapshot("->pay")
        # 5) 返回 -> form，快照中 plan 为 free（离开 form 时存的是那刻快照）
        e.trigger("back_btn", "back")
        snapshot("back->form")
        # 6) 再返回 -> login
        e.trigger("back_btn", "back")
        snapshot("back->login")
        # 7) 再返回 -> home
        e.trigger("back_btn", "back")
        snapshot("back->home")
        # 8) 空历史返回被拒绝，状态不变
        with self.assertRaises(BackRejectedError):
            e.trigger("back_btn", "back")
        snapshot("back-rejected")

        expected = [
            ("init",          ("home", "s0"),  {"role": "guest"}, 0),
            ("guest->login",  ("login", "s0"), {"user": ""}, 1),
            ("->form",        ("form", "s0"),
             {"name": "", "plan": "free"}, 2),
            ("plan=pro",      ("form", "s0"),
             {"name": "", "plan": "pro"}, 2),
            ("->pay",         ("pay", "s0"), {"amount": 99}, 3),
            # 离开 form 时快照 plan=pro，故返回恢复 pro
            ("back->form",    ("form", "s0"),
             {"name": "", "plan": "pro"}, 2),
            # login 帧捕获的是离开 login 那一刻的活动变量（含提交的名字）
            ("back->login",   ("login", "s0"), {"user": "carol"}, 1),
            ("back->home",    ("home", "s0"), {"role": "guest"}, 0),
            ("back-rejected", ("home", "s0"), {"role": "guest"}, 0),
        ]
        self.assertEqual(trace, expected)

    def test_clock_continuous_and_log_coherent(self):
        e = build_demo_engine()
        e.trigger("btn_go", "go")
        with self.assertRaises(BatchAbortedError):
            e.trigger_batch([
                TriggerStep("back_btn", "back"),
                TriggerStep("ghost", "x"),
            ])
        e.trigger("back_btn", "back")
        clocks = [r.clock for r in e.migration_log()]
        # 回滚不产生时钟空洞
        self.assertEqual(clocks, [1, 2])
        self.assertEqual(e.clock, 2)
        # 每条记录首尾相接：回滚后第二条返回动作重新从 login 出发
        log = e.migration_log()
        self.assertEqual(log[0].source, ("home", "s0"))
        self.assertEqual(log[0].dest, ("login", "s0"))
        self.assertEqual(log[1].source, ("login", "s0"))
        self.assertEqual(log[1].dest, ("home", "s0"))


# ---------------------------------------------------------------------- #
# 回归：批次三种失败位置无残留 + 带分支页面返回后再前进一致 + 重载后批次回滚
# ---------------------------------------------------------------------- #

def _el(eid, action):
    x = InteractionElement(eid)
    x.add_action(action)
    return x


def build_branch_regression_engine():
    """三页图，A 上可改变量并按变量条件跳 B/C，每页都有返回按钮。

    A.s0 变量 {v: 0}；条件 go 按 v：1->B.s0，其余兜底->C.s0。
    另有 cond_missing 动作依赖永不提供的变量 zz，用于触发“条件无法判定”。
    """
    e = PrototypeEngine("A")
    A = Page("A", "s0", [PageState("s0", {"v": 0})])
    A.add_element(_el("set_v", Action.submit("w", "v")))
    go = InteractionElement("go")
    go.add_action(Action.branch_goto(
        "w", "v", [(1, "B.s0")], default_target="C.s0"))
    A.add_element(go)
    missing = InteractionElement("cond_missing")
    missing.add_action(Action.branch_goto(
        "w", "zz", [(1, "B.s0")], default_target="C.s0"))
    A.add_element(missing)
    A.add_element(_el("back_btn", Action.back("back")))
    e.add_page(A)

    B = Page("B", "s0", [PageState("s0", {"b": 10})])
    B.add_element(_el("set_b", Action.submit("w", "b")))
    B.add_element(_el("back_btn", Action.back("back")))
    e.add_page(B)

    C = Page("C", "s0", [PageState("s0", {"c": 20})])
    C.add_element(_el("back_btn", Action.back("back")))
    e.add_page(C)

    e.validate()
    e.reset()
    return e


class TestBatchRollbackNoResidue(unittest.TestCase):
    """整批失败时，迁移日志、历史栈、变量快照必须与批前完全一致。"""

    def _assert_unchanged(self, e, before):
        pos, variables, depth, log_ids, clock = before
        self.assertEqual(e.current_position(), pos)
        self.assertEqual(e.get_variables(), variables)
        self.assertEqual(e.history_depth(), depth)
        self.assertEqual(
            [(r.clock, r.element_id, r.action_id) for r in e.migration_log()],
            log_ids,
        )
        self.assertEqual(e.clock, clock)

    def _capture(self, e):
        return (
            e.current_position(),
            e.get_variables(),
            e.history_depth(),
            [(r.clock, r.element_id, r.action_id) for r in e.migration_log()],
            e.clock,
        )

    def test_failure_at_first_step_leaves_nothing(self):
        e = build_branch_regression_engine()
        # 先制造非空日志与历史：v=1 -> B
        e.trigger("set_v", "w", 1)
        e.trigger("go", "w")
        self.assertEqual(e.history_depth(), 1)
        before = self._capture(e)
        # 在 B 上：首步即条件无法判定（排序上 cond 也在最前），无成功步
        # 通过给 B 增加一个缺变量条件元素来制造“首步失败”
        bpage = e.pages["B"]
        bpage.add_element(InteractionElement("a_missing")).add_action(
            Action.branch_goto(
                "w", "zz", [(1, "C.s0")], default_target="C.s0"))
        bpage.add_element(_el("z_set", Action.submit("w", "b")))
        with self.assertRaises(BatchAbortedError) as cm:
            e.trigger_batch([
                TriggerStep("z_set", "w", 99),
                TriggerStep("a_missing", "w"),
            ])
        self.assertEqual(cm.exception.index, 0)
        self.assertEqual(cm.exception.completed, 0)
        self._assert_unchanged(e, before)

    def test_failure_at_middle_step_leaves_nothing(self):
        e = build_branch_regression_engine()
        e.trigger("set_v", "w", 1)
        e.trigger("go", "w")   # -> B，历史 1 帧，日志 2 条
        bpage = e.pages["B"]
        bpage.add_element(_el("a_set", Action.submit("w", "b")))
        bpage.add_element(InteractionElement("m_missing")).add_action(
            Action.branch_goto(
                "w", "zz", [(1, "C.s0")], default_target="C.s0"))
        bpage.add_element(_el("z_set", Action.submit("w", "b")))
        before = self._capture(e)
        # 排序：a_set（成功改 b）-> m_missing（条件无法判定）-> z_set（不执行）
        with self.assertRaises(BatchAbortedError) as cm:
            e.trigger_batch([
                TriggerStep("z_set", "w", 7),
                TriggerStep("m_missing", "w"),
                TriggerStep("a_set", "w", 5),
            ])
        self.assertEqual(cm.exception.index, 1)
        self.assertEqual(cm.exception.completed, 1)
        self.assertIsInstance(cm.exception.reason, MissingVariablesError)
        self.assertEqual(cm.exception.reason.missing, ["zz"])
        # 第 0 步虽已成功改了 b、可能压栈，但整批回滚后无任何残留
        self._assert_unchanged(e, before)
        # 预览路径无半迁移：仍停在 B.s0，变量是 B 的落地快照
        self.assertEqual(e.current_position(), ("B", "s0"))
        self.assertEqual(e.get_variables(), {"b": 10})

    def test_failure_at_last_step_leaves_nothing(self):
        e = build_branch_regression_engine()
        e.trigger("set_v", "w", 1)
        e.trigger("go", "w")   # -> B
        bpage = e.pages["B"]
        bpage.add_element(_el("a_set", Action.submit("w", "b")))
        bpage.add_element(_el("m_set", Action.submit("w", "b")))
        bpage.add_element(InteractionElement("z_missing")).add_action(
            Action.branch_goto(
                "w", "zz", [(1, "C.s0")], default_target="C.s0"))
        before = self._capture(e)
        # 排序：a_set 成功、m_set 成功、z_missing 末步失败
        with self.assertRaises(BatchAbortedError) as cm:
            e.trigger_batch([
                TriggerStep("z_missing", "w"),
                TriggerStep("a_set", "w", 1),
                TriggerStep("m_set", "w", 2),
            ])
        self.assertEqual(cm.exception.index, 2)
        self.assertEqual(cm.exception.completed, 2)
        self._assert_unchanged(e, before)

    def test_failed_batch_does_not_taint_reachable_query_or_clock(self):
        # 报告中的关键症状：失败批次里已成功的跨页步若残留，会让后续把未生效
        # 迁移算进路径 / 日志。回滚后再成功触发，clock 必须接续批前值。
        e = build_branch_regression_engine()
        e.trigger("set_v", "w", 1)
        e.trigger("go", "w")   # clock=2, 在 B
        bpage = e.pages["B"]
        bpage.add_element(_el("a_set", Action.submit("w", "b")))
        bpage.add_element(InteractionElement("z_missing")).add_action(
            Action.branch_goto(
                "w", "zz", [(1, "C.s0")], default_target="C.s0"))
        with self.assertRaises(BatchAbortedError):
            e.trigger_batch([
                TriggerStep("z_missing", "w"),
                TriggerStep("a_set", "w", 1),
            ])
        # 回滚后下一条成功迁移的 clock 接续批前（=2），为 3，无空洞无重复
        rec = e.trigger("set_b", "w", 42)
        self.assertEqual(rec.clock, 3)
        self.assertEqual([r.clock for r in e.migration_log()], [1, 2, 3])

    def test_unexpected_error_also_rolls_back(self):
        # 即使某步抛出业务之外的意外异常（非 InterflowError），
        # 也必须先回滚再原样上抛，绝不留半迁移。
        class Boom(Exception):
            pass

        class BoomEngine(PrototypeEngine):
            def _finish_move(self, action, *a, **k):
                if getattr(action, "target_page", None) == "B":
                    raise Boom()
                return super()._finish_move(action, *a, **k)

        e = BoomEngine("A")
        A = Page("A", "s0", [PageState("s0", {"v": 0})])
        A.add_element(_el("a_sub", Action.submit("w", "v")))
        A.add_element(_el("b_go", Action.goto("w", "B")))
        e.add_page(A)
        e.add_page(Page("B", "s0", [PageState("s0", {})]))
        e.reset()
        before = self._capture(e)
        # 第 0 步提交成功（v 已被改成 9），第 1 步跨页时抛非业务异常
        with self.assertRaises(Boom):
            e.trigger_batch([
                TriggerStep("b_go", "w"),
                TriggerStep("a_sub", "w", 9),
            ])
        # 第 0 步的变量修改也必须随整批回滚撤销
        self._assert_unchanged(e, before)
        self.assertEqual(e.get_variables(), {"v": 0})


class TestBackThenReForwardBranch(unittest.TestCase):
    """带条件分支的页面被返回时，必须还原“离开那一刻”的变量快照，
    随后再次前进要走回同一条分支。"""

    def test_back_restores_departure_snapshot_and_same_branch(self):
        e = build_branch_regression_engine()
        # A 上把 v 改成 1（同页提交，活动变量 v=1）
        e.trigger("set_v", "w", 1)
        self.assertEqual(e.get_variables(), {"v": 1})
        # 条件跳 B；离开 A 的历史帧必须捕获 v=1
        go = e.trigger("go", "w")
        self.assertEqual(go.dest, ("B", "s0"))
        self.assertEqual(go.branch, 1)
        frame = e.history_frames()[-1]
        self.assertEqual((frame.page_id, frame.state_id), ("A", "s0"))
        self.assertEqual(frame.variables, {"v": 1})  # 离开那一刻，非进入时 {v:0}

        # 返回 A：必须恢复离开时的 v=1，而不是进入 A 时的 v=0
        back = e.trigger("back_btn", "back")
        self.assertEqual(back.dest, ("A", "s0"))
        self.assertEqual(e.get_variables(), {"v": 1})

        # 在 A 上预判分支，必须一致指向 B、命中值 1
        q = e.which_branch("go", "w")
        self.assertEqual(q["target_ref"], "B.s0")
        self.assertEqual(q["matched"], 1)

        # 再前进：同一变量取值 -> 同一条分支 B，命中值仍为 1
        go2 = e.trigger("go", "w")
        self.assertEqual(go2.dest, ("B", "s0"))
        self.assertEqual(go2.branch, 1)

    def test_back_after_multiple_layers_restores_each_departure(self):
        e = build_branch_regression_engine()
        # v 改为非 1，条件走兜底 C
        e.trigger("set_v", "w", 2)
        go = e.trigger("go", "w")
        self.assertEqual(go.dest, ("C", "s0"))
        self.assertTrue(go.to_dict()["default"])
        # 离开 A 的帧捕获 v=2
        self.assertEqual(e.history_frames()[-1].variables, {"v": 2})
        e.trigger("back_btn", "back")
        self.assertEqual(e.get_variables(), {"v": 2})
        # 再前进仍走兜底 C
        self.assertEqual(e.trigger("go", "w").dest, ("C", "s0"))


class TestReloadThenBatchRollback(unittest.TestCase):
    """导出再载入后，继续触发批次，失败时仍能整批回滚且无残留。"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "proto.json")

    def test_batch_rollback_after_reload(self):
        e = build_branch_regression_engine()
        e.trigger("set_v", "w", 1)
        e.trigger("go", "w")       # -> B，clock=2，历史 1
        save_to_file(self.path, e)

        loaded = load_from_file(self.path)
        self.assertEqual(loaded.current_position(), ("B", "s0"))
        self.assertEqual(loaded.history_depth(), 1)

        bpage = loaded.pages["B"]
        bpage.add_element(_el("a_set", Action.submit("w", "b")))
        bpage.add_element(InteractionElement("z_missing")).add_action(
            Action.branch_goto(
                "w", "zz", [(1, "C.s0")], default_target="C.s0"))
        # 注意：新增的是运行期定义，未写回文件，这里只验证载入引擎的事务行为
        before = (
            loaded.current_position(), loaded.get_variables(),
            loaded.history_depth(),
            [(r.clock, r.element_id, r.action_id) for r in loaded.migration_log()],
            loaded.clock,
        )
        with self.assertRaises(BatchAbortedError) as cm:
            loaded.trigger_batch([
                TriggerStep("z_missing", "w"),
                TriggerStep("a_set", "w", 5),
            ])
        self.assertEqual(cm.exception.index, 1)
        # 日志、栈、变量与批前（即载入态）完全一致
        self.assertEqual(loaded.current_position(), before[0])
        self.assertEqual(loaded.get_variables(), before[1])
        self.assertEqual(loaded.history_depth(), before[2])
        self.assertEqual(
            [(r.clock, r.element_id, r.action_id)
             for r in loaded.migration_log()],
            before[3],
        )
        self.assertEqual(loaded.clock, before[4])
        # 回滚后成功触发，clock 从载入态的 2 接续为 3
        rec = loaded.trigger("set_b", "w", 7)
        self.assertEqual(rec.clock, 3)
        self.assertEqual(loaded.get_variables()["b"], 7)

    def test_reload_preserves_back_branch_consistency(self):
        e = build_branch_regression_engine()
        e.trigger("set_v", "w", 1)
        e.trigger("go", "w")       # A{v:1} -> B
        save_to_file(self.path, e)
        loaded = load_from_file(self.path)
        # 载入后返回 A，再前进，仍应走回 B（分支一致、快照为离开时的 v=1）
        loaded.trigger("back_btn", "back")
        self.assertEqual(loaded.get_variables(), {"v": 1})
        rec = loaded.trigger("go", "w")
        self.assertEqual(rec.dest, ("B", "s0"))
        self.assertEqual(rec.branch, 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)