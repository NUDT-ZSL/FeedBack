# -*- coding: utf-8 -*-
"""事件驱动排程引擎。

职责：
- 按依赖与机器可用时段做确定性列表调度，目标是尽早完工；
- 任务失败时只阻断其下游，其余任务继续；
- 重试成功后下游自动恢复，调度优先级不变，完工顺序与无故障时一致；
- 素材中途替换时圈定受影响任务，由操作员决定重跑或忽略；
- 每个 tick 落检查点，进程重启后从断点继续。
"""
from __future__ import annotations

import json
import os
import threading
import time

from scheduler_core import (build_dependencies, detect_cycle, downstream_map,
                            priorities, transitive_closure)

WAITING = "waiting"
RUNNING = "running"
BLOCKED = "blocked"
FAILED = "failed"
DONE = "done"
AFFECTED = "affected"


class Engine:
    def __init__(self, materials, machines, tasks, checkpoint_path=None,
                 tick_real=0.2, tick_sim=1):
        self.materials = materials
        self.machines = machines
        self.tasks = tasks
        self.deps = build_dependencies(tasks)
        detect_cycle(self.deps)  # 循环依赖在此被拒绝
        self.down = downstream_map(self.deps)
        self.prio = priorities(tasks, self.deps)
        self.checkpoint_path = checkpoint_path
        self.tick_real = tick_real
        self.tick_sim = tick_sim
        self.now = 0
        self.status = {tid: WAITING for tid in tasks}
        self.on_machine = {}
        self.started_at = {}
        self.finish_at = {}
        self.completion_order = []
        self.machine_paused = set()
        self.material_pending = {}  # mat_id -> {"version": n, "tasks": [ids]}
        self.affected_by = {}       # task_id -> mat_id
        self.log = []
        self.finished = False
        self.lock = threading.RLock()
        self._stop = threading.Event()
        self._thread = None
        if checkpoint_path and os.path.exists(checkpoint_path):
            self._load_checkpoint()

    # ---------- 生命周期 ----------
    def start(self):
        if self._thread is None:
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def _loop(self):
        while not self._stop.is_set():
            time.sleep(self.tick_real)
            with self.lock:
                self._tick()

    def _tick(self):
        self.now += self.tick_sim
        for tid in [t for t, s in self.status.items() if s == RUNNING]:
            if self.finish_at[tid] <= self.now:
                self._complete(tid)
        self._dispatch()
        if not self.finished and all(s == DONE for s in self.status.values()):
            self.finished = True
            self._log("全部任务完成，最终顺序: " + " -> ".join(self.completion_order))
        self._save_checkpoint()

    # ---------- 调度 ----------
    def _dispatch(self):
        """每台空闲机器在可运行的就绪任务中取优先级最高的一个。"""
        busy = {mid: tid for tid, mid in self.on_machine.items()}
        for mid in sorted(self.machines):
            machine = self.machines[mid]
            if mid in self.machine_paused or mid in busy:
                continue
            ready = []
            for tid, task in self.tasks.items():
                if self.status[tid] != WAITING:
                    continue
                if any(self.status[d] != DONE for d in self.deps[tid]):
                    continue
                if task.machine_type != "any" and task.machine_type != machine.type:
                    continue
                if not machine.window_fit(self.now, task.duration):
                    continue
                ready.append(tid)
            if not ready:
                continue
            tid = min(ready, key=lambda t: self.prio[t])
            self.status[tid] = RUNNING
            self.on_machine[tid] = mid
            self.started_at[tid] = self.now
            self.finish_at[tid] = self.now + self.tasks[tid].duration
            self._log(f"任务 {tid} 派发到 {mid}，预计 {self.finish_at[tid]} 完成")

    def _complete(self, tid):
        self.status[tid] = DONE
        mid = self.on_machine.pop(tid, None)
        self.started_at.pop(tid, None)
        self.finish_at.pop(tid, None)
        self.completion_order.append(tid)
        self._log(f"任务 {tid} 在 {mid} 上完成")

    # ---------- 失败与重试 ----------
    def _preempt(self, tid):
        """把任务从机器上撤下，已消耗的时间作废，任务回到等待态。"""
        self.on_machine.pop(tid, None)
        self.started_at.pop(tid, None)
        self.finish_at.pop(tid, None)

    def fail_task(self, tid):
        """标记任务失败：仅其传递下游变为受阻，其他任务照常推进。"""
        with self.lock:
            if self.status.get(tid) not in (RUNNING, WAITING):
                return False
            if self.status[tid] == RUNNING:
                self._preempt(tid)
            self.status[tid] = FAILED
            blocked = transitive_closure(tid, self.down)
            for d in blocked:
                if self.status[d] in (WAITING, BLOCKED):
                    self.status[d] = BLOCKED
            self._log(f"任务 {tid} 失败；下游受阻: "
                      + (", ".join(sorted(blocked)) or "无"))
            self._save_checkpoint()
            return True

    def retry_task(self, tid):
        """失败任务重新排队；受阻任务在失败前置恢复后自动解除阻塞。"""
        with self.lock:
            if self.status.get(tid) != FAILED:
                return False
            self.status[tid] = WAITING
            changed = True
            recovered = set()
            while changed:
                changed = False
                for d, s in list(self.status.items()):
                    if s != BLOCKED:
                        continue
                    if not any(self.status[p] == FAILED for p in self.deps[d]):
                        self.status[d] = WAITING
                        recovered.add(d)
                        changed = True
            self._log(f"任务 {tid} 重新排队；自动恢复: "
                      + (", ".join(sorted(recovered)) or "无"))
            self._save_checkpoint()
            return True

    # ---------- 机器暂停 ----------
    def pause_machine(self, mid):
        with self.lock:
            if mid not in self.machines or mid in self.machine_paused:
                return False
            self.machine_paused.add(mid)
            for tid, m in list(self.on_machine.items()):
                if m == mid:
                    self._preempt(tid)
                    self.status[tid] = WAITING
            self._log(f"机器 {mid} 已暂停，其上任务改派其他机器")
            self._save_checkpoint()
            return True

    def resume_machine(self, mid):
        with self.lock:
            if mid not in self.machine_paused:
                return False
            self.machine_paused.discard(mid)
            self._log(f"机器 {mid} 已恢复可用")
            self._save_checkpoint()
            return True

    # ---------- 素材替换 ----------
    def replace_material(self, mat_id, new_version=None):
        """素材中途替换：圈定已执行/执行中且取用该素材的任务，等待操作员裁决。"""
        with self.lock:
            if mat_id not in self.materials:
                return False
            mat = self.materials[mat_id]
            mat.version = new_version or mat.version + 1
            affected = [tid for tid, t in self.tasks.items()
                        if mat_id in t.uses and self.status[tid] in (RUNNING, DONE)]
            for tid in affected:
                if self.status[tid] == RUNNING:
                    self._preempt(tid)
                self.status[tid] = AFFECTED
                self.affected_by[tid] = mat_id
            self.material_pending[mat_id] = {"version": mat.version, "tasks": affected}
            self._log(f"素材 {mat_id} 被替换为 v{mat.version}；受影响任务: "
                      + (", ".join(affected) or "无"))
            self._save_checkpoint()
            return True

    def material_decision(self, mat_id, rerun):
        """操作员裁决：重跑受影响任务及其下游，或保留旧产出忽略本次替换。"""
        with self.lock:
            pending = self.material_pending.pop(mat_id, None)
            if pending is None:
                return False
            affected = pending["tasks"]
            if not rerun:
                for tid in affected:
                    self.status[tid] = DONE
                    if tid not in self.completion_order:
                        self.completion_order.append(tid)
                    self.affected_by.pop(tid, None)
                self._log(f"素材 {mat_id} 替换被忽略，保留 {len(affected)} 个任务的旧产出")
            else:
                reset = set(affected)
                for tid in affected:
                    reset |= transitive_closure(tid, self.down)
                # 只重置已执行过/受阻的节点；纯等待节点会自然使用新版本
                reset = {t for t in reset if self.status[t] in
                         (DONE, AFFECTED, RUNNING, BLOCKED)} | set(affected)
                for tid in reset:
                    self._preempt(tid)
                    self.status[tid] = WAITING
                    self.affected_by.pop(tid, None)
                self.completion_order = [t for t in self.completion_order
                                         if t not in reset]
                self.finished = False
                self._log(f"素材 {mat_id} 替换确认重跑，重置任务: "
                          + ", ".join(sorted(reset)))
            self._save_checkpoint()
            return True

    # ---------- 日志 ----------
    def _log(self, msg):
        self.log.append(f"[t={self.now:>4}] {msg}")
        self.log[:] = self.log[-200:]

    # ---------- 状态快照 ----------
    def snapshot(self):
        with self.lock:
            tasks = []
            for tid, t in self.tasks.items():
                s = self.status[tid]
                progress = 0
                if s == DONE:
                    progress = 100
                elif s == RUNNING:
                    elapsed = self.now - self.started_at[tid]
                    progress = round(100 * elapsed / t.duration)
                tasks.append({
                    "id": tid, "name": t.name, "duration": t.duration,
                    "uses": t.uses, "produces": t.produces,
                    "deps": sorted(self.deps[tid]),
                    "machine_type": t.machine_type,
                    "status": s, "machine": self.on_machine.get(tid),
                    "finish_at": self.finish_at.get(tid), "progress": progress,
                    "affected_by": self.affected_by.get(tid),
                })
            busy = {m: t for t, m in self.on_machine.items()}
            machines = []
            for mid, m in self.machines.items():
                machines.append({
                    "id": mid, "name": m.name, "type": m.type,
                    "paused": mid in self.machine_paused,
                    "in_window": any(a <= self.now < b for a, b in m.windows),
                    "running": busy.get(mid),
                    "windows": [list(w) for w in m.windows],
                })
            return {
                "now": self.now, "finished": self.finished,
                "tasks": tasks, "machines": machines,
                "materials": [{"id": k, "name": v.name, "version": v.version,
                               "pending": k in self.material_pending,
                               "affected": self.material_pending.get(k, {}).get("tasks", [])}
                              for k, v in self.materials.items()],
                "completion_order": list(self.completion_order),
                "log": list(reversed(self.log[:80])),
            }

    # ---------- 检查点 ----------
    def _save_checkpoint(self):
        if not self.checkpoint_path:
            return
        data = {
            "now": self.now, "status": self.status,
            "on_machine": self.on_machine, "started_at": self.started_at,
            "finish_at": self.finish_at,
            "completion_order": self.completion_order,
            "machine_paused": sorted(self.machine_paused),
            "material_versions": {k: v.version for k, v in self.materials.items()},
            "material_pending": self.material_pending,
            "affected_by": self.affected_by, "log": self.log,
            "finished": self.finished,
        }
        tmp = self.checkpoint_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, self.checkpoint_path)

    def _load_checkpoint(self):
        try:
            with open(self.checkpoint_path, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, json.JSONDecodeError):
            return
        self.now = d.get("now", 0)
        self.status.update(d.get("status", {}))
        self.on_machine = d.get("on_machine", {})
        self.started_at = d.get("started_at", {})
        self.finish_at = d.get("finish_at", {})
        self.completion_order = d.get("completion_order", [])
        self.machine_paused = set(d.get("machine_paused", []))
        for k, v in d.get("material_versions", {}).items():
            if k in self.materials:
                self.materials[k].version = v
        self.material_pending = d.get("material_pending", {})
        self.affected_by = d.get("affected_by", {})
        self.log = d.get("log", [])
        self.finished = d.get("finished", False)
        self._log("从检查点恢复队列状态")
