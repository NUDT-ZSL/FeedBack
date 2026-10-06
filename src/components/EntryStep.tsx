import { useWorkshop } from "../store.js";

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function EntryStep() {
  const { cfg, change, addMaterial, addSand } = useWorkshop();
  return (
    <>
      <section className="panel">
        <h2>玉料录入</h2>
        <table>
          <thead>
            <tr>
              <th>标记</th><th>名称</th><th>硬度</th><th>尺寸(cm)</th><th>余量</th><th>来源标记</th>
            </tr>
          </thead>
          <tbody>
            {cfg.materials.map((m) => (
              <tr key={m.id}>
                <td className="muted">{m.id}</td>
                <td><input value={m.name} onChange={(e) => change([{ kind: "material", id: m.id, patch: { name: e.target.value } }])} /></td>
                <td><input type="number" step="0.1" value={m.hardness} onChange={(e) => { const v = num(e.target.value); if (v !== null) change([{ kind: "material", id: m.id, patch: { hardness: v } }]); }} /></td>
                <td><input type="number" step="0.5" value={m.sizeCm} onChange={(e) => { const v = num(e.target.value); if (v !== null) change([{ kind: "material", id: m.id, patch: { sizeCm: v } }]); }} /></td>
                <td><input type="number" step="0.5" value={m.remaining} onChange={(e) => { const v = num(e.target.value); if (v !== null) change([{ kind: "material", id: m.id, patch: { remaining: v } }]); }} /></td>
                <td><input value={m.source} onChange={(e) => change([{ kind: "material", id: m.id, patch: { source: e.target.value } }])} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="btn-row"><button className="btn ghost small" onClick={addMaterial}>＋ 添加玉料</button></div>
      </section>

      <section className="panel">
        <h2>解玉砂录入</h2>
        <table>
          <thead>
            <tr>
              <th>标记</th><th>名称</th><th>粒度(目)</th><th>配比(砂水比)</th><th>库存(斤)</th><th>适用工序(逗号分隔)</th>
            </tr>
          </thead>
          <tbody>
            {cfg.sands.map((s) => (
              <tr key={s.id}>
                <td className="muted">{s.id}</td>
                <td><input value={s.name} onChange={(e) => change([{ kind: "sand", id: s.id, patch: { name: e.target.value } }])} /></td>
                <td><input type="number" value={s.grit} onChange={(e) => { const v = num(e.target.value); if (v !== null) change([{ kind: "sand", id: s.id, patch: { grit: v } }]); }} /></td>
                <td><input type="number" step="0.05" min="0.05" max="0.95" value={s.ratio} onChange={(e) => { const v = num(e.target.value); if (v !== null) change([{ kind: "sand", id: s.id, patch: { ratio: v } }]); }} /></td>
                <td><input type="number" step="0.5" value={s.stock} onChange={(e) => { const v = num(e.target.value); if (v !== null) change([{ kind: "sand", id: s.id, patch: { stock: v } }]); }} /></td>
                <td>
                  <input
                    value={s.applicable.join(",")}
                    onChange={(e) =>
                      change([{ kind: "sand", id: s.id, patch: { applicable: e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) } }])
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="btn-row"><button className="btn ghost small" onClick={addSand}>＋ 添加解玉砂</button></div>
        <p className="muted">每次修改都会即时增量重推：只重算受影响的工序与消耗结论，可至「推演」步查看复用/重算计数。</p>
      </section>
    </>
  );
}
