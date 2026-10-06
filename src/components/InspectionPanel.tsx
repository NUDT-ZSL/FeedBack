import { useMemo, useState } from 'react';
import { activeEntries } from '@/domain/clearance';
import { pendingInspectionOf } from '@/domain/inspection';
import { formatTime } from '@/domain/tariff';
import type { CargoCategory, Inspection, RulingAction, Ship } from '@/domain/types';
import { useCustomsStore } from '@/store/customsStore';
import { Badge, Btn, Field, Notice, NumberInput, Select, TextArea, TextInput } from './ui';

export function InspectionPanel({ ship, inspections }: { ship: Ship; inspections: Inspection[] }) {
  const initiateInspection = useCustomsStore((s) => s.initiateInspection);
  const [message, setMessage] = useState<string | null>(null);
  const pending = pendingInspectionOf(inspections, ship.id);

  const initiate = () => {
    const r = initiateInspection(ship.id);
    setMessage(r.ok ? null : r.reason ?? '无法发起抽检');
  };

  return (
    <div className="space-y-3">
      {message && <Notice tone="red">{message}</Notice>}
      {!pending && (
        <div className="flex flex-wrap items-center gap-3">
          <Btn variant="indigo" onClick={initiate}>
            发起抽检
          </Btn>
          <span className="text-xs text-stone-500">
            发起后货单与关税口径即行封存，裁定落地前不得修改，亦不得再次发起。
          </span>
        </div>
      )}
      {pending && <PendingInspection ship={ship} inspection={pending} />}
    </div>
  );
}

function PendingInspection({ ship, inspection }: { ship: Ship; inspection: Inspection }) {
  const addFinding = useCustomsStore((s) => s.addFinding);
  const removeFinding = useCustomsStore((s) => s.removeFinding);
  const adjudicateInspection = useCustomsStore((s) => s.adjudicateInspection);

  const active = useMemo(() => activeEntries(ship.manifest), [ship.manifest]);
  const [targetEntryId, setTargetEntryId] = useState<string>('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CargoCategory>('香料');
  const [quantity, setQuantity] = useState(1);
  const [unitValue, setUnitValue] = useState(1);
  const [note, setNote] = useState('');
  const [decisions, setDecisions] = useState<Record<string, RulingAction>>({});
  const [rulingNote, setRulingNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const pickTarget = (id: string) => {
    setTargetEntryId(id);
    const target = active.find((e) => e.id === id);
    if (target) {
      setName(target.name);
      setCategory(target.category);
      setQuantity(target.quantity);
      setUnitValue(target.unitValue);
    }
  };

  const submitFinding = () => {
    if (!name.trim()) {
      setMessage('请填写实测货名');
      return;
    }
    addFinding(inspection.id, {
      targetEntryId: targetEntryId || null,
      name: name.trim(),
      category,
      quantity,
      unitValue,
      note: note.trim(),
    });
    setTargetEntryId('');
    setName('');
    setQuantity(1);
    setUnitValue(1);
    setNote('');
    setMessage(null);
  };

  const decisionOf = (findingId: string, hasTarget: boolean): RulingAction =>
    decisions[findingId] ?? (hasTarget ? 'adopt-inspection' : 'add-entry');

  const submitRuling = () => {
    const finalDecisions: Record<string, RulingAction> = {};
    for (const f of inspection.findings) finalDecisions[f.id] = decisionOf(f.id, f.targetEntryId !== null);
    const r = adjudicateInspection(inspection.id, finalDecisions, rulingNote.trim());
    setMessage(r.ok ? null : r.reason ?? '裁定失败');
    if (r.ok) {
      setDecisions({});
      setRulingNote('');
    }
  };

  return (
    <div className="space-y-4">
      <Notice tone="amber">
        第 {inspection.round} 轮抽检进行中（{formatTime(inspection.initiatedAt)} 发起）。货单与关税口径已封存，待裁定。
      </Notice>
      {message && <Notice tone="red">{message}</Notice>}

      <div>
        <h4 className="mb-2 text-sm font-semibold text-[#6b3a2a]">抽检记录（{inspection.findings.length}）</h4>
        {inspection.findings.length === 0 && <p className="text-sm text-stone-500">尚无记录，请在下方登记实测结果。</p>}
        <ul className="space-y-2">
          {inspection.findings.map((f) => {
            const target = f.targetEntryId ? ship.manifest.find((e) => e.id === f.targetEntryId) : undefined;
            return (
              <li key={f.id} className="rounded border border-[#8b4513]/20 bg-white/60 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="indigo">抽检实测</Badge>
                  <span>
                    {f.name}（{f.category}） 实点 {f.quantity} × {f.unitValue} 贯
                  </span>
                  {target && (
                    <span className="text-xs text-red-700">
                      与货单「{target.name} {target.quantity} × {target.unitValue} 贯」冲突，双方留档
                    </span>
                  )}
                  {!target && <Badge tone="amber">未申报新货</Badge>}
                  <Btn variant="ghost" className="ml-auto px-2 py-0.5 text-xs" onClick={() => removeFinding(inspection.id, f.id)}>
                    撤回
                  </Btn>
                </div>
                {f.note && <p className="mt-1 text-xs text-stone-500">{f.note}</p>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded border border-dashed border-[#1a5276]/40 bg-[#eef4f8] p-3">
        <p className="mb-2 text-xs font-semibold text-[#1a5276]">登记抽检实测</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <Field label="对应货单条目（冲突时选择）">
            <Select value={targetEntryId} onChange={(e) => pickTarget(e.target.value)}>
              <option value="">— 新发现货物 —</option>
              {active.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}（{e.quantity} × {e.unitValue} 贯）
                </option>
              ))}
            </Select>
          </Field>
          <Field label="实测货名">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="类别">
            <Select value={category} onChange={(e) => setCategory(e.target.value as CargoCategory)}>
              {(['香料', '药材', '珠宝', '丝绸', '瓷器', '杂货'] as CargoCategory[]).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="实测数量">
            <NumberInput value={quantity} min={0} onChange={(e) => setQuantity(Number(e.target.value))} />
          </Field>
          <Field label="实测单价(贯)">
            <NumberInput value={unitValue} min={0} onChange={(e) => setUnitValue(Number(e.target.value))} />
          </Field>
          <Field label="备注">
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="如：舱底夹藏" />
          </Field>
        </div>
        <div className="mt-2">
          <Btn variant="indigo" onClick={submitFinding}>登记实测</Btn>
        </div>
      </div>

      {inspection.findings.length > 0 && (
        <div className="rounded border border-[#8b4513]/30 bg-[#f5e6c8]/50 p-3">
          <p className="mb-2 text-xs font-semibold text-[#6b3a2a]">裁定（逐条定夺，落地后整船结论从头重推）</p>
          <ul className="space-y-2">
            {inspection.findings.map((f) => {
              const hasTarget = f.targetEntryId !== null;
              const value = decisionOf(f.id, hasTarget);
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium">{f.name}</span>
                  {hasTarget ? (
                    <>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="radio"
                          checked={value === 'adopt-inspection'}
                          onChange={() => setDecisions({ ...decisions, [f.id]: 'adopt-inspection' })}
                        />
                        采纳抽检实测
                      </label>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="radio"
                          checked={value === 'keep-manifest'}
                          onChange={() => setDecisions({ ...decisions, [f.id]: 'keep-manifest' })}
                        />
                        保留货单原记录
                      </label>
                    </>
                  ) : (
                    <Badge tone="amber">登记为新条目</Badge>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 space-y-2">
            <TextArea
              rows={2}
              placeholder="裁定缘由（如：夹藏属实，以实点为准）"
              value={rulingNote}
              onChange={(e) => setRulingNote(e.target.value)}
            />
            <Btn onClick={submitRuling}>落裁定</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
