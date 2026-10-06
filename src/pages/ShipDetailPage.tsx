import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { canEditManifest, inspectionsOf } from '@/domain/inspection';
import { formatTime } from '@/domain/tariff';
import { useCustomsStore } from '@/store/customsStore';
import { ConclusionView } from '@/components/ConclusionView';
import { InspectionPanel } from '@/components/InspectionPanel';
import { ManifestTable } from '@/components/ManifestTable';
import { RulingCompare } from '@/components/RulingCompare';
import { RulingStatusBadge } from '@/components/StatusBadge';
import { shipRulingStatus } from '@/domain/status';
import { Badge, Btn, Card, Notice } from '@/components/ui';

export default function ShipDetailPage() {
  const { shipId } = useParams<{ shipId: string }>();
  const ship = useCustomsStore((s) => s.ships.find((x) => x.id === shipId));
  const inspections = useCustomsStore((s) => s.inspections);
  const recompute = useCustomsStore((s) => s.recompute);
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  if (!ship) {
    return (
      <Notice tone="red">
        查无此船。<Link to="/" className="underline">返回商船总览</Link>
      </Notice>
    );
  }

  const shipInspections = inspectionsOf(inspections, ship.id);
  const adjudicated = shipInspections.filter((i) => i.ruling);
  const manifestGuard = canEditManifest(inspections, ship.id);
  const status = shipRulingStatus(ship.id, inspections);

  const locateEntry = (entryId: string) => {
    setFocusEntryId(entryId);
    document.getElementById(`cargo-${entryId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFocusEntryId(null), 2500);
  };

  const doRecompute = () => {
    const r = recompute(ship.id);
    setMessage(r.ok ? null : r.reason ?? '无法验讫');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-sm text-[#1a5276] hover:underline">← 商船总览</Link>
        <h2 className="text-lg font-bold text-[#6b3a2a]">⛵ {ship.name}</h2>
        <RulingStatusBadge status={status} />
        <Badge tone="gray">货单 v{ship.manifestVersion}</Badge>
      </div>

      <Card>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>船长：{ship.captain}</span>
          <span>船籍：{ship.origin}</span>
          <span>载重：{ship.tonnage} 石</span>
          <span>入港：{formatTime(ship.arrivedAt)}</span>
        </div>
      </Card>

      {message && <Notice tone="red">{message}</Notice>}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="货单">
          <ManifestTable
            ship={ship}
            locked={!manifestGuard.ok}
            lockReason={manifestGuard.reason}
            focusEntryId={focusEntryId}
          />
        </Card>
        <div className="space-y-4">
          <Card
            title="通关结论"
            extra={
              <Btn
                variant="ghost"
                className="px-2 py-0.5 text-xs"
                disabled={!manifestGuard.ok}
                title={manifestGuard.ok ? undefined : manifestGuard.reason}
                onClick={doRecompute}
              >
                {ship.conclusion ? '重新验讫' : '验讫'}
              </Btn>
            }
          >
            <ConclusionView conclusion={ship.conclusion} onLocateEntry={locateEntry} />
          </Card>
          <Card title="抽检裁定">
            <InspectionPanel ship={ship} inspections={inspections} />
          </Card>
        </div>
      </div>

      {adjudicated.length > 0 && (
        <Card title={`裁定历史（${adjudicated.length} 轮，按落地时刻先后生效）`}>
          <div className="space-y-3">
            {adjudicated.map((i) => (
              <RulingCompare key={i.id} inspection={i} onLocateEntry={locateEntry} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
