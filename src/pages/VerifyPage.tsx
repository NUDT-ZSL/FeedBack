import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { verifyAll, type ShipVerifyReport } from '@/domain/verify';
import { formatGuan, formatTime } from '@/domain/tariff';
import { useCustomsStore } from '@/store/customsStore';
import { Badge, Btn, Card, Notice } from '@/components/ui';

export default function VerifyPage() {
  const ships = useCustomsStore((s) => s.ships);
  const inspections = useCustomsStore((s) => s.inspections);
  const schedule = useCustomsStore((s) => s.schedule);
  const [runAt, setRunAt] = useState<number | null>(null);
  const [reports, setReports] = useState<ShipVerifyReport[]>([]);

  const run = () => {
    const now = Date.now();
    setReports(verifyAll(ships, inspections, schedule, now));
    setRunAt(now);
  };

  const summary = useMemo(() => {
    if (reports.length === 0) return null;
    const pass = reports.filter((r) => r.ok).length;
    const frozen = reports.filter((r) => r.frozen).length;
    const failed = reports.length - pass;
    return { pass, frozen, failed };
  }, [reports]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-[#6b3a2a]">一致性核验</h2>
        <Btn variant="indigo" onClick={run}>{reports.length === 0 ? '开始批量核验' : '重新核验'}</Btn>
        {runAt && <span className="text-xs text-stone-500">核验时刻：{formatTime(runAt)}</span>}
      </div>

      <Notice tone="indigo">
        抽检裁定与结论重推的统一验证入口：对每艘商船以当前货单 + 当前关税口径（v{schedule.version}）从头重算整船通关结论，
        与存档结论逐条比对（税银、税率、通关结论、口径版本）；并逐轮检查裁定依据快照、落地结论与「货单已变更」标记。
        抽检待裁定期间结论冻结，仅检裁定记录。
      </Notice>

      {summary && (
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">通过 {summary.pass} 艘</Badge>
          <Badge tone="red">异常 {summary.failed} 艘</Badge>
          <Badge tone="amber">结论冻结 {summary.frozen} 艘</Badge>
          <Badge tone="gray">共 {reports.length} 艘</Badge>
        </div>
      )}

      {reports.length === 0 && <Card><p className="text-sm text-stone-500">点击「开始批量核验」核对全部 {ships.length} 艘商船。</p></Card>}

      <div className="space-y-3">
        {reports.map((r) => (
          <Card key={r.shipId}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-[#6b3a2a]">⛵ {r.shipName}</span>
              {r.ok ? <Badge tone="green">核验通过</Badge> : <Badge tone="red">核验异常</Badge>}
              {r.frozen && <Badge tone="amber">抽检待裁定，结论冻结</Badge>}
              <Link to={`/ships/${r.shipId}`} className="ml-auto text-xs text-[#1a5276] hover:underline">
                前往商船详情 →
              </Link>
            </div>

            {r.actual && !r.frozen && (
              <div className="mt-2 text-sm">
                <span className="text-stone-600">存档结论：</span>
                <span className="text-[#e67e22]">{formatGuan(r.actual.totalDuty)}</span>
                {' · '}
                <span className="text-stone-600">从头重推：</span>
                <span className={r.diffs.length === 0 ? 'text-green-700' : 'text-red-700'}>
                  {r.expected ? formatGuan(r.expected.totalDuty) : '—'}
                </span>
              </div>
            )}

            {r.diffs.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-sm text-red-800">
                {r.diffs.map((d, idx) => <li key={idx}>{d}</li>)}
              </ul>
            )}

            {r.rulingChecks.length > 0 && (
              <div className="mt-2 space-y-1">
                {r.rulingChecks.map((c) => (
                  <div key={c.inspectionId} className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={c.ok ? 'indigo' : 'red'}>第 {c.round} 轮裁定</Badge>
                    {c.ok ? (
                      <span className="text-xs text-green-700">依据快照完好，货单变更标记正确</span>
                    ) : (
                      c.issues.map((iss) => (
                        <span key={iss} className="text-xs text-red-800">✗ {iss}</span>
                      ))
                    )}
                  </div>
                ))}
              </div>
            )}

            {r.ok && r.diffs.length === 0 && r.rulingChecks.length === 0 && !r.frozen && (
              <p className="mt-2 text-xs text-stone-500">存档结论与从头重推一致，无裁定记录。</p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
