import { useClinicStore } from '@/store/clinicStore';

const panel = 'rounded border border-[#3a3a3a] bg-[#f5deb3] p-4 shadow-md text-[#3a2a14]';
const roleColor: Record<string, string> = {
  君: '#c0392b',
  臣: '#d35400',
  佐: '#7f8c8d',
  使: '#2c3e50',
};

export function FormulaPanel() {
  const result = useClinicStore((s) => s.result);

  return (
    <section className={panel}>
      <h2 className="mb-3 text-lg font-bold">候选方剂（按契合度排序）</h2>
      {result.formulas.length === 0 && (
        <p className="text-sm opacity-60">尚无达到判定阈值的证候</p>
      )}
      <ol className="space-y-3">
        {result.formulas.map((f, i) => (
          <li key={f.formulaId} className="rounded bg-[#fdf3d8] p-3">
            <div className="flex items-center justify-between">
              <span className="font-bold">
                {i + 1}. {f.name}
              </span>
              <span className="text-sm">契合度 {f.score}</span>
            </div>
            <p className="mt-1 text-xs opacity-70">总剂量 {f.totalDose} 钱 · 君臣佐使配比</p>
            <ul className="mt-2 space-y-1">
              {f.herbs.map((h) => (
                <li key={h.name} className="flex items-center gap-2 text-xs">
                  <span
                    className="inline-block w-4 text-center font-bold"
                    style={{ color: roleColor[h.role] }}
                  >
                    {h.role}
                  </span>
                  <span className="w-14">{h.name}</span>
                  <span className="w-12">{h.dose} 钱</span>
                  <span className="relative h-2 flex-1 overflow-hidden rounded bg-[#e6d3a8]">
                    <span
                      className="absolute left-0 top-0 h-full bg-[#8b6f47]"
                      style={{ width: `${h.ratio * 100}%` }}
                    />
                  </span>
                  <span className="w-12 text-right">{(h.ratio * 100).toFixed(1)}%</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
