"""单文件持久化：保存 / 载入整个原型，并在载入时做严格自洽校验。

文件格式（UTF-8 JSON）::

    {
      "format": "interflow", "version": 1,
      "start_page": "...",
      "pages": [ ... 页面 / 状态 / 元素 / 动作 ... ],
      "runtime": {
        "current_page": ..., "current_state": ...,
        "variables": {...},
        "history": [ {"page", "state", "variables"}, ... ],
        "clock": N,
        "log": [ ... 迁移记录 ... ]
      }
    }

载入策略
========
所有定义先在一个**全新引擎**里重建（构造器即完成形状、互斥、覆盖校验，
:meth:`PrototypeEngine.validate` 完成目标存在性校验），随后从起始页开始
**逐条重放迁移日志**，把重放得到的位置、变量快照、历史栈、时钟与文件中
记录的 runtime 做深度比对。任何一处对不上（文件被篡改、字段缺失、日志断
档、历史不自洽）都抛出 :class:`PersistenceError`，新引擎被丢弃，调用方
已有引擎不受任何影响。

保存采用「写临时文件 + 原子替换」，序列化失败绝不会破坏已有文件。
"""

import copy
import json
import os
import tempfile

from .errors import (
    PersistenceError,
    InterflowError,
    DefinitionError,
)
from .engine import PrototypeEngine
from .models import (
    Action,
    Page,
    PageState,
    InteractionElement,
    GOTO,
    BACK,
    SET_STATE,
    SUBMIT,
)

FORMAT_NAME = "interflow"
FORMAT_VERSION = 1


# ---------------------------------------------------------------------- #
# 保存
# ---------------------------------------------------------------------- #

def save_to_file(path, engine):
    """把引擎的定义与运行期状态序列化到 ``path``（原子写入）。"""
    engine.validate()
    engine._ensure_started()
    payload = {
        "format": FORMAT_NAME,
        "version": FORMAT_VERSION,
        "start_page": engine._start_page_id,
        "pages": [engine.pages[pid].to_dict()
                  for pid in sorted(engine.pages)],
        "runtime": {
            "current_page": engine.current_page_id,
            "current_state": engine.current_state_id,
            "variables": copy.deepcopy(engine.variables),
            "history": [f.to_dict() for f in engine.history],
            "clock": engine.clock,
            "log": [r.to_dict() for r in engine.log],
        },
    }
    # 先在内存完成序列化，再落盘，避免半文件覆盖旧文件
    try:
        text = json.dumps(payload, ensure_ascii=False, indent=2,
                          sort_keys=True, allow_nan=False)
    except ValueError as exc:
        raise PersistenceError(
            f"状态中含无法序列化为合法 JSON 的值（NaN/Infinity）：{exc}"
        ) from exc
    _atomic_write_text(path, text)
    return path


def _atomic_write_text(path, text):
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".interflow-", suffix=".tmp",
                                    dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp_path, path)
    except OSError as exc:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise PersistenceError(f"写入文件 {path!r} 失败：{exc}") from exc


# ---------------------------------------------------------------------- #
# 载入
# ---------------------------------------------------------------------- #

def load_from_file(path):
    """从文件载入引擎；任何损坏 / 缺字段 / 不自洽都抛
    :class:`PersistenceError`。"""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()
    except OSError as exc:
        raise PersistenceError(f"无法读取文件 {path!r}：{exc}") from exc

    try:
        data = json.loads(raw, parse_constant=_reject_constant)
    except JSONDecodeErrorShim as exc:
        raise PersistenceError(
            f"文件 {path!r} 不是合法 JSON：{exc}"
        ) from exc
    except ValueError as exc:
        # parse_constant 拒绝 NaN / Infinity
        raise PersistenceError(f"文件 {path!r} 含非法 JSON 常量：{exc}") from exc

    try:
        return _build_engine(data)
    except PersistenceError:
        raise
    except InterflowError as exc:
        raise PersistenceError(f"文件 {path!r} 校验失败：{exc}") from exc


# json 的 JSONDecodeError 与 parse_constant 异常统一
try:
    JSONDecodeErrorShim = json.JSONDecodeError
except AttributeError:  # 极老版本兜底
    JSONDecodeErrorShim = ValueError


def _reject_constant(value):
    raise ValueError(f"不允许的 JSON 常量 {value}（NaN / Infinity）")


# ---------------------------------------------------------------------- #
# 字典 -> 对象
# ---------------------------------------------------------------------- #

def _require(obj, key, ctx, expected_type=None, of_type_desc=None):
    if not isinstance(obj, dict):
        raise PersistenceError(f"{ctx} 应为对象，得到 {type(obj).__name__}")
    if key not in obj:
        raise PersistenceError(f"{ctx} 缺少必需字段 {key!r}")
    value = obj[key]
    if expected_type is not None and not isinstance(value, expected_type):
        name = of_type_desc or expected_type.__name__
        raise PersistenceError(
            f"{ctx} 字段 {key!r} 应为 {name}，得到 {type(value).__name__}"
        )
    return value


def _nonempty_str(value, ctx):
    if not isinstance(value, str) or not value:
        raise PersistenceError(f"{ctx} 应为非空字符串，得到 {value!r}")
    return value


def _variables_from_dict(value, ctx):
    if not isinstance(value, dict):
        raise PersistenceError(f"{ctx} 的变量应为对象，得到 {type(value).__name__}")
    for var_name in value:
        if not isinstance(var_name, str):
            raise PersistenceError(f"{ctx} 的变量名必须是字符串：{var_name!r}")
    return copy.deepcopy(value)


def _action_from_dict(d, ctx):
    if not isinstance(d, dict):
        raise PersistenceError(f"{ctx} 应为对象")
    aid = _nonempty_str(_require(d, "id", ctx), f"{ctx} 的标识")
    kind = _require(d, "kind", ctx)
    if kind not in (GOTO, BACK, SET_STATE, SUBMIT):
        raise PersistenceError(f"{ctx} 的 kind={kind!r} 非法")

    if kind == GOTO and d.get("branches") is not None:
        variable = _nonempty_str(
            _require(d, "variable", ctx), f"{ctx} 的判定变量"
        )
        raw_branches = _require(d, "branches", ctx, list, "数组")
        branches = []
        for i, br in enumerate(raw_branches):
            bctx = f"{ctx} 的第 {i} 条分支"
            if not isinstance(br, dict):
                raise PersistenceError(f"{bctx} 应为对象")
            if "value" not in br:
                raise PersistenceError(f"{bctx} 缺少字段 'value'（允许为 null）")
            target = _nonempty_str(
                _require(br, "target", bctx), f"{bctx} 的目标"
            )
            branches.append((br["value"], target))
        default_target = d.get("default_target")
        if default_target is not None:
            _nonempty_str(default_target, f"{ctx} 的兜底目标")
        exhaustive = bool(d.get("exhaustive", False))
        try:
            return Action.branch_goto(
                aid, variable, branches,
                default_target=default_target,
                exhaustive=exhaustive,
            )
        except DefinitionError as exc:
            raise PersistenceError(f"{ctx} 条件定义非法：{exc}") from exc

    if kind == GOTO:
        target_page = _nonempty_str(
            _require(d, "target_page", ctx), f"{ctx} 的目标页面"
        )
        target_state = d.get("target_state")
        if target_state is not None:
            _nonempty_str(target_state, f"{ctx} 的目标状态")
        return Action.goto(aid, target_page, target_state)

    if kind == BACK:
        return Action.back(aid)

    if kind == SET_STATE:
        target_state = _nonempty_str(
            _require(d, "target_state", ctx), f"{ctx} 的目标状态"
        )
        return Action.set_state(aid, target_state)

    # submit
    input_var = _nonempty_str(
        _require(d, "input_var", ctx), f"{ctx} 的输入变量"
    )
    target_page = d.get("target_page")
    if target_page is not None:
        _nonempty_str(target_page, f"{ctx} 的目标页面")
    target_state = d.get("target_state")
    if target_state is not None:
        _nonempty_str(target_state, f"{ctx} 的目标状态")
    return Action.submit(aid, input_var, target_page, target_state)


def _page_from_dict(d):
    if not isinstance(d, dict):
        raise PersistenceError("pages 中的每一项应为对象")
    pid = _nonempty_str(_require(d, "id", "页面"), "页面标识")
    entry = _nonempty_str(
        _require(d, "entry_state", f"页面 {pid!r}"), "入口状态标识"
    )

    states = []
    raw_states = _require(d, "states", f"页面 {pid!r}", list, "数组")
    for sd in raw_states:
        sid = _nonempty_str(_require(sd, "id", f"页面 {pid!r} 的状态"),
                            "状态标识")
        variables = _variables_from_dict(sd.get("variables", {}),
                                         f"状态 {pid}.{sid}")
        states.append(PageState(sid, variables))

    try:
        page = Page(pid, entry, states)
    except DefinitionError as exc:
        raise PersistenceError(f"页面 {pid!r} 定义非法：{exc}") from exc

    raw_elements = _require(d, "elements", f"页面 {pid!r}", list, "数组")
    for ed in raw_elements:
        eid = _nonempty_str(_require(ed, "id", f"页面 {pid!r} 的元素"),
                            "元素标识")
        try:
            element = InteractionElement(eid)
        except DefinitionError as exc:
            raise PersistenceError(str(exc)) from exc
        raw_actions = _require(ed, "actions",
                               f"页面 {pid!r} 元素 {eid!r}",
                               list, "数组")
        for ad in raw_actions:
            ctx = f"页面 {pid!r} 元素 {eid!r}"
            element.add_action(_action_from_dict(ad, ctx))
        page.add_element(element)

    return page


# ---------------------------------------------------------------------- #
# 组装 + 重放校验
# ---------------------------------------------------------------------- #

def _build_engine(data):
    if not isinstance(data, dict):
        raise PersistenceError("文件根节点应为对象")
    fmt = _require(data, "format", "根节点")
    if fmt != FORMAT_NAME:
        raise PersistenceError(f"文件格式标识 {fmt!r} 不是 {FORMAT_NAME!r}")
    version = _require(data, "version", "根节点")
    if version != FORMAT_VERSION:
        raise PersistenceError(
            f"文件版本 {version!r} 不受支持（需要 {FORMAT_VERSION}）"
        )
    start_page = _nonempty_str(
        _require(data, "start_page", "根节点"), "start_page"
    )
    raw_pages = _require(data, "pages", "根节点", list, "数组")

    engine = PrototypeEngine(start_page)
    for pd in raw_pages:
        engine.add_page(_page_from_dict(pd))
    # 目标存在性、入口状态等整体校验
    engine.validate()

    runtime = _require(data, "runtime", "根节点", dict, "对象")
    _replay_and_verify(engine, runtime)
    return engine


def _replay_and_verify(engine, runtime):
    """重放日志并验证 runtime 与重放结果完全一致。"""
    current_page = _nonempty_str(
        _require(runtime, "current_page", "runtime"), "current_page"
    )
    current_state = _nonempty_str(
        _require(runtime, "current_state", "runtime"), "current_state"
    )
    variables = _variables_from_dict(
        _require(runtime, "variables", "runtime"), "runtime.variables"
    )
    raw_history = _require(runtime, "history", "runtime", list, "数组")
    clock = _require(runtime, "clock", "runtime", int, "整数")
    if isinstance(clock, bool) or clock < 0:
        raise PersistenceError("runtime.clock 应为非负整数")
    raw_log = _require(runtime, "log", "runtime", list, "数组")

    # --- 先静态检查 history / log 的字段形状 ---
    history = []
    for i, frame in enumerate(raw_history):
        ctx = f"runtime.history[{i}]"
        if not isinstance(frame, dict):
            raise PersistenceError(f"{ctx} 应为对象")
        fpage = _nonempty_str(_require(frame, "page", ctx), f"{ctx}.page")
        fstate = _nonempty_str(_require(frame, "state", ctx), f"{ctx}.state")
        fvars = _variables_from_dict(
            _require(frame, "variables", ctx), f"{ctx}.variables"
        )
        history.append((fpage, fstate, fvars))

    records = []
    for i, rec in enumerate(raw_log):
        ctx = f"runtime.log[{i}]"
        if not isinstance(rec, dict):
            raise PersistenceError(f"{ctx} 应为对象")
        rec_clock = _require(rec, "clock", ctx, int, "整数")
        if isinstance(rec_clock, bool):
            raise PersistenceError(f"{ctx}.clock 应为整数")
        element = _nonempty_str(_require(rec, "element", ctx), f"{ctx}.element")
        action = _nonempty_str(_require(rec, "action", ctx), f"{ctx}.action")
        kind = _require(rec, "kind", ctx)
        if kind not in (GOTO, BACK, SET_STATE, SUBMIT):
            raise PersistenceError(f"{ctx}.kind={kind!r} 非法")
        source = _endpoint(rec, "source", ctx)
        dest = _endpoint(rec, "dest", ctx)
        is_default = bool(rec.get("default", False))
        if "branch" not in rec:
            raise PersistenceError(f"{ctx} 缺少字段 'branch'（允许为 null）")
        branch = rec["branch"]
        if is_default and branch is not None:
            raise PersistenceError(f"{ctx} 标记 default=true 但 branch 非 null")
        input_pair = None
        raw_input = _require(rec, "input", ctx)
        if raw_input is not None:
            if not isinstance(raw_input, dict):
                raise PersistenceError(f"{ctx}.input 应为对象或 null")
            ivar = _nonempty_str(_require(raw_input, "var", f"{ctx}.input"),
                                 f"{ctx}.input.var")
            if "value" not in raw_input:
                raise PersistenceError(
                    f"{ctx}.input 缺少字段 'value'（允许为 null）"
                )
            input_pair = (ivar, raw_input["value"])
        records.append({
            "clock": rec_clock, "element": element, "action": action,
            "kind": kind, "source": source, "dest": dest,
            "default": is_default, "branch": branch, "input": input_pair,
        })

    # 时钟必须从 1 连续递增且与日志等长
    expected_clocks = [i + 1 for i in range(len(records))]
    actual_clocks = [r["clock"] for r in records]
    if actual_clocks != expected_clocks:
        raise PersistenceError(
            f"迁移日志的 clock 必须从 1 连续递增，期望 {expected_clocks[:5]}...，"
            f"实际起始为 {actual_clocks[:5]}..."
        )
    if clock != len(records):
        raise PersistenceError(
            f"runtime.clock={clock} 与日志条数 {len(records)} 不一致"
        )

    # --- 重放 ---
    engine.reset()
    for i, rec in enumerate(records):
        ctx = f"runtime.log[{i}]"
        pre_pos = engine.current_position()
        if tuple(pre_pos) != rec["source"]:
            raise PersistenceError(
                f"{ctx} 的 source={rec['source']} 与重放位置 "
                f"{tuple(pre_pos)} 不一致，日志或历史已损坏"
            )
        try:
            if rec["kind"] == SUBMIT:
                if rec["input"] is None:
                    raise PersistenceError(
                        f"{ctx} 是 submit 记录却缺少 input.value"
                    )
                produced = engine.trigger(
                    rec["element"], rec["action"], value=rec["input"][1]
                )
            else:
                produced = engine.trigger(rec["element"], rec["action"])
        except InterflowError as exc:
            raise PersistenceError(
                f"重放 {ctx}（元素 {rec['element']!r} 动作 "
                f"{rec['action']!r}）失败：{exc}"
            ) from exc

        if produced.kind != rec["kind"]:
            raise PersistenceError(f"{ctx} 重放的 kind 不一致")
        if tuple(produced.dest) != rec["dest"]:
            raise PersistenceError(
                f"{ctx} 的 dest={rec['dest']} 与重放结果 "
                f"{tuple(produced.dest)} 不一致"
            )
        produced_default = produced.branch == "__default__"
        if produced_default != rec["default"]:
            raise PersistenceError(f"{ctx} 兜底命中标记与重放不一致")
        if not rec["default"] and produced.branch != rec["branch"]:
            raise PersistenceError(
                f"{ctx} 的 branch={rec['branch']!r} 与重放命中值 "
                f"{produced.branch!r} 不一致"
            )
        if rec["kind"] == SUBMIT:
            if rec["input"] is None or produced.input_var != rec["input"][0] \
                    or produced.input_value != rec["input"][1]:
                raise PersistenceError(f"{ctx} 的输入记录与重放不一致")
        if produced.clock != rec["clock"]:
            raise PersistenceError(f"{ctx} 的 clock 与重放不一致")

    # --- 与文件中 runtime 做终态比对 ---
    final_pos = engine.current_position()
    if tuple(final_pos) != (current_page, current_state):
        raise PersistenceError(
            f"runtime 当前位置 {(current_page, current_state)} 与日志重放结果 "
            f"{tuple(final_pos)} 不一致，运行期状态已损坏"
        )
    if current_page not in engine.pages:
        raise PersistenceError(f"runtime.current_page={current_page!r} 不存在")
    if current_state not in engine.pages[current_page].states:
        raise PersistenceError(
            f"runtime.current_state={current_page}.{current_state} 不存在"
        )
    if engine.get_variables() != variables:
        raise PersistenceError(
            "runtime.variables 与日志重放得到的变量快照不一致"
        )
    replayed_history = [
        (f.page_id, f.state_id, f.variables) for f in engine.history_frames()
    ]
    if len(replayed_history) != len(history):
        raise PersistenceError(
            f"runtime.history 深度 {len(history)} 与重放得到的 "
            f"{len(replayed_history)} 不一致"
        )
    for i, (frame, saved) in enumerate(zip(replayed_history, history)):
        fpage, fstate, fvars = frame
        spage, sstate, svars = saved
        if (fpage, fstate) != (spage, sstate):
            raise PersistenceError(
                f"runtime.history[{i}] 的位置 {(spage, sstate)} 与重放结果 "
                f"{(fpage, fstate)} 不一致"
            )
        if fvars != svars:
            raise PersistenceError(
                f"runtime.history[{i}] 的变量快照与重放结果不一致"
            )
        if spage not in engine.pages or sstate not in engine.pages[spage].states:
            raise PersistenceError(
                f"runtime.history[{i}] 指向不存在的 {spage}.{sstate}"
            )


def _endpoint(rec, key, ctx):
    ep = _require(rec, key, ctx)
    if not isinstance(ep, dict):
        raise PersistenceError(f"{ctx}.{key} 应为对象")
    page = _nonempty_str(_require(ep, "page", f"{ctx}.{key}"),
                         f"{ctx}.{key}.page")
    state = _nonempty_str(_require(ep, "state", f"{ctx}.{key}"),
                          f"{ctx}.{key}.state")
    return page, state
