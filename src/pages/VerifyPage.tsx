import { useMemo, useState } from 'react';
import { useStore } from '@/store/useStore';
import { runScenarios, verifyAll, type CheckResult } from '@/domain/verify';

function CheckList({ checks }: { checks: CheckResult[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {checks.map((c) => (
        <div
          key={c.id}
          className={`rounded-md border p-3 text-sm ${
            c.pass ? 'border-[#1a527644] bg-[#1a52760a]' : 'border-[#922b2166] bg-[#922b210a]'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#6b3a2a]">
              {c.group} · {c.title}
            </span>
            <span className={c.pass ? 'text-[#1a5276]' : 'text-[#922b21]'}>
              {c.pass ? '通过' : '不通过'}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#5d4b3a]">{c.detail}</p>
        </div>
      ))}
    </div>
  );
}

export default function VerifyPage() {
  const ships = useStore((s) => s.ships);
  const rules = useStore((s) => s.rules);
  const resetAll = useStore((s) => s.resetAll);
  const [ran, setRan] = useState(false);

  const scenarioChecks = useMemo(() => (ran ? runScenarios() : []), [ran]);
  const liveChecks = useMemo(() => (ran ? verifyAll(ships, rules) : []), [ran, ships, rules]);

  const all = [...scenarioChecks, ...liveChecks];
  const failed = all.filter((c) => !c.pass).length;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border-2 border-[#8b4513] bg-[#f5e6c8] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#6b3a2a]">核验中心</h2>
            <p className="text-sm text-[#8b4513]">
              统一入口：边界场景核验（内存构造，不动在港数据）+ 在港商船批量核验（结论重推一致性、锁定约束、裁定链追溯）。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {ran && (
              <span
                className={`rounded-md px-3 py-1 text-sm text-white ${
                  failed === 0 ? 'bg-[#1a5276]' : 'bg-[#922b21]'
                }`}
              >
                {all.length - failed}/{all.length} 通过
              </span>
            )}
            <button
              onClick={() => setRan(true)}
              className="rounded-md bg-gradient-to-b from-[#1a5276] to-[#154360] px-4 py-1.5 text-sm text-white transition hover:brightness-110"
            >
              运行全部核验
            </button>
            <button
              onClick={() => {
                resetAll();
                setRan(false);
              }}
              className="rounded-md border border-[#922b21] px-3 py-1.5 text-sm text-[#922b21] hover:bg-[#922b2110]"
            >
              重置示例数据
            </button>
          </div>
        </div>
      </section>

      {!ran && (
        <p className="rounded-lg border-2 border-dashed border-[#c9b78c] bg-white p-8 text-center text-[#8b4513]">
          点击「运行全部核验」开始核对。
        </p>
      )}

      {ran && (
        <>
          <section className="rounded-lg border-2 border-[#8b4513] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#6b3a2a]">边界场景核验</h3>
            <CheckList checks={scenarioChecks} />
          </section>
          <section className="rounded-lg border-2 border-[#8b4513] bg-white p-4">
            <h3 className="mb-3 text-base font-bold text-[#6b3a2a]">在港商船批量核验</h3>
            <CheckList checks={liveChecks} />
          </section>
        </>
      )}
    </div>
  );
}
