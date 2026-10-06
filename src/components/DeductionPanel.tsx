import type { DeductionResult } from '@/types';

const KIND_TITLES: Record<DeductionResult['kind'], string> = {
  none: '六爻安静 · 无动爻',
  single: '一爻独发',
  double: '两爻齐动',
  multiple: '多爻发动',
  all: '六爻尽动 · 整体取变',
};

interface DeductionPanelProps {
  deduction: DeductionResult;
  benGuaName: string;
  bianGuaName: string;
}

/** 断卦推演面板：动爻结论 + 断卦规则 + 综合断语 */
export default function DeductionPanel({ deduction, benGuaName, bianGuaName }: DeductionPanelProps) {
  return (
    <section className="rounded-xl border border-[#b8860b]/40 bg-[#faf3e3] p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between border-b border-[#b8860b]/30 pb-2">
        <h3 className="text-base font-bold text-[#5d3a1a]">断卦推演</h3>
        <span className="rounded-full bg-[#b8860b]/15 px-3 py-0.5 text-xs text-[#8a6d1f]">
          {KIND_TITLES[deduction.kind]}
        </span>
      </header>

      <p className="mb-3 text-sm leading-relaxed text-stone-600">{deduction.ruleText}</p>

      {deduction.kind !== 'none' && (
        <p className="mb-3 text-sm text-stone-600">
          本卦《{benGuaName}》之《{bianGuaName}》
          {deduction.movingPositions.length > 0 &&
            `，动爻：${deduction.movingPositions.map((p) => `第${'一二三四五六'[p - 1]}爻`).join('、')}`}
        </p>
      )}

      {deduction.changedLines.length > 0 && (
        <ul className="mb-3 space-y-2">
          {deduction.changedLines.map((line) => (
            <li
              key={line.position}
              className="rounded-lg border border-[#b8860b]/25 bg-white/60 p-3"
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded bg-red-700/10 px-2 py-0.5 text-xs font-bold text-red-700">
                  {line.label} · 动
                </span>
                <span className="text-xs text-stone-400">变 {line.changedLabel}</span>
              </div>
              <p className="text-sm leading-relaxed text-[#2a1a0a]">{line.originalYaoCi}</p>
              <p className="mt-0.5 text-xs text-stone-500">象曰：{line.originalXiaoXiang}</p>
              <p className="mt-1 text-xs leading-relaxed text-stone-500">
                变卦同位 {line.changedLabel}：{line.changedYaoCi}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg bg-[#b8860b]/10 p-3">
        <p className="text-sm font-medium leading-relaxed text-[#5d3a1a]">{deduction.summary}</p>
      </div>
    </section>
  );
}
