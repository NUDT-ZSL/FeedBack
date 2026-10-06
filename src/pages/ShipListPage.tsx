import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { canEditSchedule } from '@/domain/inspection';
import { RULING_STATUS_LABEL, shipRulingStatus, type ShipRulingStatus } from '@/domain/status';
import { CARGO_CATEGORIES, ORIGINS, formatGuan, formatRate, formatTime } from '@/domain/tariff';
import type { CargoCategory, Origin, TariffSchedule } from '@/domain/types';
import { useCustomsStore } from '@/store/customsStore';
import { Badge, Btn, Card, Field, Notice, NumberInput, Select, TextInput } from '@/components/ui';
import { GradeBadge, RulingStatusBadge } from '@/components/StatusBadge';

type Filter = 'all' | ShipRulingStatus;

export default function ShipListPage() {
  const ships = useCustomsStore((s) => s.ships);
  const inspections = useCustomsStore((s) => s.inspections);
  const schedule = useCustomsStore((s) => s.schedule);
  const resetToSeed = useCustomsStore((s) => s.resetToSeed);
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(
    () =>
      ships
        .map((ship) => ({ ship, status: shipRulingStatus(ship.id, inspections) }))
        .filter((r) => filter === 'all' || r.status === filter)
        .sort((a, b) => a.ship.arrivedAt - b.ship.arrivedAt),
    [ships, inspections, filter],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-[#6b3a2a]">商船总览</h2>
        <Field label="按裁定状态筛选">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">全部</option>
            {(Object.keys(RULING_STATUS_LABEL) as ShipRulingStatus[]).map((k) => (
              <option key={k} value={k}>{RULING_STATUS_LABEL[k]}</option>
            ))}
          </Select>
        </Field>
        <span className="text-xs text-stone-500">共 {rows.length} 艘</span>
        <Btn
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            if (window.confirm('重置为示例数据？当前全部改动将丢失。')) resetToSeed();
          }}
        >
          重置示例数据
        </Btn>
      </div>

      <Card>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#8b4513]/30 text-left text-xs text-[#6b3a2a]">
              <th className="py-1 pr-2">船名</th>
              <th className="py-1 pr-2">船长</th>
              <th className="py-1 pr-2">船籍</th>
              <th className="py-1 pr-2 text-right">载重(石)</th>
              <th className="py-1 pr-2">入港</th>
              <th className="py-1 pr-2 text-right">应缴税银</th>
              <th className="py-1 pr-2">通关结论</th>
              <th className="py-1 pr-2">裁定状态</th>
              <th className="py-1 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ ship, status }) => (
              <tr key={ship.id} className="border-b border-[#8b4513]/10 hover:bg-[#ffd70022]">
                <td className="py-1.5 pr-2 font-medium">⛵ {ship.name}</td>
                <td className="py-1.5 pr-2">{ship.captain}</td>
                <td className="py-1.5 pr-2">{ship.origin}</td>
                <td className="py-1.5 pr-2 text-right">{ship.tonnage}</td>
                <td className="py-1.5 pr-2 text-xs text-stone-500">{formatTime(ship.arrivedAt)}</td>
                <td className="py-1.5 pr-2 text-right text-[#e67e22]">
                  {ship.conclusion ? formatGuan(ship.conclusion.totalDuty) : '—'}
                </td>
                <td className="py-1.5 pr-2"><GradeBadge grade={ship.conclusion?.grade ?? null} /></td>
                <td className="py-1.5 pr-2"><RulingStatusBadge status={status} /></td>
                <td className="py-1.5 text-right">
                  <Link to={`/ships/${ship.id}`} className="text-[#1a5276] underline-offset-2 hover:underline">
                    查看
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-4 text-center text-stone-400">该裁定状态下暂无商船</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <NewShipCard />
        <ScheduleCard schedule={schedule} />
      </div>
    </div>
  );
}

function NewShipCard() {
  const addShip = useCustomsStore((s) => s.addShip);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [captain, setCaptain] = useState('');
  const [origin, setOrigin] = useState<Origin>('三佛齐');
  const [tonnage, setTonnage] = useState(500);
  const [message, setMessage] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim() || !captain.trim()) {
      setMessage('请填写船名与船长');
      return;
    }
    const id = addShip({ name: name.trim(), captain: captain.trim(), origin, tonnage });
    navigate(`/ships/${id}`);
  };

  return (
    <Card title="新船入港登记">
      {message && <div className="mb-2"><Notice tone="red">{message}</Notice></div>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Field label="船名">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="船长">
          <TextInput value={captain} onChange={(e) => setCaptain(e.target.value)} />
        </Field>
        <Field label="船籍">
          <Select value={origin} onChange={(e) => setOrigin(e.target.value as Origin)}>
            {ORIGINS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </Field>
        <Field label="载重(石)">
          <NumberInput value={tonnage} min={0} onChange={(e) => setTonnage(Number(e.target.value))} />
        </Field>
        <div className="flex items-end">
          <Btn onClick={submit}>登记入港</Btn>
        </div>
      </div>
    </Card>
  );
}

function ScheduleCard({ schedule }: { schedule: TariffSchedule }) {
  const inspections = useCustomsStore((s) => s.inspections);
  const updateSchedule = useCustomsStore((s) => s.updateSchedule);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TariffSchedule>(schedule);
  const [message, setMessage] = useState<string | null>(null);
  const guard = canEditSchedule(inspections);

  const save = () => {
    const r = updateSchedule(draft);
    if (r.ok) {
      setEditing(false);
      setMessage(null);
    } else {
      setMessage(r.reason ?? '口径冻结');
    }
  };

  return (
    <Card
      title={`关税口径 v${schedule.version}`}
      extra={
        !editing ? (
          <Btn variant="ghost" className="px-2 py-0.5 text-xs" disabled={!guard.ok} title={guard.ok ? undefined : guard.reason} onClick={() => { setDraft(schedule); setEditing(true); }}>
            调整口径
          </Btn>
        ) : undefined
      }
    >
      {!guard.ok && !editing && <div className="mb-2"><Notice tone="amber">{guard.reason}</Notice></div>}
      {message && <div className="mb-2"><Notice tone="red">{message}</Notice></div>}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold text-[#6b3a2a]">类别基础税率</p>
          <ul className="space-y-1 text-sm">
            {CARGO_CATEGORIES.map((c: CargoCategory) => (
              <li key={c} className="flex items-center justify-between gap-2">
                <span>{c}</span>
                {editing ? (
                  <NumberInput
                    className="w-20"
                    value={Math.round(draft.categoryRates[c] * 10000) / 100}
                    min={0}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        categoryRates: { ...draft.categoryRates, [c]: Number(e.target.value) / 100 },
                      })
                    }
                  />
                ) : (
                  <Badge tone="brown">{formatRate(schedule.categoryRates[c])}</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-[#6b3a2a]">船籍加减（百分点）</p>
          <ul className="space-y-1 text-sm">
            {ORIGINS.map((o: Origin) => (
              <li key={o} className="flex items-center justify-between gap-2">
                <span>{o}</span>
                {editing ? (
                  <NumberInput
                    className="w-20"
                    value={Math.round(draft.originAdjust[o] * 10000) / 100}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        originAdjust: { ...draft.originAdjust, [o]: Number(e.target.value) / 100 },
                      })
                    }
                  />
                ) : (
                  <Badge tone="indigo">
                    {schedule.originAdjust[o] > 0 ? `+${formatRate(schedule.originAdjust[o])}` : formatRate(schedule.originAdjust[o])}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {editing && (
        <div className="mt-3 flex gap-2">
          <Btn onClick={save}>颁行新口径</Btn>
          <Btn variant="ghost" onClick={() => { setEditing(false); setMessage(null); }}>取消</Btn>
          <span className="self-center text-xs text-stone-500">颁行后所有已验讫商船整船从头重算</span>
        </div>
      )}
    </Card>
  );
}
