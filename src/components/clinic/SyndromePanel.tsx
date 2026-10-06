import { useClinicStore } from '@/store/clinicStore';

const panel = 'rounded border border-[#3a3a3a] bg-[#f5deb3] p-4 shadow-md text-[#3a2a14]';

export function SyndromePanel() {
  const result = useClinicStore((s) => s.result);

  return (
    <section className={panel}>
      <h2 className="mb-3 text-lg font-bold">辨证结果</h2>
      {result.syndromes.length === 0 && <p className="text-sm opacity-60">请先完成四诊采集</p>}
      <ul className="space-y-3">
        {result.syndromes.map((s) => (
          <li key={s.syndromeId} className="rounded bg-[#fdf3d8] p-3">
            <div className="flex items-center justify-between">
              <span className={`text-base ${s.determined ? 'font-bold' : 'opacity-60'}`}>
                {s.name}
                {s.determined ? '' : '（未达阈值）'}
              </span>
              <span className="text-sm">
                {s.score} / {s.threshold}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded bg-[#e6d3a8]">
              <div
                className={`h-full ${s.determined ? 'bg-[#2e7d32]' : 'bg-[#b0a080]'}`}
                style={{ width: `${Math.min(100, (s.score / Math.max(s.threshold, 1)) * 100)}%` }}
              />
            </div>
            <ul className="mt-2 text-xs opacity-80">
              {s.contributions.map((c, i) => (
                <li key={`${c.from}-${i}`}>
                  {c.detail}：{c.delta > 0 ? '+' : ''}
                  {c.delta}
                </li>
              ))}
              {s.contributions.length === 0 && <li className="opacity-60">暂无命中采集项</li>}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
