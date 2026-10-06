import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { rulingStatusOf, useStore, type RulingFilter } from '@/store/useStore';
import { verifyAll, type CheckResult } from '@/domain/verify';
import { DecisionBadge, RulingStatusBadge } from '@/components/badges';

const RULING_FILTER_OPTIONS: { value: RulingFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待裁定' },
  { value: 'adjudicated', label: '已裁定' },
  { value: 'stale', label: '货单已变更' },
  { value: 'none', label: '无抽检' },
];

export default function ShipListPage() {
  const ships = useStore((s) => s.ships);
  const rules = useStore((s) => s.rules);
  const [filter, setFilter] = useState<RulingFilter>('all');
  const [batch, setBatch] = useState<CheckResult[] | null>(null);

  const filtered = useMemo(
    () => (filter === 'all' ? ships : ships.filter((s) => rulingStatusOf(s) === filter)),
    [ships, filter],
  );

  const batchSummary = useMemo(() => {
    if (!batch) return null;
    const failed = batch.filter((c) => !c.pass);
    return { total: batch.length, failed: failed.length };
  }, [batch]);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border-2 border-[#8b4513] bg-[#f5e6c8] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {RULING_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`rounded-md px-3 py-1 text-sm transition-all ${
                  filter === opt.value
                    ? 'bg-gradient-to-b from-[#8b4513] to-[#6b3a2a] text-[#f5f0e0]'
                    : 'border border-[#8b4513] text-[#8b4513] hover:brightness-110'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {batchSummary && (
              <span
                className={`rounded-md px-2 py-1 text-sm ${
                  batchSummary.failed === 0
                    ? 'bg-[#1a5276] text-white'
                    : 'bg-[#922b21] text-white'
                }`}
              >
                批量核验 {batchSummary.total - batchSummary.failed}/{batchSummary.total} 通过
              </span>
            )}
            <button
              onClick={() => setBatch(verifyAll(ships, rules))}
              className="rounded-md bg-gradient-to-b from-[#1a5276] to-[#154360] px-4 py-1.5 text-sm text-white transition hover:brightness-110"
            >
              批量核验全部商船
            </button>
            <Link
              to="/verify"
              className="rounded-md border border-[#1a5276] px-3 py-1 text-sm text-[#1a5276] hover:bg-[#1a527611]"
            >
              边界场景核验
            </Link>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border-2 border-[#8b4513] bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#6b3a2a] text-[#f5deb3]">
            <tr>
              <th className="px-4 py-2 text-left">商船</th>
              <th className="px-4 py-2 text-left">船籍 / 来路</th>
              <th className="px-4 py-2 text-left">船长</th>
              <th className="px-4 py-2 text-right">货值（两）</th>
              <th className="px-4 py-2 text-right">应征税银（两）</th>
              <th className="px-4 py-2 text-center">通关结论</th>
              <th className="px-4 py-2 text-center">裁定状态</th>
              <th className="px-4 py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ship) => {
              const value = ship.conclusion.lines.reduce(
                (sum, l) => sum + l.quantity * l.unitPrice,
                0,
              );
              return (
                <tr
                  key={ship.id}
                  className="border-t border-[#d5c9a1] transition-colors hover:bg-[#ffd70022]"
                >
                  <td className="px-4 py-2 font-semibold text-[#6b3a2a]">⛵ {ship.name}</td>
                  <td className="px-4 py-2">
                    {ship.registry} · {ship.origin}
                  </td>
                  <td className="px-4 py-2">{ship.captain}</td>
                  <td className="px-4 py-2 text-right">{value.toFixed(1)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-[#e67e22]">
                    {ship.conclusion.totalTax.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <DecisionBadge decision={ship.conclusion.decision} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <RulingStatusBadge status={rulingStatusOf(ship)} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <Link
                      to={`/ships/${ship.id}`}
                      className="rounded-md bg-gradient-to-b from-[#8b4513] to-[#6b3a2a] px-3 py-1 text-xs text-[#f5f0e0] transition hover:brightness-110"
                    >
                      查验
                    </Link>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-[#8b4513]">
                  当前筛选下无商船
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {batch && (
        <section className="rounded-lg border-2 border-[#8b4513] bg-white p-4">
          <h2 className="mb-3 text-base font-bold text-[#6b3a2a]">批量核验结果</h2>
          <div className="grid gap-2 md:grid-cols-2">
            {batch.map((c) => (
              <div
                key={c.id}
                className={`rounded-md border p-3 text-sm ${
                  c.pass ? 'border-[#1a527644] bg-[#1a52760a]' : 'border-[#922b2166] bg-[#922b210a]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[#6b3a2a]">
                    {c.group} · {c.title}
                  </span>
                  <span className={c.pass ? 'text-[#1a5276]' : 'text-[#922b21]'}>
                    {c.pass ? '通过' : '不通过'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#5d4b3a]">{c.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
