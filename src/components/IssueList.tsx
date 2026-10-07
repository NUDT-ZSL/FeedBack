import type { ValidationIssue } from '../engine/types.ts';

export default function IssueList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) {
    return <div className="rounded-lg border border-slate-700 p-3 text-xs text-slate-500">输入校验通过，无异常记录</div>;
  }
  return (
    <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-slate-700 p-2">
      {issues.map((issue, i) => (
        <div
          key={i}
          className={`rounded border px-2 py-1 text-xs ${
            issue.severity === 'error'
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
          }`}
        >
          <span className="mr-1 font-mono text-[10px] opacity-70">[{issue.code}]</span>
          {issue.message}
        </div>
      ))}
    </div>
  );
}
