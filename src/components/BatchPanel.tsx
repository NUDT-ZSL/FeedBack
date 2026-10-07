import { useRef, useState } from 'react';
import { runBatch, type BatchCase, type BatchReport } from '../engine/batch.ts';
import { sampleBatchCases } from '../engine/sampleBatch.ts';

function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function BatchPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<BatchReport | null>(null);
  const [error, setError] = useState('');
  const [expandedCase, setExpandedCase] = useState<string | null>(null);

  const runCases = (cases: BatchCase[]) => {
    setReport(runBatch(cases));
  };

  const importFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const cases = (Array.isArray(raw) ? raw : raw.cases) as BatchCase[];
      if (!Array.isArray(cases)) throw new Error('格式应为 BatchCase[] 或 { cases }');
      setError('');
      runCases(cases);
    } catch (e) {
      setError(`批量文件导入失败：${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap gap-2">
        <button
          className="rounded bg-emerald-600 px-2 py-1.5 font-medium text-white hover:bg-emerald-500"
          onClick={() => runCases(sampleBatchCases())}
        >
          运行内置批量用例
        </button>
        <button
          className="rounded border border-slate-600 px-2 py-1.5 text-slate-200 hover:bg-slate-800"
          onClick={() => fileRef.current?.click()}
        >
          导入批量文件
        </button>
        {report && (
          <button
            className="rounded border border-slate-600 px-2 py-1.5 text-slate-200 hover:bg-slate-800"
            onClick={() => download('batch-report.json', JSON.stringify(report, null, 2))}
          >
            导出报告
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
            e.target.value = '';
          }}
        />
      </div>
      {error && <div className="rounded border border-rose-500/50 bg-rose-500/10 p-2 text-rose-300">{error}</div>}
      {report && (
        <div className="space-y-1.5">
          <div className={`rounded border px-2 py-1.5 font-medium ${report.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}`}>
            {report.ok ? '全部通过' : '存在失败项'} · {report.totalCases} 组场景 · {report.totalMutations} 组变更
          </div>
          <div className="max-h-72 space-y-1 overflow-auto">
            {report.cases.map((caseReport) => (
              <div key={caseReport.caseId} className="rounded border border-slate-700">
                <button
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-slate-800/60"
                  onClick={() => setExpandedCase(expandedCase === caseReport.caseId ? null : caseReport.caseId)}
                >
                  <span className="flex items-center gap-2">
                    <span className={caseReport.ok ? 'text-emerald-400' : 'text-rose-400'}>{caseReport.ok ? '✓' : '✗'}</span>
                    <span className="font-medium text-slate-200">{caseReport.caseId}</span>
                  </span>
                  <span className="text-slate-500">
                    事件 {caseReport.stats.events} · 切换 {caseReport.stats.switches} · 丢弃 {caseReport.stats.dropped}
                  </span>
                </button>
                {expandedCase === caseReport.caseId && (
                  <div className="space-y-1 border-t border-slate-700 p-2">
                    {caseReport.issues.length > 0 && (
                      <div className="text-slate-500">输入问题：{caseReport.issues.map((i) => `${i.code}x${i.count}`).join(', ')}</div>
                    )}
                    {caseReport.checks.map((check, i) => (
                      <div key={i} className={check.ok ? 'text-slate-400' : 'text-rose-300'}>
                        {check.ok ? '✓' : '✗'} {check.name}：{check.detail}
                      </div>
                    ))}
                    {caseReport.mutations.map((mutation, i) => (
                      <div key={i} className={mutation.ok ? 'text-slate-400' : 'text-rose-300'}>
                        {mutation.ok ? '✓' : '✗'} 变更[{mutation.description}]：{mutation.detail}
                        {mutation.incremental && (
                          <span className="text-slate-600">
                            （复用块 {mutation.incremental.reusedBlocks} / 重算 {mutation.incremental.recomputedBlocks}，
                            来源 {mutation.incremental.affectedSources.join(',') || '无'}，起始 t={mutation.incremental.affectedFromTick ?? '-'}）
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
