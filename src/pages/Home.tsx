import { IntakePanel } from '@/components/clinic/IntakePanel';
import { ConflictPanel } from '@/components/clinic/ConflictPanel';
import { SyndromePanel } from '@/components/clinic/SyndromePanel';
import { FormulaPanel } from '@/components/clinic/FormulaPanel';
import { EfficacyPanel } from '@/components/clinic/EfficacyPanel';
import { useClinicStore } from '@/store/clinicStore';
import { ALL_CASES } from '@/engine/fixtures';

const btn =
  'rounded border border-[#3a3a3a] bg-[#8b6f47] px-3 py-1.5 text-sm text-[#f5deb3] transition-transform active:scale-95 hover:bg-[#6f5836]';

export default function Home() {
  const reset = useClinicStore((s) => s.reset);
  const loadFixture = useClinicStore((s) => s.loadFixture);

  return (
    <div className="min-h-screen bg-[#5d3a1a] p-4 md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-[#3a3a3a] bg-[#f5deb3] px-4 py-3 shadow-md">
        <h1 className="text-xl font-bold text-[#3a2a14]">太医署 · 坐堂问诊推演</h1>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ALL_CASES).map(([name, records]) => (
            <button key={name} className={btn} onClick={() => loadFixture(records)}>
              载入{name}
            </button>
          ))}
          <button className={btn} onClick={reset}>
            新建诊案
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <IntakePanel />
        </div>
        <div className="space-y-4">
          <ConflictPanel />
          <SyndromePanel />
        </div>
        <div className="space-y-4">
          <FormulaPanel />
          <EfficacyPanel />
        </div>
      </main>
    </div>
  );
}
