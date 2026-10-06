import { useWorkshop } from "../store.js";

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function ConfigStep() {
  const { cfg, change, addStep } = useWorkshop();
  return (
    <section className="panel">
      <h2>工序配置</h2>
      <table>
        <thead>
          <tr>
            <th>标记</th><th>名称</th><th>所需玉料</th><th>所用解玉砂</th><th>所需砂量(斤)</th>
            <th>前置工序(逗号分隔标记)</th><th>预计耗时(刻)</th><th>切削强度</th><th>暂停</th><th></th>
          </tr>
        </thead>
        <tbody>
          {cfg.steps.map((s) => (
            <tr key={s.id} className={s.disabled ? "blocked-row" : ""}>
              <td className="muted">{s.id}</td>
              <td><input value={s.name} onChange={(e) => change([{ kind: "step", id: s.id, patch: { name: e.target.value } }])} /></td>
              <td>
                <select value={s.materialId} onChange={(e) => change([{ kind: "step", id: s.id, patch: { materialId: e.target.value } }])}>
                  {cfg.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </td>
              <td>
                <select value={s.sandId} onChange={(e) => change([{ kind: "step", id: s.id, patch: { sandId: e.target.value } }])}>
                  <option value="">（不用砂）</option>
                  {cfg.sands.map((sd) => <option key={sd.id} value={sd.id}>{sd.name}</option>)}
                </select>
              </td>
              <td><input type="number" step="0.5" value={s.sandBase} onChange={(e) => { const v = num(e.target.value); if (v !== null) change([{ kind: "step", id: s.id, patch: { sandBase: v } }]); }} /></td>
              <td>
                <input
                  value={s.prerequisites.join(",")}
                  placeholder="如 p01,p02"
                  onChange={(e) =>
                    change([{ kind: "step", id: s.id, patch: { prerequisites: e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) } }])
                  }
                />
              </td>
              <td><input type="number" value={s.duration} onChange={(e) => { const v = num(e.target.value); if (v !== null) change([{ kind: "step", id: s.id, patch: { duration: v } }]); }} /></td>
              <td><input type="number" step="0.1" value={s.intensity} onChange={(e) => { const v = num(e.target.value); if (v !== null) change([{ kind: "step", id: s.id, patch: { intensity: v } }]); }} /></td>
              <td><input type="checkbox" checked={!!s.disabled} onChange={(e) => change([{ kind: "step", id: s.id, patch: { disabled: e.target.checked } }])} /></td>
              <td><button className="btn ghost small" onClick={() => change([{ kind: "remove-step", id: s.id }])}>删</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="btn-row"><button className="btn ghost small" onClick={addStep}>＋ 添加工序</button></div>
      <p className="muted">前置工序、玉料、砂的改动属于结构变更，会触发全量重推；砂量、耗时、强度等属性变更只重推受影响工序。</p>
    </section>
  );
}
