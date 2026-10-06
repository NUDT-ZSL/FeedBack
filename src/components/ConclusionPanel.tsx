import type { ClearanceConclusion } from '@/domain/types';
import { DecisionBadge } from './badges';

interface Props {
  conclusion: ClearanceConclusion;
  highlightKey: string | null;
}

export default function ConclusionPanel({ conclusion, highlightKey }: Props) {
  return (
    <section className="rounded-lg border-2 border-[#8b4513] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[#6b3a2a]">
          当前通关结论
          <span className="ml-2 text-xs font-normal text-[#8b4513]">
            货单 v{conclusion.manifestVersion} · 已生效裁定 {conclusion.rulingCount} 条
          </span>
        </h2>
        <DecisionBadge decision={conclusion.decision} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {conclusion.reasons.map((r) => (
          <span
            key={r}
            className="rounded-md bg-[#f5e6c8] px-2 py-0.5 text-xs text-[#6b3a2a]"
          >
            {r}
          </span>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-[#8b4513] text-left text-[#6b3a2a]">
            <th className="py-1 pr-2">货物</th>
            <th className="py-1 pr-2">类别</th>
            <th className="py-1 pr-2 text-right">数量</th>
            <th className="py-1 pr-2 text-right">单价</th>
            <th className="py-1 pr-2 text-right">税率</th>
            <th className="py-1 pr-2 text-right">税银（两）</th>
            <th className="py-1">来源</th>
          </tr>
        </thead>
        <tbody>
          {conclusion.lines.map((line) => (
            <tr
              key={line.key}
              id={`line-${line.key}`}
              className={`border-b border-[#e8dcc0] align-top transition-colors duration-500 ${
                highlightKey === line.key ? 'bg-[#ffd70055]' : ''
              }`}
            >
              <td className="py-1.5 pr-2">
                <div>{line.name}</div>
                {line.declared && (
                  <div className="text-xs text-[#922b21]">
                    货单原记：{line.declared.name} {line.declared.quantity}（{line.declared.category}）
                  </div>
                )}
                {line.conflicts.map((c) => (
                  <div key={c} className="text-xs text-[#922b21]">⚠ {c}</div>
                ))}
              </td>
              <td className="py-1.5 pr-2">{line.category}</td>
              <td className="py-1.5 pr-2 text-right font-semibold text-[#e67e22]">
                {line.quantity}
              </td>
              <td className="py-1.5 pr-2 text-right">{line.unitPrice}</td>
              <td className="py-1.5 pr-2 text-right">{(line.rate * 100).toFixed(0)}%</td>
              <td className="py-1.5 pr-2 text-right font-semibold">{line.tax.toFixed(2)}</td>
              <td className="py-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    line.source === 'ruling'
                      ? 'bg-[#922b21] text-white'
                      : 'bg-[#d5c9a1] text-[#6b3a2a]'
                  }`}
                >
                  {line.source === 'ruling' ? '裁定' : '货单'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-[#6b3a2a]">
            <td colSpan={5} className="py-2 text-right font-bold">
              应征税银合计
            </td>
            <td className="py-2 text-right text-lg font-bold text-[#e67e22]">
              {conclusion.totalTax.toFixed(2)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
