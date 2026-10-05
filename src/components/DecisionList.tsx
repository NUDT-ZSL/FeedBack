import type { Decision } from '@/engine/types';

const KIND_LABEL: Record<Decision['kind'], { text: string; cls: string }> = {
  trigger: { text: '触发背压', cls: 'bg-red-100 text-red-700' },
  release: { text: '解除背压', cls: 'bg-green-100 text-green-700' },
  burst: { text: '突发越限', cls: 'bg-orange-100 text-orange-700' },
};

/** 背压决策列表：每条结论都带可解释依据与血缘版本 */
export default function DecisionList({ decisions }: { decisions: Decision[] }) {
  if (decisions.length === 0) {
    return <p className="text-sm text-slate-500">暂无背压决策</p>;
  }
  return (
    <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
      {decisions.map((d) => (
        <li key={d.id} className="rounded border border-slate-200 bg-white p-2 text-sm">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${KIND_LABEL[d.kind].cls}`}>
              {KIND_LABEL[d.kind].text}
            </span>
            <span className="text-slate-600">t={d.time.toFixed(2)}s</span>
            <span className="text-slate-600">积压 {d.backlog.toFixed(1)}</span>
            <span className="ml-auto text-xs text-slate-400">
              依据：事件v{d.basis.eventVersion} / 参数v{d.basis.paramsVersion}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{d.explanation}</p>
        </li>
      ))}
    </ul>
  );
}
