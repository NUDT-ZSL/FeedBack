import { useClinicStore } from '@/stores/clinicStore';
import CollectionPanel from './CollectionPanel';
import ResultPanel from './ResultPanel';

/** 固定样例病人：离线可复现，不依赖随机生成。 */
const PATIENT = {
  name: '沈三郎',
  age: 32,
  complaint: '发热恶寒三日，头身疼痛',
};

export default function ClinicRoom() {
  const deduce = useClinicStore((s) => s.deduce);
  const reset = useClinicStore((s) => s.reset);
  const records = useClinicStore((s) => s.records);

  return (
    <div className="min-h-screen bg-[#5d3a1a] p-4 text-stone-200 md:p-6">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-b border-[#3a3a3a] pb-3">
        <h1 className="font-serif text-2xl font-bold text-[#f5deb3]">太医署 · 问诊室</h1>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-amber-800 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:bg-amber-700 active:scale-95 disabled:opacity-40"
            onClick={deduce}
            disabled={records.length === 0}
          >
            辨证
          </button>
          <button
            type="button"
            className="rounded border border-amber-800/60 px-4 py-2 text-sm text-amber-200 transition hover:bg-amber-900/40 active:scale-95"
            onClick={reset}
          >
            新建诊案
          </button>
        </div>
      </header>

      <main className="mx-auto mt-4 grid max-w-6xl gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <section className="flex items-center gap-4 rounded-lg border border-amber-900/40 bg-[#f5deb3]/95 p-4 text-stone-800">
            <div
              className="h-16 w-16 shrink-0 rounded-full"
              style={{ background: 'radial-gradient(circle at 35% 35%, #f0c8a0, #b87850)' }}
            />
            <div>
              <div className="font-serif text-lg font-bold text-amber-900">
                {PATIENT.name}
                <span className="ml-2 text-sm font-normal text-stone-500">{PATIENT.age} 岁</span>
              </div>
              <p className="text-sm text-stone-600">主诉：{PATIENT.complaint}</p>
            </div>
          </section>
          <CollectionPanel />
        </div>
        <div className="lg:col-span-2">
          <ResultPanel />
        </div>
      </main>
    </div>
  );
}
