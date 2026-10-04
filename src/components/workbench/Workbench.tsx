import { useMemo, useState } from 'react';
import { derive, deriveIncremental } from '@/scheduler/index.ts';
import type { BatchInput, Decision, DeriveResult, IncrementalResult } from '@/scheduler/index.ts';
import { IssuesPanel } from './IssuesPanel.tsx';
import { OrderTable } from './OrderTable.tsx';
import { TracePanel } from './TracePanel.tsx';
import { EditPanel } from './EditPanel.tsx';

interface SampleFile extends BatchInput {
  fixes?: { label: string; decisions: Decision[] }[];
}

const sampleModules = import.meta.glob<SampleFile>('../../../samples/*.json', { eager: true, import: 'default' });

interface LogEntry {
  label: string;
  fingerprint: string;
  affected: string[];
  consistent: boolean;
  positionChanges: string[];
}

export function Workbench() {
  const sampleNames = useMemo(() => Object.entries(sampleModules).map(([path, value]) => ({ path, name: value.name ?? path })), []);
  const [samplePath, setSamplePath] = useState(sampleNames[0]?.path ?? '');
  const [input, setInput] = useState<BatchInput>(() => loadSample(sampleNames[0]?.path ?? ''));
  const [result, setResult] = useState<DeriveResult>(() => derive(loadSample(sampleNames[0]?.path ?? '')));
  const [incremental, setIncremental] = useState<IncrementalResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  function loadSample(path: string): BatchInput {
    const sample = sampleModules[path];
    if (!sample) return { name: 'empty', declarations: [] };
    return { name: sample.name, declarations: sample.declarations ?? [], decisions: sample.decisions ?? [] };
  }

  function switchSample(path: string): void {
    const nextInput = loadSample(path);
    setSamplePath(path);
    setInput(nextInput);
    setResult(derive(nextInput));
    setIncremental(null);
    setSelected(null);
    setLog([]);
  }

  function applyChange(nextInput: BatchInput, label: string): void {
    const inc = deriveIncremental(result, input, nextInput);
    setInput(nextInput);
    setResult(inc.result);
    setIncremental(inc);
    setLog((previous) => [
      {
        label,
        fingerprint: inc.result.fingerprint,
        affected: inc.affected,
        consistent: inc.consistent,
        positionChanges: inc.changedPositions.map((change) => `${change.id}: ${change.from ?? '-'}→${change.to ?? '-'}`),
      },
      ...previous,
    ].slice(0, 8));
  }

  const sample = sampleModules[samplePath];

  return (
    <div className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <header className="mx-auto mb-4 max-w-7xl">
        <h1 className="text-lg font-semibold">构建依赖推演工作台</h1>
        <p className="text-xs text-slate-500">
          多来源任务声明 → 冲突/缺失/成环检测与人工裁决 → 拓扑顺序、最早开始时刻、关键路径 → 排位依据可追溯 → 局部修正只重推受影响任务
        </p>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr_1fr]">
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">本地样例</h2>
              <button className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100" onClick={() => switchSample(samplePath)}>重置当前样例</button>
            </div>
            <select className="mt-2 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" value={samplePath} onChange={(event) => switchSample(event.target.value)}>
              {sampleNames.map((entry) => <option key={entry.path} value={entry.path}>{entry.name}</option>)}
            </select>
            <p className="mt-2 text-xs text-slate-400">输入指纹 {result.fingerprint} · 批量验证：<code>npm run bench</code></p>
          </section>

          <IssuesPanel issues={result.issues} onDecision={(decision) => applyChange({ ...input, decisions: [...(input.decisions ?? []), decision] }, `裁决 ${decision.type}`)} />

          <EditPanel input={input} onApply={applyChange} />

          {sample?.fixes && sample.fixes.length > 0 && (
            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-slate-800">样例预设修正</h2>
              <div className="flex flex-col gap-2">
                {sample.fixes.map((fix) => (
                  <button key={fix.label} className="rounded border border-slate-300 px-2 py-1.5 text-left text-xs hover:bg-slate-100" onClick={() => applyChange({ ...input, decisions: [...(input.decisions ?? []), ...fix.decisions] }, fix.label)}>
                    {fix.label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <OrderTable result={result} incremental={incremental} selected={selected} onSelect={setSelected} />
        </div>

        <div className="space-y-4">
          <TracePanel result={result} taskId={selected} />
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">裁决记录与溯源</h2>
            <ul className="space-y-2 text-xs text-slate-600">
              {result.appliedDecisions.map((entry, index) => (
                <li key={index} className="rounded bg-slate-50 p-2">
                  <p className="font-medium text-slate-700">{entry.effect}</p>
                  <p className="mt-0.5 text-slate-400">决策：{JSON.stringify(entry.decision)}</p>
                </li>
              ))}
              {result.appliedDecisions.length === 0 && <li className="text-slate-400">尚无裁决。</li>}
            </ul>
          </section>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">增量重推日志</h2>
            <ul className="space-y-2 text-xs text-slate-600">
              {log.map((entry, index) => (
                <li key={index} className="rounded bg-slate-50 p-2">
                  <p className="font-medium text-slate-700">{entry.label}</p>
                  <p className={entry.consistent ? 'text-emerald-600' : 'text-rose-600'}>
                    {entry.consistent ? '与整体重推一致' : '一致性校验失败'} · 指纹 {entry.fingerprint}
                  </p>
                  <p className="mt-0.5 text-slate-500">受影响：{entry.affected.join('、') || '（无改动）'}</p>
                  {entry.positionChanges.length > 0 && <p className="text-slate-500">排位：{entry.positionChanges.join('；')}</p>}
                </li>
              ))}
              {log.length === 0 && <li className="text-slate-400">做出裁决或修正后，这里显示只重推了哪些任务，以及与整体重推的一致性结果。</li>}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
