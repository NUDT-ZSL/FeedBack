import { useClinicStore } from '@/stores/clinicStore';
import { itemLabel } from './catalog';
import type { RecordKind } from '@/diagnosis';

const ROLE_LABEL = { jun: '君', chen: '臣', zuo: '佐', shi: '使' } as const;

function splitKey(id: string): [RecordKind, string] {
  const sep = id.indexOf(':');
  return [id.slice(0, sep) as RecordKind, id.slice(sep + 1)];
}

function labelOf(id: string): string {
  const [kind, key] = splitKey(id);
  if (kind === 'symptom' || kind === 'pulse' || kind === 'tongue' || kind === 'constitution' || kind === 'history') {
    return itemLabel(kind, key);
  }
  return id;
}

export default function ResultPanel() {
  const result = useClinicStore((s) => s.result);
  if (!result) {
    return (
      <div className="rounded-lg border border-amber-900/40 bg-[#f5deb3]/90 p-4 text-center text-stone-500">
        完成四诊采集后，点击「辨证」在此查看证候、候选方剂、剂量配比与疗效预估。
      </div>
    );
  }

  const concluded = result.syndromes
    .filter((s) => s.status === 'concluded' && s.score >= s.threshold)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.syndromeId < b.syndromeId ? -1 : 1));
  const blocked = result.syndromes.filter((s) => s.status === 'blocked');
  const unresolved = result.conflicts.filter((c) => c.resolvedRecordId === null);

  return (
    <div className="space-y-4">
      {result.dependencyIssues.length > 0 && (
        <section className="rounded-lg border border-red-700/50 bg-red-950/40 p-3 text-sm text-red-100">
          <h3 className="font-bold">依赖问题（未静默跳过）</h3>
          <ul className="mt-1 list-disc pl-5">
            {result.dependencyIssues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </section>
      )}

      {unresolved.length > 0 && (
        <section className="rounded-lg border border-amber-600/50 bg-amber-950/40 p-3 text-sm text-amber-100">
          有 {unresolved.length} 项采集冲突尚未裁决，相关采集项本次未参与辨证：
          {unresolved.map((c) => itemLabel(c.kind, c.key)).join('、')}。
        </section>
      )}

      <section className="rounded-lg border border-amber-900/40 bg-[#f5deb3]/95 p-3 text-stone-800">
        <h3 className="font-serif text-lg font-bold text-amber-900">辨证结果</h3>
        {concluded.length === 0 && blocked.length === 0 && (
          <p className="mt-1 text-sm text-stone-500">暂无成立的证候。</p>
        )}
        <ul className="mt-2 space-y-2">
          {concluded.map((s) => (
            <li key={s.syndromeId}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{s.name}</span>
                <span className="text-xs text-stone-500">
                  得分 {s.score} / 阈值 {s.threshold}
                </span>
              </div>
              <div className="mt-0.5 h-2 rounded bg-stone-300">
                <div
                  className="h-2 rounded bg-amber-700"
                  style={{ width: `${Math.min(100, Math.round((s.score / (s.threshold * 2)) * 100))}%` }}
                />
              </div>
              <p className="mt-0.5 text-xs text-stone-500">
                证据：{s.evidence.map(labelOf).join('、') || '—'}
                {s.modifiers.length > 0 &&
                  `；体质/病史修正：${s.modifiers.map((m) => `${labelOf(m.id)}${m.delta > 0 ? '+' : ''}${m.delta}`).join('、')}`}
              </p>
            </li>
          ))}
          {blocked.map((s) => (
            <li key={s.syndromeId} className="rounded border border-red-700/40 bg-red-100/60 p-2 text-sm">
              <span className="font-semibold text-red-900">{s.name}（已阻断）</span>
              <p className="text-xs text-red-800">{s.blockReason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-amber-900/40 bg-[#f5deb3]/95 p-3 text-stone-800">
        <h3 className="font-serif text-lg font-bold text-amber-900">候选方剂</h3>
        {result.formulas.length === 0 ? (
          <p className="mt-1 text-sm text-stone-500">暂无匹配方剂。</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {result.formulas.map((f) => (
              <li key={f.formulaId} className="rounded border border-amber-900/30 bg-amber-50/60 p-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">
                    {f.rank}. {f.name}
                  </span>
                  <span className="text-xs text-stone-500">匹配分 {f.matchScore}</span>
                </div>
                <p className="mt-0.5 text-xs text-stone-500">{f.reasons.join('；')}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {result.dosages.length > 0 && (
        <section className="rounded-lg border border-amber-900/40 bg-[#f5deb3]/95 p-3 text-stone-800">
          <h3 className="font-serif text-lg font-bold text-amber-900">剂量配比</h3>
          {result.dosages.map((d) => (
            <div key={d.formulaId} className="mt-2">
              <div className="flex items-center justify-between text-sm font-semibold">
                <span>{d.name}</span>
                <span className="text-xs font-normal text-stone-500">
                  寒热偏向 {d.natureBias > 0 ? `+${d.natureBias}（偏温）` : d.natureBias < 0 ? `${d.natureBias}（偏寒）` : '0（平）'}
                </span>
              </div>
              <table className="mt-1 w-full text-xs">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th className="py-0.5">药味</th>
                    <th>角色</th>
                    <th>基准</th>
                    <th>系数</th>
                    <th>实配</th>
                    <th>调整说明</th>
                  </tr>
                </thead>
                <tbody>
                  {d.composition.map((h) => (
                    <tr key={h.herbId} className="border-t border-amber-900/10">
                      <td className="py-0.5">{h.name}</td>
                      <td>{ROLE_LABEL[h.role]}</td>
                      <td>{h.baseGrams}g</td>
                      <td>{h.factor}</td>
                      <td className="font-semibold">{h.grams}g</td>
                      <td className="text-stone-500">{h.adjustment ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      {result.efficacy.length > 0 && (
        <section className="rounded-lg border border-amber-900/40 bg-[#f5deb3]/95 p-3 text-stone-800">
          <h3 className="font-serif text-lg font-bold text-amber-900">疗效预估</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {result.efficacy.map((e) => (
              <div key={e.formulaId} className="rounded border border-amber-900/30 bg-amber-50/60 p-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{e.name}</span>
                  <span className="text-amber-800">{e.effectiveRate}%</span>
                </div>
                <p className="mt-0.5 text-xs text-stone-500">
                  预估疗程 {e.estimatedCourses} 剂 · 体质相合度 {e.constitutionFit}
                </p>
                {e.riskNotes.length > 0 && (
                  <p className="mt-0.5 text-xs text-red-700">{e.riskNotes.join('；')}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
