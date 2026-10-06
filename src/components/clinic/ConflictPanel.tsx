import { useClinicStore, KIND_LABEL } from '@/store/clinicStore';

const card = 'rounded border border-[#3a3a3a] bg-[#fdf3d8] p-3';

export function ConflictPanel() {
  const records = useClinicStore((s) => s.records);
  const result = useClinicStore((s) => s.result);
  const adjudicate = useClinicStore((s) => s.adjudicate);

  const groups = new Map<string, typeof records>();
  for (const r of records) {
    if (r.status === 'rejected') continue;
    const gk = `${r.kind}|${r.key}`;
    const list = groups.get(gk) ?? [];
    list.push(r);
    groups.set(gk, list);
  }
  const conflicts = [...groups.values()]
    .filter((list) => new Set(list.map((r) => r.value)).size > 1)
    .sort((a, b) => a[0].id.localeCompare(b[0].id));

  const cycleDiags = result.diagnostics.filter((d) => d.type === 'dependency-cycle');
  const missingDiags = result.diagnostics.filter((d) => d.type === 'missing-reference');

  if (conflicts.length === 0 && cycleDiags.length === 0 && missingDiags.length === 0) return null;

  return (
    <section className="space-y-3">
      {conflicts.length > 0 && (
        <div className="rounded border-2 border-[#c0392b] bg-[#f5deb3] p-4 shadow-md">
          <h2 className="mb-2 text-lg font-bold text-[#3a2a14]">冲突裁决</h2>
          <p className="mb-2 text-xs text-[#7b2d26]">
            同一采集项出现互异值，全部暂不参与辨证，请按来源与时刻裁决采纳哪一条。
          </p>
          {conflicts.map((list) => (
            <div key={`${list[0].kind}|${list[0].key}`} className={`${card} mb-2`}>
              <div className="mb-1 text-sm font-semibold text-[#3a2a14]">
                {KIND_LABEL[list[0].kind]} · {list[0].key}
              </div>
              <div className="space-y-1">
                {list.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm">
                    <span>
                      {r.value === 'present' ? '有' : r.value}
                      <span className="ml-2 text-xs opacity-70">
                        [{r.source}] #{r.id} t={r.collectedAt}
                      </span>
                    </span>
                    <button
                      className="rounded border border-[#3a3a3a] bg-[#8b6f47] px-2 py-1 text-xs text-[#f5deb3] active:scale-95 hover:bg-[#6f5836]"
                      onClick={() => adjudicate(list[0].kind, list[0].key, r.id)}
                    >
                      采纳此条
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {(cycleDiags.length > 0 || missingDiags.length > 0) && (
        <div className="rounded border-2 border-[#b7791f] bg-[#f5deb3] p-4 shadow-md">
          <h2 className="mb-2 text-lg font-bold text-[#3a2a14]">依赖异常（不会被静默跳过）</h2>
          {cycleDiags.map((d) => (
            <p key={d.detail} className="mb-1 text-sm text-[#7b2d26]">
              闭环：{d.type === 'dependency-cycle' && d.detail}
            </p>
          ))}
          {missingDiags.map((d) => (
            <p key={d.detail} className="mb-1 text-sm text-[#7b2d26]">
              缺失：{d.type === 'missing-reference' && d.detail}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
