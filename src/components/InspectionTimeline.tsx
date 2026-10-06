import type { ClearanceConclusion, Inspection, Ship } from '@/domain/types';
import { isInspectionStale } from '@/domain/recompute';
import { DecisionBadge } from './badges';
import AdjudicationForm from './AdjudicationForm';

interface Props {
  ship: Ship;
  onLocate: (lineKey: string, cargoItemId: string | null) => void;
}

const fmtTime = (t: number | null) =>
  t === null ? '—' : new Date(t).toLocaleString('zh-CN', { hour12: false });

function LineDiff({
  before,
  after,
  onLocate,
}: {
  before: ClearanceConclusion;
  after: ClearanceConclusion;
  onLocate: Props['onLocate'];
}) {
  const keys = new Set([...before.lines.map((l) => l.key), ...after.lines.map((l) => l.key)]);
  const rows = [...keys]
    .map((key) => {
      const b = before.lines.find((l) => l.key === key) ?? null;
      const a = after.lines.find((l) => l.key === key) ?? null;
      return { key, b, a };
    })
    .filter(
      ({ b, a }) =>
        !b ||
        !a ||
        b.quantity !== a.quantity ||
        b.category !== a.category ||
        b.tax !== a.tax ||
        b.name !== a.name,
    );

  if (rows.length === 0) {
    return <p className="mt-2 text-sm text-[#8b4513]">本轮裁定未改动任何计征条目（仅补充记录）。</p>;
  }

  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="border-b border-[#c9b78c] text-left text-[#6b3a2a]">
          <th className="py-1 pr-2">条目</th>
          <th className="py-1 pr-2 text-right">裁定前</th>
          <th className="py-1 pr-2 text-right">裁定后</th>
          <th className="py-1 pr-2 text-right">税银变化</th>
          <th className="py-1 w-16" />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ key, b, a }) => (
          <tr key={key} className="border-b border-[#e8dcc0]">
            <td className="py-1.5 pr-2">{(a ?? b)!.name}</td>
            <td className="py-1.5 pr-2 text-right text-[#8b4513]">
              {b ? `${b.quantity}（${b.category}）` : '—'}
            </td>
            <td className="py-1.5 pr-2 text-right font-semibold">
              {a ? `${a.quantity}（${a.category}）` : '—'}
            </td>
            <td className="py-1.5 pr-2 text-right">
              {b ? b.tax.toFixed(2) : '—'} → {a ? a.tax.toFixed(2) : '—'}
            </td>
            <td className="py-1.5 text-right">
              <button
                onClick={() => onLocate(key, (a ?? b)!.cargoItemId)}
                className="rounded-md border border-[#1a5276] px-2 py-0.5 text-xs text-[#1a5276] hover:bg-[#1a527611]"
              >
                定位
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InspectionCard({ ship, inspection, onLocate }: { ship: Ship; inspection: Inspection; onLocate: Props['onLocate'] }) {
  const stale = isInspectionStale(inspection, ship);
  return (
    <div className="rounded-md border border-[#c9b78c] bg-[#fffdf5] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#6b3a2a]">第 {inspection.seq} 轮抽检</span>
          {inspection.status === 'pending' ? (
            <span className="rounded-md bg-[#b9770e] px-2 py-0.5 text-xs text-white">待裁定</span>
          ) : (
            <span className="rounded-md bg-[#1a5276] px-2 py-0.5 text-xs text-white">已裁定</span>
          )}
          {stale && (
            <span className="rounded-md bg-[#922b21] px-2 py-0.5 text-xs text-white">
              裁定后货单已变更
            </span>
          )}
        </div>
        <div className="text-xs text-[#8b4513]">
          发起 {fmtTime(inspection.initiatedAt)} · 货单 v{inspection.basisManifestVersion}
          {inspection.adjudicatedAt !== null && ` · 裁定 ${fmtTime(inspection.adjudicatedAt)}`}
        </div>
      </div>

      {inspection.status === 'pending' && (
        <AdjudicationForm ship={ship} inspection={inspection} />
      )}

      {inspection.status === 'adjudicated' && (
        <div className="mt-3 space-y-3">
          {inspection.findings.length === 0 ? (
            <p className="text-sm text-[#8b4513]">抽检无异常，维持原结论。</p>
          ) : (
            <div>
              <h4 className="text-sm font-bold text-[#6b3a2a]">抽检发现（双方记录并存）</h4>
              <ul className="mt-1 space-y-1 text-sm">
                {inspection.findings.map((f) => (
                  <li key={f.id} className="rounded bg-[#f5e6c8] px-2 py-1">
                    {f.kind === 'new_item' ? (
                      <span>
                        <b className="text-[#922b21]">补充</b> 货单未载：
                        {f.observed.name} {f.observed.quantity}（{f.observed.category}）
                      </span>
                    ) : (
                      <span>
                        <b className="text-[#922b21]">推翻</b> {f.observed.name}：
                        货单记 {f.declared?.quantity}（{f.declared?.category}），
                        实测 {f.observed.quantity}（{f.observed.category}）
                      </span>
                    )}
                    {f.note && <span className="ml-2 text-xs text-[#8b4513]">— {f.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {inspection.conclusionBefore && inspection.conclusionAfter && (
            <div>
              <h4 className="text-sm font-bold text-[#6b3a2a]">裁定前后结论对比</h4>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                <span>
                  结论：
                  <DecisionBadge decision={inspection.conclusionBefore.decision} />
                  <span className="mx-1 text-[#8b4513]">→</span>
                  <DecisionBadge decision={inspection.conclusionAfter.decision} />
                </span>
                <span>
                  税银：
                  <span className="text-[#8b4513]">{inspection.conclusionBefore.totalTax.toFixed(2)}</span>
                  <span className="mx-1 text-[#8b4513]">→</span>
                  <span className="font-bold text-[#e67e22]">
                    {inspection.conclusionAfter.totalTax.toFixed(2)}
                  </span>
                  两
                </span>
              </div>
              <LineDiff
                before={inspection.conclusionBefore}
                after={inspection.conclusionAfter}
                onLocate={onLocate}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function InspectionTimeline({ ship, onLocate }: Props) {
  const ordered = [...ship.inspections].sort((a, b) => a.seq - b.seq);
  return (
    <section className="rounded-lg border-2 border-[#8b4513] bg-white p-4">
      <h2 className="mb-3 text-base font-bold text-[#6b3a2a]">
        抽检裁定记录 <span className="text-xs font-normal text-[#8b4513]">按裁定时刻依次生效</span>
      </h2>
      {ordered.length === 0 ? (
        <p className="text-sm text-[#8b4513]">尚无抽检记录。</p>
      ) : (
        <div className="space-y-3">
          {ordered.map((inspection) => (
            <InspectionCard key={inspection.id} ship={ship} inspection={inspection} onLocate={onLocate} />
          ))}
        </div>
      )}
    </section>
  );
}
