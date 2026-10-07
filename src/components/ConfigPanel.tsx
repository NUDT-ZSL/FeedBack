import { useSimStore } from "@/store/simStore";
import { SimConfig, TierConfig, TierActionType, UNKNOWN_SOURCE } from "@/engine";
import type { TierAction } from "@/engine";

const ACTIONS: { value: TierActionType; label: string }[] = [
  { value: "drop", label: "丢弃" },
  { value: "downsample", label: "降采样" },
  { value: "expandBuffer", label: "缓冲扩容" },
  { value: "pauseSource", label: "暂停来源" },
];

let tierSeq = 100;

export default function ConfigPanel() {
  const config = useSimStore((s) => s.config);
  const setConfig = useSimStore((s) => s.setConfig);
  const adjudications = useSimStore((s) => s.adjudications);
  const adjudicate = useSimStore((s) => s.adjudicate);
  const output = useSimStore((s) => s.output);

  const patch = (next: SimConfig) => setConfig(next);

  const updateTier = (id: string, p: Partial<TierConfig>) => {
    patch({ ...config, tiers: config.tiers.map((t) => (t.id === id ? { ...t, ...p } : t)) });
  };
  const updateAction = (id: string, p: Partial<TierConfig["action"]>) => {
    const tier = config.tiers.find((t) => t.id === id)!;
    updateTier(id, { action: { ...tier.action, ...p } as TierAction });
  };
  const removeTier = (id: string) =>
    patch({ ...config, tiers: config.tiers.filter((t) => t.id !== id) });
  const addTier = () =>
    patch({
      ...config,
      tiers: [
        ...config.tiers,
        {
          id: `tier-${tierSeq++}`,
          label: "新档位",
          threshold: 5,
          consumeRate: config.baseConsumeRate,
          action: { type: "drop" },
        },
      ],
    });

  // 从配置问题中提取待裁决冲突
  const overlaps = (output?.configIssues ?? []).filter(
    (i) => i.code === "TIER_OVERLAP" && i.blocking,
  );
  const cycles = (output?.configIssues ?? []).filter(
    (i) => i.code === "TIER_CYCLE" && i.blocking,
  );
  const knownSources = new Set<string>();
  output?.events.forEach((e) => {
    if (e.sourceId !== UNKNOWN_SOURCE) knownSources.add(e.sourceId);
  });

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-zinc-400">
          基础消费速率（事件/秒）
          <input
            type="number" min={0} step={0.5}
            value={config.baseConsumeRate}
            onChange={(e) => patch({ ...config, baseConsumeRate: Number(e.target.value) })}
            className="w-full mt-0.5 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-100"
          />
        </label>
        <label className="text-xs text-zinc-400">
          基础缓冲容量（空=无限）
          <input
            type="number" min={0} step={1}
            value={config.baseCapacity ?? ""}
            placeholder="∞"
            onChange={(e) =>
              patch({ ...config, baseCapacity: e.target.value === "" ? undefined : Number(e.target.value) })
            }
            className="w-full mt-0.5 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-100"
          />
        </label>
      </div>

      {(overlaps.length > 0 || cycles.length > 0) && (
        <div className="rounded border border-amber-700 bg-amber-950/30 p-2 space-y-2">
          <div className="text-amber-300 text-xs font-semibold">需要人工裁决的档位冲突</div>
          {overlaps.map((o, i) => (
            <div key={i} className="text-xs space-y-1">
              <div>
                阈值 {o.tierIds.length > 0 ? config.tiers.find((t) => t.id === o.tierIds[0])?.threshold : ""}{" "}
                被 {o.tierIds.join("、")} 共用，请选择唯一生效档位：
              </div>
              <div className="flex gap-1 flex-wrap">
                {o.tierIds.map((id) => (
                  <button
                    key={id}
                    onClick={() =>
                      adjudicate({
                        id: `adj-${Date.now()}-${i}`,
                        kind: "overlap",
                        anchor: config.tiers.find((t) => t.id === id)!.threshold,
                        chosenTierId: id,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white"
                  >
                    选 {id}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {cycles.map((c, i) => (
            <div key={i} className="text-xs space-y-1">
              <div>升级链成环（{c.tierIds.join(" → ")} → 回到起点），请选择断点档位：</div>
              <div className="flex gap-1 flex-wrap">
                {c.tierIds.map((id) => (
                  <button
                    key={id}
                    onClick={() =>
                      adjudicate({
                        id: `adj-cycle-${Date.now()}-${i}`,
                        kind: "cycle",
                        anchor: id,
                        chosenTierId: id,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-fuchsia-700 hover:bg-fuchsia-600 text-white"
                  >
                    在 {id} 断开
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {config.tiers.map((tier) => {
          const alreadyChosen = adjudications.some(
            (a) => a.kind === "overlap" &&
              a.anchor === tier.threshold &&
              a.chosenTierId === tier.id,
          );
          return (
            <div key={tier.id} className="rounded border border-zinc-700 bg-zinc-900/60 p-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={tier.id}
                  onChange={(e) => {
                    const nid = e.target.value;
                    patch({
                      ...config,
                      tiers: config.tiers.map((t) =>
                        t.id === tier.id ? { ...t, id: nid } : { ...t, escalateTo: t.escalateTo === tier.id ? nid : t.escalateTo },
                      ),
                    });
                  }}
                  className="w-24 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-xs font-mono text-zinc-100"
                />
                <input
                  value={tier.label ?? ""}
                  placeholder="标签"
                  onChange={(e) => updateTier(tier.id, { label: e.target.value })}
                  className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-100"
                />
                {alreadyChosen && <span className="text-[10px] text-amber-300">裁决生效</span>}
                <button onClick={() => removeTier(tier.id)} className="text-zinc-500 hover:text-red-400 text-xs">✕</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="text-[10px] text-zinc-400">
                  进入阈值
                  <input type="number" min={0} value={tier.threshold}
                    onChange={(e) => updateTier(tier.id, { threshold: Number(e.target.value) })}
                    className="w-full rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-zinc-100" />
                </label>
                <label className="text-[10px] text-zinc-400">
                  释放线
                  <input type="number" min={0} placeholder="=阈值" value={tier.releaseBelow ?? ""}
                    onChange={(e) => updateTier(tier.id, { releaseBelow: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className="w-full rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-zinc-100" />
                </label>
                <label className="text-[10px] text-zinc-400">
                  消费速率
                  <input type="number" min={0} step={0.5} value={tier.consumeRate}
                    onChange={(e) => updateTier(tier.id, { consumeRate: Number(e.target.value) })}
                    className="w-full rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-zinc-100" />
                </label>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={tier.action.type}
                  onChange={(e) => {
                    const type = e.target.value as TierActionType;
                    const base = { type };
                    const action =
                      type === "downsample" ? { ...base, keepRatio: 0.5 }
                      : type === "expandBuffer" ? { ...base, capacity: 10 }
                      : type === "pauseSource" ? { ...base, sources: [...knownSources].slice(0, 1) }
                      : base;
                    updateTier(tier.id, { action });
                  }}
                  className="rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-100"
                >
                  {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
                {tier.action.type === "downsample" && (
                  <label className="text-[10px] text-zinc-400 flex items-center gap-1">
                    保留比例
                    <input type="number" min={0.01} max={1} step={0.05} value={tier.action.keepRatio ?? 0.5}
                      onChange={(e) => updateAction(tier.id, { keepRatio: Number(e.target.value) })}
                      className="w-16 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-zinc-100" />
                  </label>
                )}
                {tier.action.type === "expandBuffer" && (
                  <label className="text-[10px] text-zinc-400 flex items-center gap-1">
                    容量
                    <input type="number" min={0} value={tier.action.capacity ?? 0}
                      onChange={(e) => updateAction(tier.id, { capacity: Number(e.target.value) })}
                      className="w-16 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-zinc-100" />
                  </label>
                )}
                {tier.action.type === "pauseSource" && (
                  <label className="text-[10px] text-zinc-400 flex items-center gap-1">
                    来源（空=全部）
                    <input
                      value={(tier.action.sources ?? []).join(",")}
                      placeholder="全部来源"
                      onChange={(e) =>
                        updateAction(tier.id, {
                          sources: e.target.value === "" ? undefined : e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        })
                      }
                      className="w-32 rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 text-zinc-100"
                    />
                  </label>
                )}
                <label className="text-[10px] text-zinc-400 flex items-center gap-1 ml-auto">
                  升级目标
                  <select
                    value={tier.escalateTo ?? ""}
                    onChange={(e) => updateTier(tier.id, { escalateTo: e.target.value || undefined })}
                    className="rounded bg-zinc-800 border border-zinc-700 px-1 py-0.5 text-zinc-100"
                  >
                    <option value="">默认升序</option>
                    {config.tiers.filter((t) => t.id !== tier.id).map((t) => (
                      <option key={t.id} value={t.id}>{t.id}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={addTier} className="px-2 py-1 text-xs rounded border border-dashed border-zinc-600 text-zinc-300 hover:border-zinc-400 w-full">
        + 新增档位
      </button>
      {adjudications.length > 0 && (
        <div className="text-[10px] text-zinc-500">
          已应用裁决 {adjudications.length} 条：{adjudications.map((a) => a.id).join(", ")}
        </div>
      )}
    </div>
  );
}
