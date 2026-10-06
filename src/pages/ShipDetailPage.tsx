import { useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '@/store/useStore';
import { pendingOf } from '@/domain/recompute';
import { verifyShip } from '@/domain/verify';
import ConclusionPanel from '@/components/ConclusionPanel';
import ManifestEditor from '@/components/ManifestEditor';
import InspectionTimeline from '@/components/InspectionTimeline';
import { DecisionBadge } from '@/components/badges';

export default function ShipDetailPage() {
  const { shipId } = useParams();
  const ship = useStore((s) => s.ships.find((x) => x.id === shipId));
  const rules = useStore((s) => s.rules);
  const initiateInspection = useStore((s) => s.initiateInspection);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checks, setChecks] = useState<ReturnType<typeof verifyShip> | null>(null);

  const locate = useCallback((lineKey: string, cargoItemId: string | null) => {
    const target = document.getElementById(`line-${lineKey}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightKey(lineKey);
    if (cargoItemId) {
      window.setTimeout(() => setHighlightKey(`cargo:${cargoItemId}`), 1200);
    }
    window.setTimeout(() => setHighlightKey(null), 3600);
  }, []);

  if (!ship) {
    return (
      <div className="rounded-lg border-2 border-[#8b4513] bg-white p-8 text-center">
        <p className="text-[#8b4513]">未找到该商船。</p>
        <Link to="/" className="text-[#1a5276] underline">返回在港商船</Link>
      </div>
    );
  }

  const pending = pendingOf(ship);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border-2 border-[#8b4513] bg-[#f5e6c8] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-[#6b3a2a]">⛵ {ship.name}</h2>
              <DecisionBadge decision={ship.conclusion.decision} />
            </div>
            <p className="mt-1 text-sm text-[#8b4513]">
              船籍 {ship.registry} · 来路 {ship.origin} · 船长 {ship.captain} ·
              入港 {new Date(ship.arrivedAt).toLocaleString('zh-CN', { hour12: false })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={!!pending}
              title={pending ? `第 ${pending.seq} 轮抽检待裁定，不得重复发起` : undefined}
              onClick={() => {
                const r = initiateInspection(ship.id);
                setNotice(r.ok ? `已发起第 ${ship.inspections.length + 1} 轮抽检` : r.ok === false ? r.error : null);
              }}
              className="rounded-md bg-gradient-to-b from-[#8b4513] to-[#6b3a2a] px-4 py-1.5 text-sm text-[#f5f0e0] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              发起抽检
            </button>
            <button
              onClick={() => setChecks(verifyShip(ship, rules))}
              className="rounded-md bg-gradient-to-b from-[#1a5276] to-[#154360] px-4 py-1.5 text-sm text-white transition hover:brightness-110"
            >
              核验本船
            </button>
            <Link
              to="/"
              className="rounded-md border border-[#8b4513] px-3 py-1.5 text-sm text-[#8b4513] hover:bg-[#ffd70022]"
            >
              返回
            </Link>
          </div>
        </div>
        {notice && <p className="mt-2 rounded bg-white/60 px-2 py-1 text-sm text-[#6b3a2a]">{notice}</p>}
      </section>

      {checks && (
        <section className="rounded-lg border-2 border-[#1a5276] bg-white p-4">
          <h3 className="mb-2 text-sm font-bold text-[#1a5276]">本船核验</h3>
          <ul className="space-y-1 text-sm">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <span className={c.pass ? 'text-[#1a5276]' : 'text-[#922b21]'}>
                  {c.pass ? '✓' : '✗'}
                </span>
                <span>
                  <b>{c.title}</b>：{c.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConclusionPanel conclusion={ship.conclusion} highlightKey={highlightKey} />
      <ManifestEditor ship={ship} highlightKey={highlightKey} />
      <InspectionTimeline ship={ship} onLocate={locate} />
    </div>
  );
}
