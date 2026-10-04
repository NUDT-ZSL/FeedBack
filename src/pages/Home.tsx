import { useMemo, useRef, useState } from 'react';
import { Workbench, explain } from '@/engine';
import type { DerivationResult, Explanation, Resolution, TaskDecl } from '@/engine';
import { ConflictPanel } from '@/components/workbench/ConflictPanel';
import { OrderView } from '@/components/workbench/OrderView';
import { ExplainPanel } from '@/components/workbench/ExplainPanel';
import sample01 from '../../samples/01-normal.json';
import sample02 from '../../samples/02-cycle.json';
import sample03 from '../../samples/03-missing-dep.json';
import sample04 from '../../samples/04-duration-conflict.json';
import sample05 from '../../samples/05-incremental.json';

interface SampleJson {
  name: string;
  title: string;
  decls: TaskDecl[];
}

const SAMPLES = [sample01, sample02, sample03, sample04, sample05] as unknown as SampleJson[];

export default function Home() {
  const [sampleName, setSampleName] = useState(SAMPLES[0].name);
  const [result, setResult] = useState<DerivationResult>(() => {
    const wb = new Workbench(SAMPLES[0].decls);
    return wb.derive();
  });
  const [affected, setAffected] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<string[]>(() => ['整体重推：初始样例']);
  const workbenchRef = useRef<Workbench>(new Workbench(SAMPLES[0].decls));

  const sample = SAMPLES.find((s) => s.name === sampleName)!;
  const explanation: Explanation | null = selected ? explain(result, selected) : null;
  const taskIds = useMemo(() => Object.keys(result.tasks), [result]);

  const loadSample = (name: string) => {
    const next = SAMPLES.find((s) => s.name === name)!;
    const workbench = new Workbench(next.decls);
    workbenchRef.current = workbench;
    setSampleName(name);
    setResult(workbench.derive());
    setAffected(null);
    setSelected(null);
    setAuditLog([...workbench.auditLog]);
  };

  const handleResolve = (res: Resolution) => {
    const { affected: nextAffected, result: nextResult } = workbenchRef.current.apply([res]);
    setResult(nextResult);
    setAffected(nextAffected);
    setAuditLog([...workbenchRef.current.auditLog]);
  };

  const handleFullDerive = () => {
    setResult(workbenchRef.current.derive());
    setAffected(null);
    setAuditLog([...workbenchRef.current.auditLog]);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 text-gray-900">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">构建依赖推演工作台</h1>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={sampleName}
          onChange={(e) => loadSample(e.target.value)}
        >
          {SAMPLES.map((s) => (
            <option key={s.name} value={s.name}>
              {s.title}
            </option>
          ))}
        </select>
        <button
          className="rounded bg-gray-800 px-3 py-1 text-sm text-white hover:bg-gray-700"
          onClick={handleFullDerive}
        >
          整体重推
        </button>
        {affected && (
          <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800">
            增量重推完成，仅重推 {affected.length} 项：{affected.join('、') || '无'}
          </span>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold">任务声明（{sample.decls.length} 条来源）</h2>
            <ul className="space-y-1 text-xs">
              {sample.decls.map((decl, i) => {
                const task = result.tasks[decl.id];
                return (
                  <li
                    key={i}
                    className={`rounded border px-2 py-1 ${
                      task?.durationConflict ? 'border-red-300 bg-red-50' : 'border-gray-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium">{decl.id}</span>
                      <span className="text-gray-500">耗时 {decl.duration}</span>
                    </div>
                    <div className="text-gray-500">
                      依赖 {decl.dependsOn.length ? decl.dependsOn.join(', ') : '无'}
                      {decl.optionalDeps?.length ? `；可选 ${decl.optionalDeps.join(', ')}` : ''}
                    </div>
                    <div className="text-[10px] text-gray-400">{decl.source}</div>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold">冲突与裁决</h2>
            <ConflictPanel conflicts={result.conflicts} taskIds={taskIds} onResolve={handleResolve} />
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold">
            合法构建顺序
            {result.makespan !== null && <span className="ml-2 text-gray-500">整体完工 {result.makespan}</span>}
          </h2>
          <OrderView result={result} affected={affected} selected={selected} onSelect={setSelected} />
          <h2 className="mb-1 mt-4 text-sm font-semibold">
            关键路径
            <span className="ml-2 text-xs font-normal text-orange-600">
              {result.criticalPath.join(' → ') || '（暂不可计算）'}
            </span>
          </h2>
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold">位置依据</h2>
            <ExplainPanel explanation={explanation} />
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold">推演与裁决记录</h2>
            <ul className="space-y-1 text-xs text-gray-600">
              {auditLog.map((line, i) => (
                <li key={i} className="border-b border-gray-50 pb-1">{line}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
