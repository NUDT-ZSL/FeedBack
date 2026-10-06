import { useState } from 'react';
import type { CargoEntry, CargoCategory, OpResult, Ship } from '@/domain/types';
import { CARGO_CATEGORIES } from '@/domain/tariff';
import { cn } from '@/lib/utils';
import { useCustomsStore } from '@/store/customsStore';
import { Badge, Btn, Field, Notice, NumberInput, Select, TextInput } from './ui';

interface DraftEntry {
  name: string;
  category: CargoCategory;
  quantity: number;
  unitValue: number;
}

const EMPTY_DRAFT: DraftEntry = { name: '', category: '香料', quantity: 1, unitValue: 1 };

function SourceBadge({ entry }: { entry: CargoEntry }) {
  return entry.source === 'inspection' ? (
    <Badge tone="indigo">抽检实测</Badge>
  ) : (
    <Badge tone="brown">货单登记</Badge>
  );
}

function StatusBadge2({ status }: { status: CargoEntry['status'] }) {
  if (status === 'active') return <Badge tone="green">有效</Badge>;
  if (status === 'disputed') return <Badge tone="red">冲突待裁</Badge>;
  return <Badge tone="gray">已被取代</Badge>;
}

export function ManifestTable({
  ship,
  locked,
  lockReason,
  focusEntryId,
}: {
  ship: Ship;
  locked: boolean;
  lockReason?: string;
  focusEntryId: string | null;
}) {
  const addCargoEntry = useCustomsStore((s) => s.addCargoEntry);
  const updateCargoEntry = useCustomsStore((s) => s.updateCargoEntry);
  const removeCargoEntry = useCustomsStore((s) => s.removeCargoEntry);
  const [draft, setDraft] = useState<DraftEntry>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'red' | 'green'; text: string } | null>(null);

  const showResult = (r: OpResult) => {
    if (r.ok) {
      setMessage(null);
      return;
    }
    setMessage({ tone: 'red', text: r.reason ?? '操作被拒绝' });
  };

  const submit = () => {
    if (!draft.name.trim()) {
      setMessage({ tone: 'red', text: '请填写货名' });
      return;
    }
    const payload = { ...draft, name: draft.name.trim() };
    const result = editingId
      ? updateCargoEntry(ship.id, editingId, payload)
      : addCargoEntry(ship.id, payload);
    if (result.ok) {
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      setMessage(null);
    } else {
      showResult(result);
    }
  };

  const startEdit = (entry: CargoEntry) => {
    setEditingId(entry.id);
    setDraft({ name: entry.name, category: entry.category, quantity: entry.quantity, unitValue: entry.unitValue });
    setMessage(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <Badge tone="gray">货单版本 v{ship.manifestVersion}</Badge>
        <span>冲突双方各自保留并标记来源；被取代的条目留档可溯。</span>
      </div>

      {locked && <Notice tone="red">货单已封存：{lockReason ?? '抽检裁定完成前不得修改货单'}</Notice>}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[#8b4513]/30 text-left text-xs text-[#6b3a2a]">
            <th className="py-1 pr-2">货名</th>
            <th className="py-1 pr-2">类别</th>
            <th className="py-1 pr-2 text-right">数量</th>
            <th className="py-1 pr-2 text-right">估值(贯)</th>
            <th className="py-1 pr-2">来源</th>
            <th className="py-1 pr-2">状态</th>
            <th className="py-1 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {ship.manifest.map((e) => (
            <tr
              key={e.id}
              id={`cargo-${e.id}`}
              className={cn(
                'border-b border-[#8b4513]/10 transition-colors duration-300',
                focusEntryId === e.id && 'bg-[#ffd70033] ring-1 ring-inset ring-[#e67e22]',
              )}
            >
              <td className="py-1 pr-2">{e.name}</td>
              <td className="py-1 pr-2">{e.category}</td>
              <td className="py-1 pr-2 text-right">{e.quantity}</td>
              <td className="py-1 pr-2 text-right">{e.unitValue}</td>
              <td className="py-1 pr-2"><SourceBadge entry={e} /></td>
              <td className="py-1 pr-2"><StatusBadge2 status={e.status} /></td>
              <td className="py-1 text-right">
                {!locked && e.status === 'active' && (
                  <span className="inline-flex gap-1">
                    <Btn variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => startEdit(e)}>
                      修正
                    </Btn>
                    <Btn
                      variant="ghost"
                      className="px-2 py-0.5 text-xs text-red-700"
                      onClick={() => showResult(removeCargoEntry(ship.id, e.id))}
                    >
                      删除
                    </Btn>
                  </span>
                )}
                {(locked || e.status !== 'active') && <span className="text-xs text-stone-300">—</span>}
              </td>
            </tr>
          ))}
          {ship.manifest.length === 0 && (
            <tr>
              <td colSpan={7} className="py-3 text-center text-stone-400">货单为空，先登记货物</td>
            </tr>
          )}
        </tbody>
      </table>

      {!locked && (
        <div className="rounded border border-dashed border-[#8b4513]/40 bg-[#f5e6c8]/40 p-3">
          <p className="mb-2 text-xs font-semibold text-[#6b3a2a]">{editingId ? '修正货单条目（属外部修正，版本将递增）' : '登记货单条目'}</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Field label="货名">
              <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="类别">
              <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as CargoCategory })}>
                {CARGO_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="数量">
              <NumberInput value={draft.quantity} min={0} onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })} />
            </Field>
            <Field label="单价(贯)">
              <NumberInput value={draft.unitValue} min={0} onChange={(e) => setDraft({ ...draft, unitValue: Number(e.target.value) })} />
            </Field>
            <div className="flex items-end gap-1">
              <Btn onClick={submit}>{editingId ? '保存修正' : '登记'}</Btn>
              {editingId && (
                <Btn variant="ghost" onClick={() => { setEditingId(null); setDraft(EMPTY_DRAFT); setMessage(null); }}>
                  取消
                </Btn>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
