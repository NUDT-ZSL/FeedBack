import { OrchestrationStore } from "./store.ts";
import { scheduleSession } from "./schedule.ts";
import { deepEqual, consistencyChecks } from "./batch.ts";
import type { SessionSpec } from "./types.ts";

interface TestCase {
  name: string;
  run: () => string | null;
}

function baseSpec(id: string, overrides: Partial<SessionSpec> = {}): SessionSpec {
  return {
    id,
    name: id,
    participantIds: [],
    resourceIds: [],
    slots: [],
    ...overrides,
  };
}

function seedStore(): OrchestrationStore {
  const store = new OrchestrationStore();
  store.upsertParticipant({ id: "p1", name: "甲", grade: 1 });
  store.upsertParticipant({ id: "p2", name: "乙", grade: 3 });
  store.upsertParticipant({ id: "p3", name: "丙", grade: 6 });
  store.upsertResource({ id: "r1", name: "玉杯", minGrade: 1 });
  store.upsertResource({ id: "r2", name: "银箸", minGrade: 3 });
  store.upsertResource({ id: "r3", name: "瓷碗", minGrade: 8 });
  return store;
}

const tests: TestCase[] = [
  {
    name: "多场次结果与单场独立编排一致",
    run: () => {
      const store = seedStore();
      const specA = baseSpec("A", {
        participantIds: ["p1", "p2"],
        resourceIds: ["r1", "r2"],
        slots: [{ id: "s1", startsAt: 0, endsAt: 10 }, { id: "s2", startsAt: 10, endsAt: 20 }],
      });
      const specB = baseSpec("B", {
        participantIds: ["p2", "p3"],
        resourceIds: ["r3"],
        slots: [{ id: "t1", startsAt: 5, endsAt: 15 }, { id: "t2", startsAt: 15, endsAt: 25 }],
      });
      store.addSession(specA);
      store.addSession(specB);
      store.sync();
      const pools = store.getPools();
      for (const spec of [specA, specB]) {
        if (!deepEqual(store.getResult(spec.id), scheduleSession(spec, pools))) {
          return `场次 ${spec.id} 与单场编排结果不一致`;
        }
      }
      return null;
    },
  },
  {
    name: "移除参与者仅重推引用它的场次且不留失效引用",
    run: () => {
      const store = seedStore();
      store.addSession(baseSpec("A", {
        participantIds: ["p1", "p2"],
        resourceIds: ["r1", "r2"],
        slots: [{ id: "s1", startsAt: 0, endsAt: 10 }, { id: "s2", startsAt: 10, endsAt: 20 }],
      }));
      store.addSession(baseSpec("B", {
        participantIds: ["p3"],
        resourceIds: ["r3"],
        slots: [{ id: "t1", startsAt: 0, endsAt: 10 }],
      }));
      store.sync();
      const beforeB = store.getResult("B");
      store.removeParticipant("p1");
      const rederived = store.sync();
      if (rederived.join(",") !== "A") {
        return `应只重推 A，实际重推 ${rederived.join(",")}`;
      }
      if (store.getResult("B") !== beforeB) {
        return "未受影响的 B 结果被重新计算";
      }
      const resultA = store.getResult("A");
      if (resultA && resultA.allocations.some((a) => a.participantId === "p1")) {
        return "A 仍保留已移除参与者的分配";
      }
      if (!resultA || !resultA.conflicts.some((c) => c.type === "missing-participant")) {
        return "A 缺少 missing-participant 冲突记录";
      }
      return null;
    },
  },
  {
    name: "修改资源属性后引用场次正确重推",
    run: () => {
      const store = seedStore();
      store.addSession(baseSpec("A", {
        participantIds: ["p2"],
        resourceIds: ["r2"],
        slots: [{ id: "s1", startsAt: 0, endsAt: 10 }],
      }));
      store.sync();
      const before = store.getResult("A");
      if (!before || before.allocations.length !== 1) {
        return "前置条件失败：A 应有一条分配";
      }
      store.upsertResource({ id: "r2", name: "银箸", minGrade: 2 });
      const rederived = store.sync();
      if (rederived.join(",") !== "A") {
        return `应只重推 A，实际重推 ${rederived.join(",")}`;
      }
      const after = store.getResult("A");
      if (!after || after.allocations.length !== 0) {
        return "提高资源品级门槛后，A 的分配应被移除";
      }
      if (!after.conflicts.some((c) => c.type === "grade-mismatch")) {
        return "A 缺少 grade-mismatch 冲突记录";
      }
      return null;
    },
  },
  {
    name: "跨场次资源争用按场次归属分别呈现",
    run: () => {
      const store = seedStore();
      store.addSession(baseSpec("A", {
        participantIds: ["p1"],
        resourceIds: ["r1"],
        slots: [{ id: "s1", startsAt: 0, endsAt: 10 }],
      }));
      store.addSession(baseSpec("B", {
        participantIds: ["p1"],
        resourceIds: ["r1"],
        slots: [{ id: "t1", startsAt: 5, endsAt: 15 }],
      }));
      store.sync();
      const conflictsA = store.getConflicts("A").filter((c) => c.type === "resource-contention");
      const conflictsB = store.getConflicts("B").filter((c) => c.type === "resource-contention");
      if (conflictsA.length !== 1 || conflictsA[0].otherSessionId !== "B") {
        return "A 的争用冲突归属错误";
      }
      if (conflictsB.length !== 1 || conflictsB[0].otherSessionId !== "A") {
        return "B 的争用冲突归属错误";
      }
      if (conflictsA[0] === conflictsB[0]) {
        return "两场次的争用冲突不应是同一条记录";
      }
      return null;
    },
  },
  {
    name: "切换场次不触发任何重推",
    run: () => {
      const store = seedStore();
      store.addSession(baseSpec("A", { participantIds: ["p1"], resourceIds: ["r1"], slots: [{ id: "s1", startsAt: 0, endsAt: 10 }] }));
      store.addSession(baseSpec("B", { participantIds: ["p2"], resourceIds: ["r2"], slots: [{ id: "t1", startsAt: 0, endsAt: 10 }] }));
      store.sync();
      const beforeA = store.getResult("A");
      const beforeB = store.getResult("B");
      if (!store.setActiveSession("B")) {
        return "切换到存在的场次应成功";
      }
      const rederived = store.sync();
      if (rederived.length !== 0) {
        return `切换场次不应触发重推，实际重推 ${rederived.join(",")}`;
      }
      if (store.getResult("A") !== beforeA || store.getResult("B") !== beforeB) {
        return "切换场次后结果被重新计算";
      }
      if (store.setActiveSession("ghost")) {
        return "切换到不存在的场次应失败";
      }
      if (store.getActiveSessionId() !== "B") {
        return "非法切换不应改变当前场次";
      }
      return null;
    },
  },
  {
    name: "空场次与单资源场次边界稳定",
    run: () => {
      const store = seedStore();
      store.addSession(baseSpec("empty"));
      store.addSession(baseSpec("single", {
        participantIds: ["p1", "p2"],
        resourceIds: ["r3"],
        slots: [{ id: "s1", startsAt: 0, endsAt: 10 }, { id: "s2", startsAt: 20, endsAt: 30 }],
      }));
      store.sync();
      const empty = store.getResult("empty");
      if (!empty || empty.allocations.length !== 0 || empty.conflicts.length !== 0) {
        return "空场次应产出空结果且不报错";
      }
      const single = store.getResult("single");
      if (!single || single.allocations.length !== 2) {
        return "单资源场次在不相交时段应复用同一资源";
      }
      if (single.allocations[0].resourceId !== "r3" || single.allocations[1].resourceId !== "r3") {
        return "单资源场次资源引用错误";
      }
      return null;
    },
  },
  {
    name: "场次增删边界稳定",
    run: () => {
      const store = seedStore();
      store.addSession(baseSpec("A"));
      store.addSession(baseSpec("B"));
      if (store.getActiveSessionId() !== "A") {
        return "首个场次应成为当前场次";
      }
      if (!store.removeSession("A") || store.getActiveSessionId() !== "B") {
        return "删除当前场次后应回退到剩余场次";
      }
      if (!store.removeSession("B") || store.getActiveSessionId() !== null) {
        return "删除全部场次后当前场次应为空";
      }
      if (store.removeSession("ghost")) {
        return "删除不存在的场次应返回 false";
      }
      if (store.getActiveResult() !== null) {
        return "无场次时活动结果应为 null";
      }
      let threw = false;
      try {
        store.addSession(baseSpec("A"));
        store.addSession(baseSpec("A"));
      } catch {
        threw = true;
      }
      if (!threw) {
        return "重复场次 id 应抛出错误";
      }
      return null;
    },
  },
  {
    name: "同输入重复编排结果确定一致",
    run: () => {
      const spec = baseSpec("A", {
        participantIds: ["p1", "p2", "p3"],
        resourceIds: ["r1", "r2", "r3"],
        slots: [
          { id: "s1", startsAt: 0, endsAt: 10 },
          { id: "s2", startsAt: 10, endsAt: 20 },
          { id: "s3", startsAt: 20, endsAt: 30 },
        ],
      });
      const run = () => {
        const store = seedStore();
        store.addSession(spec);
        store.sync();
        return store.getResult("A");
      };
      if (!deepEqual(run(), run())) {
        return "同一份输入两次编排结果不一致";
      }
      return null;
    },
  },
];

export function runSelfTests(): { name: string; ok: boolean; detail?: string }[] {
  return tests.map((test) => {
    try {
      const detail = test.run();
      return { name: test.name, ok: detail === null, detail: detail ?? undefined };
    } catch (error) {
      return { name: test.name, ok: false, detail: String(error) };
    }
  });
}

export { consistencyChecks };
