import { useState } from 'react';
import { conclusionOverturned } from '@/domain/status';
import { formatGuan, formatTime, round2 } from '@/domain/tariff';
import type { CargoEntry, Inspection } from '@/domain/types';
import { Badge, Btn } from './ui';
import { GradeBadge } from './StatusBadge';

function findEntry(list: CargoEntry[], id: string | null | undefined): CargoEntry | undefined {
  return id ? list.find((e) => e.id === id) : undefined;
}

export function RulingCompare({
  inspection,
  onLocateEntry,
}: {
  inspection: Inspection;
  onLocateEntry: (entryId: string) => void;
}) {
  const ruling = inspection.ruling!;
  const [showBasis, setShowBasis] = useState(false);
  const overturned = conclusionOverturned(ruling);
  const before = ruling.conclusionBefore;
  const after = ruling.conclusionAfter;
  const dutyDelta = round2(after.totalDuty - (before?.totalDuty ?? 0));

  return (
    <div className="space-y-3 rounded border border-[#8b4513]/25 bg-white/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[#6b3a2a]">第 {inspection.round} 轮裁定</span>
        <span className="text-xs text-stone-500">{formatTime(ruling.adjudicatedAt)} 落地</span>
        {overturned ? <Badge tone="red">推翻了此前结论</Badge> : <Badge tone="green">维持原结论</Badge>}
        {ruling.manifestChangedAfter && <Badge tone="amber">货单已于裁定后变更</Badge>}
        <Badge tone="gray">依据货单 v{ruling.basisManifestVersion}</Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded border border-[#8b4513]/20 bg-[#fdf9ee] p-2">
          <p className="mb-1 text-xs font-semibold text-stone-500">裁定前</p>
          {before ? (
            <div className="flex items-center gap-2 text-sm">
              <GradeBadge grade={before.grade} />
              <span>税银 {formatGuan(before.totalDuty)}</span>
              <Badge tone="brown">口径 v{before.scheduleVersion}</Badge>
            </div>
          ) : (
            <p className="text-sm text-stone-400">此前未验讫</p>
          )}
        </div>
        <div className="rounded border border-[#8b4513]/20 bg-[#fdf9ee] p-2">
          <p className="mb-1 text-xs font-semibold text-stone-500">裁定后（整船从头重推）</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <GradeBadge grade={after.grade} />
            <span>税银 {formatGuan(after.totalDuty)}</span>
            {dutyDelta !== 0 && (
              <span className={dutyDelta > 0 ? 'text-red-700' : 'text-green-700'}>
                {dutyDelta > 0 ? `+${dutyDelta}` : dutyDelta} 贯
              </span>
            )}
            <Badge tone="brown">口径 v{after.scheduleVersion}</Badge>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-[#6b3a2a]">逐条定夺</p>
        <ul className="space-y-1">
          {ruling.decisions.map((d) => {
            const finding = inspection.findings.find((f) => f.id === d.findingId);
            if (!finding) return null;
            const target = findEntry(ruling.basisManifest, finding.targetEntryId);
            const inspectionEntryId = `${finding.id}-entry`;
            return (
              <li key={d.findingId} className="flex flex-wrap items-center gap-2 text-sm">
                {d.action === 'adopt-inspection' && (
                  <>
                    <Badge tone="red">货单条目被推翻</Badge>
                    <span>
                      「{finding.name}」货单 {target ? `${target.quantity} × ${target.unitValue}` : '?'} 贯 → 抽检实测{' '}
                      {finding.quantity} × {finding.unitValue} 贯
                    </span>
                    {target && (
                      <Btn variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => onLocateEntry(target.id)}>
                        定位原条目
                      </Btn>
                    )}
                    <Btn variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => onLocateEntry(inspectionEntryId)}>
                      定位实测条目
                    </Btn>
                  </>
                )}
                {d.action === 'keep-manifest' && (
                  <>
                    <Badge tone="green">维持货单</Badge>
                    <span>
                      「{finding.name}」仍依货单 {target ? `${target.quantity} × ${target.unitValue}` : '?'} 贯，抽检实测{' '}
                      {finding.quantity} × {finding.unitValue} 贯留档
                    </span>
                    {target && (
                      <Btn variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => onLocateEntry(target.id)}>
                        定位货单条目
                      </Btn>
                    )}
                    <Btn variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => onLocateEntry(inspectionEntryId)}>
                      定位留档实测
                    </Btn>
                  </>
                )}
                {d.action === 'add-entry' && (
                  <>
                    <Badge tone="amber">新货登记</Badge>
                    <span>
                      「{finding.name}」{finding.quantity} × {finding.unitValue} 贯补行入册
                    </span>
                    <Btn variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => onLocateEntry(inspectionEntryId)}>
                      定位条目
                    </Btn>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {ruling.note && <p className="text-xs text-stone-600">裁定缘由：{ruling.note}</p>}

      <div>
        <Btn variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => setShowBasis((v) => !v)}>
          {showBasis ? '收起裁定依据' : '查看裁定依据（货单快照）'}
        </Btn>
        {showBasis && (
          <table className="mt-2 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#8b4513]/20 text-left text-stone-500">
                <th className="py-1 pr-2">货名</th>
                <th className="py-1 pr-2">类别</th>
                <th className="py-1 pr-2 text-right">数量</th>
                <th className="py-1 pr-2 text-right">估值(贯)</th>
                <th className="py-1 pr-2">来源</th>
                <th className="py-1">当时状态</th>
              </tr>
            </thead>
            <tbody>
              {ruling.basisManifest.map((e) => (
                <tr key={e.id} className="border-b border-[#8b4513]/10">
                  <td className="py-1 pr-2">{e.name}</td>
                  <td className="py-1 pr-2">{e.category}</td>
                  <td className="py-1 pr-2 text-right">{e.quantity}</td>
                  <td className="py-1 pr-2 text-right">{e.unitValue}</td>
                  <td className="py-1 pr-2">{e.source === 'inspection' ? '抽检实测' : '货单登记'}</td>
                  <td className="py-1">
                    {e.status === 'active' ? '有效' : e.status === 'disputed' ? '冲突待裁' : '已被取代'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
