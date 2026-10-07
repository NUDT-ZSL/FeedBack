/** store 接线冒烟测试（Node）：导入→推演→增量重推→裁决→批量。 */
import { useSimStore } from "../src/store/simStore";
import { generateSample } from "../src/lib/sample";

const s = useSimStore.getState;
const { events, config } = generateSample(7);
s().loadEvents(events);
s().setConfig(config);
const out0 = s().output;
if (!out0) throw new Error("初始推演失败: " + s().blockingIssues.join(";"));
console.log("初始推演:", JSON.stringify(out0.stats));
if (out0.switches.length === 0) throw new Error("示例应产生档位切换");

s().applyChange({ kind: "sourceRate", sourceId: "web", factor: 1.5 });
const log1 = s().changeLog.at(-1)!;
console.log("增量重推1:", log1.name, "ok=", log1.ok, "快照复用=", log1.resumedFromSnapshot);
if (!log1.ok) throw new Error("增量重推不一致: " + log1.failures.join(";"));

const t0 = s().config.tiers[0];
s().applyChange({ kind: "tierThreshold", tierId: t0.id, threshold: 2 });
const log2 = s().changeLog.at(-1)!;
console.log("增量重推2:", log2.name, "ok=", log2.ok);
if (!log2.ok) throw new Error("阈值变更不一致: " + log2.failures.join(";"));

// 制造重叠 → 阻塞 → 裁决 → 恢复
const cfg = s().config;
s().setConfig({
  ...cfg,
  tiers: [...cfg.tiers, { id: "dup", threshold: 2, consumeRate: 1, action: { type: "drop" } }],
});
if (s().output !== null && s().blockingIssues.length === 0) {
  throw new Error("重叠阈值应阻塞推演");
}
console.log("重叠阻塞:", s().blockingIssues.length, "条");
s().adjudicate({ id: "adj-ui-1", kind: "overlap", anchor: 2, chosenTierId: "dup" });
if (!s().output) throw new Error("裁决后应恢复推演");
console.log("裁决后恢复, 切换数:", s().output.switches.length);
console.log("SMOKE OK");
