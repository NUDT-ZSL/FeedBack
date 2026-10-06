import { useWorkshop } from "../store.js";

export function ConclusionStep() {
  const { cfg, result, batchReport, runBatch, resetSample } = useWorkshop();
  const p = result.product;
  const matName = (id: string) => cfg.materials.find((m) => m.id === id)?.name ?? id;
  const sandName = (id: string) => cfg.sands.find((s) => s.id === id)?.name ?? id;

  return (
    <>
      <section className="panel">
        <h2>成品产出结论</h2>
        <div className={p.completable ? "banner-ok" : "banner-bad"}>
          <b>{p.productName}</b> —— {p.completable ? "可完成" : "不可完成（存在未裁决冲突）"}
        </div>
        <div className="kv" style={{ marginTop: 12 }}>
          <div>执行工序：<b>{p.executedSteps} / {p.totalSteps}</b></div>
          <div>累计耗时：<b>{p.totalDuration} 刻</b></div>
          <div>末工序玉料：<b>{p.endingMaterialId ? matName(p.endingMaterialId) : "—"}</b></div>
          <div>末料余量：<b>{p.endingMaterialRemaining ?? "—"}</b></div>
        </div>
        <p>{p.summary}</p>
      </section>

      <section className="panel">
        <h2>玉料与砂的消耗分布</h2>
        <table>
          <thead><tr><th>#</th><th>工序</th><th>资源</th><th>结算前</th><th>消耗</th><th>结算后</th></tr></thead>
          <tbody>
            {result.consumption.map((row, i) => (
              <tr key={i}>
                <td>{row.order + 1}</td>
                <td>{row.stepName}</td>
                <td>{row.resource}（{row.resourceKind === "jade" ? "玉料" : "解玉砂"}）</td>
                <td>{row.before}</td>
                <td>{row.used}</td>
                <td>{row.after}</td>
              </tr>
            ))}
            {result.consumption.length === 0 && <tr><td colSpan={6} className="muted">暂无消耗记录</td></tr>}
          </tbody>
        </table>
        <h3>资源终值</h3>
        <div className="kv">
          {Object.entries(result.materialFinal).map(([id, v]) => (
            <div key={id}>{matName(id)} 余量：<b>{v}</b></div>
          ))}
          {Object.entries(result.sandFinal).map(([id, v]) => (
            <div key={id}>{sandName(id)} 库存：<b>{v} 斤</b></div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>批量推演校验（固定样例 · 离线可复算）</h2>
        <p className="muted">
          对固定样例依次执行「配比调整 + 五类裁决」，每一步同时做增量重推与整体从头重推并断言结论一致。
          命令行入口：<code>npm run infer</code>
        </p>
        <div className="btn-row">
          <button className="btn" onClick={runBatch}>运行批量推演校验</button>
          <button className="btn ghost" onClick={resetSample}>重置为固定样例</button>
        </div>
        {batchReport && (
          <>
            <h3 className={batchReport.consistent ? "" : ""}>
              {batchReport.consistent ? "✓ 全部步骤：增量与全量结论一致" : "✗ 存在不一致步骤"}
            </h3>
            <table>
              <thead><tr><th>步骤</th><th>一致</th><th>冲突</th><th>执行</th><th>受阻</th><th>复用</th><th>重算</th></tr></thead>
              <tbody>
                {batchReport.steps.map((s, i) => (
                  <tr key={i}>
                    <td>{s.label}</td>
                    <td>{s.consistent ? "✓" : "✗"}</td>
                    <td>{s.conflicts}</td>
                    <td>{s.executed}</td>
                    <td>{s.blocked}</td>
                    <td>{s.reused}</td>
                    <td>{s.recomputed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>批量终局：{batchReport.finalResult.product.productName}（{batchReport.finalResult.product.completable ? "可完成" : "不可完成"}）</h3>
          </>
        )}
      </section>
    </>
  );
}
