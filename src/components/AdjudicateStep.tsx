import { adjudicationOptions } from "../engine/adjudicate.js";
import { useWorkshop } from "../store.js";

const kindLabel: Record<string, string> = {
  cycle: "依赖成环",
  "missing-ref": "引用缺失",
  "material-shortage": "玉料余量不足",
  "sand-shortage": "砂库存不足",
  "sand-not-applicable": "砂不适用",
};

export function AdjudicateStep() {
  const { cfg, result, adjudications, resolveConflict } = useWorkshop();
  const stepName = (id: string) => cfg.steps.find((s) => s.id === id)?.name ?? id;

  return (
    <>
      <section className="panel">
        <h2>裁决 · 待决冲突（{result.conflicts.length}）</h2>
        {result.conflicts.length === 0 && (
          <div className="banner-ok">当前无冲突，全部工序可顺次执行。可至「查看结论」验收成品产出。</div>
        )}
        {result.conflicts.map((c) => {
          const options = adjudicationOptions(cfg, c);
          return (
            <div className="conflict-card" key={c.id}>
              <h4>
                <span className="tag conflict">{kindLabel[c.kind] ?? c.kind}</span>
                {c.message}
              </h4>
              <div className="parties">
                冲突各方（全部保留，不静默择一）：
                {c.partyIds.map((id) => (
                  <span className="tag blocked" key={id}>{stepName(id)}({id})</span>
                ))}
              </div>
              <div className="options">
                {options.map((o) => (
                  <button key={o.action} className="btn small" onClick={() => resolveConflict(c.id, o.action)}>
                    {o.label}
                  </button>
                ))}
                {options.length === 0 && <span className="muted">请回「录入 / 配置」手工修正对应条目</span>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="panel">
        <h2>裁决记录（{adjudications.length}）</h2>
        {adjudications.length === 0 && <p className="muted">尚无裁决。每次裁决后仅重推受影响工序，结论与整体重推一致。</p>}
        <ol className="log-list">
          {adjudications.map((a) => (
            <li key={a.id}>[{a.conflictId}] {a.label}</li>
          ))}
        </ol>
      </section>
    </>
  );
}
