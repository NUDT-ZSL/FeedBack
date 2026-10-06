import { useWorkshop } from "../store.js";

const statusTag = (s: string) => {
  if (s === "ready") return <span className="tag ready">可执行</span>;
  if (s === "blocked") return <span className="tag blocked">受阻</span>;
  return <span className="tag skipped">不参与</span>;
};

export function InferenceStep() {
  const { cfg, result, rerunFull, impacts } = useWorkshop();
  const stepName = (id: string) => cfg.steps.find((s) => s.id === id)?.name ?? id;
  const matName = (id: string) => cfg.materials.find((m) => m.id === id)?.name ?? id;
  const sandName = (id: string) => cfg.sands.find((s) => s.id === id)?.name ?? id;

  return (
    <>
      <section className="panel">
        <h2>推演 · 可执行顺序</h2>
        <div className="btn-row">
          <button className="btn" onClick={rerunFull}>整体从头重推</button>
          <span className="muted">
            最近一次：{result.meta.mode === "full" ? "全量重推" : "增量重推"}，
            复用 {result.meta.reused} 道、重算 {result.meta.recomputed} 道
          </span>
        </div>
        <h3>可执行链</h3>
        <div className="order-chain">
          {result.order.length === 0 && <span className="muted">暂无可执行工序</span>}
          {result.order.map((id, i) => (
            <span key={id} style={{ display: "contents" }}>
              <span className="node">{i + 1}. {stepName(id)}</span>
              {i < result.order.length - 1 && <span className="arrow">→</span>}
            </span>
          ))}
        </div>

        {impacts.length > 0 && (
          <>
            <h3>本次配比/属性调整的跨工序影响（相对上一轮）</h3>
            <table>
              <thead><tr><th>解玉砂</th><th>波及工序</th><th>砂耗合计 Δ(斤)</th><th>玉损合计 Δ</th></tr></thead>
              <tbody>
                {impacts.map((im) => (
                  <tr key={im.sandId}>
                    <td>{im.sandName}</td>
                    <td>{im.affectedStepIds.map(stepName).join("、")}</td>
                    <td>{im.sandDelta > 0 ? "+" : ""}{im.sandDelta}</td>
                    <td>{im.jadeLossDelta > 0 ? "+" : ""}{im.jadeLossDelta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="panel">
        <h2>工序结算</h2>
        <table>
          <thead>
            <tr><th>工序</th><th>状态</th><th>砂耗</th><th>玉料损耗</th><th>结算后砂库存</th><th>结算后玉料余量</th><th>原因</th></tr>
          </thead>
          <tbody>
            {cfg.steps.map((s) => {
              const o = result.outcomes[s.id];
              if (!o) return null;
              return (
                <tr key={s.id} className={o.status === "ready" ? "ready-row" : o.status === "blocked" ? "blocked-row" : ""}>
                  <td>{s.name} <span className="muted">({s.id})</span></td>
                  <td>{statusTag(o.status)}{o.order >= 0 && <span className="muted"> #{o.order + 1}</span>}</td>
                  <td>{o.sandUsed} {s.sandId ? <span className="muted">({sandName(s.sandId)})</span> : null}</td>
                  <td>{o.jadeLoss} <span className="muted">({matName(s.materialId)})</span></td>
                  <td>{o.sandAfter ?? "—"}</td>
                  <td>{o.materialAfter ?? "—"}</td>
                  <td className="muted">{o.reasons.join("；") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
