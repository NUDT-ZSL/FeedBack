import { useClinicStore } from '@/store/clinicStore';

const panel = 'rounded border border-[#3a3a3a] bg-[#f5deb3] p-4 shadow-md text-[#3a2a14]';

export function EfficacyPanel() {
  const result = useClinicStore((s) => s.result);

  return (
    <section className={panel}>
      <h2 className="mb-3 text-lg font-bold">疗效预估</h2>
      {result.efficacy.length === 0 && <p className="text-sm opacity-60">暂无候选方剂</p>}
      <ul className="space-y-2">
        {result.efficacy.map((e) => (
          <li key={e.formulaId} className="rounded bg-[#fdf3d8] p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{e.formulaName}</span>
              <span>
                有效率 {e.expectedRate}% · 约 {e.onsetDays} 日取效 · 把握度{e.confidence}
              </span>
            </div>
            {e.notes.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs opacity-80">
                {e.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
