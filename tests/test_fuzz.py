"""确定性模糊测试（多组固定种子）。

在随机操作序列上，每个动作之后都验证：
  1. 每条链路在途字节不超过带宽上限；
  2. 会话不会承载在当前有效状态为不可用的链路上（搁浅会话承载为 None）；
  3. 增量编排状态 == 事件日志从头重放；
  4. 周期性保存/载入后状态完全一致；
  5. 迁移链连续（每条记录的 from 等于该会话上一条的 to）。
"""

import os
import random
import tempfile
import unittest

import link_orchestrator as lo
from link_orchestrator.errors import OrchestratorError
from link_orchestrator.persistence import save_state, load_state

CLASSES = ["control", "telemetry", "bulk"]


class FuzzInvariants(unittest.TestCase):
    def _run_seed(self, seed: int, n_ops: int):
        rnd = random.Random(seed)
        o = lo.LinkOrchestrator(list(CLASSES))
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, f"fuzz-{seed}.json")
        next_time = {}   # link_id -> 该链路下一个可用时刻（非递减）

        def new_link_id():
            return f"L{len(o.links)}"

        # 初始链路
        for i in range(rnd.randint(1, 4)):
            lid = new_link_id()
            o.add_link(lid, rnd.randint(0, 3), rnd.randint(50, 800))
            next_time[lid] = 0

        def invariants():
            # 1) 容量
            for lid in o.links:
                self.assertLessEqual(o.link_inflight(lid), o.links[lid].bandwidth,
                                     f"seed={seed} 链路 {lid} 超载")
            # 2) 承载可用性
            for sid, s in o.sessions.items():
                if s.current_link is not None:
                    self.assertIn(s.current_link, o.links)
                    self.assertTrue(
                        o.effective_status(s.current_link),
                        f"seed={seed} 会话 {sid} 落在失效链路 {s.current_link}")
            # 3) 增量 == 重放
            o.verify_consistency()
            # 5) 迁移链连续
            last_to = {}
            for m in o.migrations:
                if m.session_id in last_to:
                    self.assertEqual(m.from_link, last_to[m.session_id],
                                     f"seed={seed} 迁移链断裂于 {m}")
                last_to[m.session_id] = m.to_link

        for step in range(n_ops):
            action = rnd.random()
            try:
                if action < 0.15 and len(o.links) < 6:
                    lid = new_link_id()
                    o.add_link(lid, rnd.randint(0, 4), rnd.randint(50, 800))
                    next_time[lid] = 0
                elif action < 0.45 and len(o.sessions) < 12:
                    sid = f"S{len(o.sessions)}"
                    o.add_session(sid, rnd.choice(CLASSES), rnd.randint(10, 500))
                elif action < 0.75 and o.links:
                    lid = rnd.choice(list(o.links))
                    # 一半概率推进时刻，一半停在同时刻（制造冲突/幂等）
                    if rnd.random() < 0.5:
                        next_time[lid] += rnd.randint(0, 2)
                    t = next_time[lid]
                    o.report_health(lid, t, rnd.random() < 0.5,
                                    rnd.choice(["probe-a", "probe-b", "agent-x"]))
                elif action < 0.9 and o.sessions and o.links:
                    sid = rnd.choice(list(o.sessions))
                    o.migrate(sid, rnd.choice(list(o.links)))
                elif o.sessions:
                    sid = rnd.choice(list(o.sessions))
                    o.grow_bytes(sid, rnd.randint(1, 120))
            except OrchestratorError:
                pass  # 容量不足、目标失效、时刻倒退等拒绝都是预期行为

            invariants()

            if step % 75 == 74:
                save_state(path, o)
                loaded = load_state(path)
                self.assertEqual(loaded._state_signature(), o._state_signature(),
                                 f"seed={seed} step={step} 持久化往返不一致")
                loaded.verify_consistency()

    def test_seeds(self):
        for seed in range(12):
            with self.subTest(seed=seed):
                self._run_seed(1000 + seed, 300)


if __name__ == "__main__":
    unittest.main(verbosity=2)
