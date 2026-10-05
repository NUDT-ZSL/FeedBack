import { useMemo, useState } from 'react';
import { IncrementalCheck } from '@/components/sim/IncrementalCheck';
import { ParameterPanel } from '@/components/sim/ParameterPanel';
import { ResultPanel } from '@/components/sim/ResultPanel';
import { createSampleScenario, runScenario, type ScenarioInput } from '@/simulation';


/**
 * 主界面：只负责展示与交互。
 * 水车转速、渠道分流、田块蓄水、作物缺水判定全部由
 * src/simulation 推演引擎产出，界面不做任何口径改写。
 */
export default function Home() {
  const [scenario, setScenario] = useState<ScenarioInput>(() => createSampleScenario());

  const { result, rerunChecksum, deterministic, error } = useMemo(() => {
    try {
      const first = runScenario(scenario);
      const second = runScenario(scenario);
      return {
        result: first,
        rerunChecksum: second.checksum,
        deterministic: first.checksum === second.checksum,
        error: null as string | null,
      };
    } catch (err) {
      return {
        result: null,
        rerunChecksum: '',
        deterministic: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [scenario]);

  const exportScenario = () => {
    const blob = new Blob([JSON.stringify({ scenarios: [scenario] }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${scenario.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full w-full overflow-auto bg-gradient-to-b from-[#e6f2f0] to-[#b8d4c8]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-emerald-950">古代水车灌溉推演台</h1>
            <p className="mt-1 text-sm text-stone-600">
              推演引擎与渲染解耦：界面仅展示 src/simulation 的推演结论，可用 npm run simulate 离线复算比对
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-emerald-900/30 bg-white/70 px-3 py-1.5 text-sm text-emerald-900 transition hover:scale-105"
              onClick={() => setScenario(createSampleScenario())}
            >
              恢复样例参数
            </button>
            <button
              type="button"
              className="rounded-lg border border-emerald-900/30 bg-white/70 px-3 py-1.5 text-sm text-emerald-900 transition hover:scale-105"
              onClick={exportScenario}
            >
              导出场景 JSON
            </button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <ParameterPanel scenario={scenario} onChange={setScenario} />
          <div className="space-y-3">
            {result && !error ? (
              <ResultPanel
                result={result}
                scenario={scenario}
                rerunChecksum={rerunChecksum}
                deterministic={deterministic}
                error={null}
              />
            ) : (
              <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
                输入不合法：{error}
              </div>
            )}
            <IncrementalCheck scenario={scenario} />
          </div>
        </div>
      </div>
    </div>
  );
}
