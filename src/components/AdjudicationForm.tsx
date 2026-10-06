import { useState } from 'react';
import type { CargoCategory, Finding, Inspection, Ship } from '@/domain/types';
import { genId } from '@/domain/operations';
import { useStore } from '@/store/useStore';

interface Props {
  ship: Ship;
  inspection: Inspection;
}

interface RowState {
  quantity: string;
  category: '' | CargoCategory;
}

interface NewItemState {
  name: string;
  category: CargoCategory;
  quantity: number;
  unitPrice: number;
}

const inputCls =
  'rounded border border-[#c9b78c] bg-[#fffdf5] px-2 py-1 text-sm focus:border-[#8b4513] focus:outline-none';

export default function AdjudicationForm({ ship, inspection }: Props) {
  const adjudicate = useStore((s) => s.adjudicate);
  const voidInspection = useStore((s) => s.voidInspection);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [newItems, setNewItems] = useState<NewItemState[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const setRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => {
      const current = prev[id] ?? { quantity: '', category: '' };
      return { ...prev, [id]: { ...current, ...patch } };
    });

  const submit = () => {
    const findings: Finding[] = [];
    for (const item of ship.manifest) {
      const row = rows[item.id];
      if (!row) continue;
      const qty = row.quantity.trim() === '' ? item.quantity : Number(row.quantity);
      const cat = row.category === '' ? item.category : row.category;
      if (qty === item.quantity && cat === item.category) continue;
      findings.push({
        id: genId('fnd'),
        kind: cat !== item.category ? 'category' : 'quantity',
        cargoItemId: item.id,
        declared: { ...item },
        observed: { ...item, quantity: qty, category: cat },
        note: note.trim() || undefined,
      });
    }
    for (const ni of newItems) {
      if (!ni.name.trim()) continue;
      findings.push({
        id: genId('fnd'),
        kind: 'new_item',
        cargoItemId: null,
        declared: null,
        observed: {
          id: genId('cargo'),
          name: ni.name.trim(),
          category: ni.category,
          quantity: ni.quantity,
          unitPrice: ni.unitPrice,
        },
        note: note.trim() || undefined,
      });
    }
    const result = adjudicate(ship.id, inspection.id, findings);
    setError(result.ok ? null : result.ok === false ? result.error : null);
  };

  return (
    <div className="mt-3 rounded-md border border-[#b9770e] bg-[#fff8e7] p-3">
      <h4 className="mb-2 text-sm font-bold text-[#6b3a2a]">
        裁定录入 <span className="font-normal text-[#8b4513]">（留空表示该项无异常）</span>
      </h4>
      <table className="mb-2 w-full text-sm">
        <thead>
          <tr className="border-b border-[#c9b78c] text-left text-[#6b3a2a]">
            <th className="py-1 pr-2">货单条目</th>
            <th className="py-1 pr-2 text-right">申报数量</th>
            <th className="py-1 pr-2 w-28 text-right">实测数量</th>
            <th className="py-1 w-28">实测类别</th>
          </tr>
        </thead>
        <tbody>
          {ship.manifest.map((item) => {
            const row = rows[item.id] ?? { quantity: '', category: '' };
            return (
              <tr key={item.id} className="border-b border-[#e8dcc0]">
                <td className="py-1.5 pr-2">
                  {item.name} <span className="text-xs text-[#8b4513]">（{item.category}）</span>
                </td>
                <td className="py-1.5 pr-2 text-right">{item.quantity}</td>
                <td className="py-1.5 pr-2 text-right">
                  <input
                    type="number"
                    min={0}
                    placeholder={String(item.quantity)}
                    value={row.quantity}
                    onChange={(e) => setRow(item.id, { quantity: e.target.value })}
                    className={`${inputCls} w-24 text-right`}
                  />
                </td>
                <td className="py-1.5">
                  <select
                    value={row.category}
                    onChange={(e) => setRow(item.id, { category: e.target.value as '' | CargoCategory })}
                    className={inputCls}
                  >
                    <option value="">不变</option>
                    <option value="细色">细色</option>
                    <option value="粗色">粗色</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {newItems.map((ni, idx) => (
        <div key={idx} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-[#922b21]">补充货物</span>
          <input
            className={`${inputCls} w-32`}
            placeholder="货名"
            value={ni.name}
            onChange={(e) =>
              setNewItems((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
            }
          />
          <select
            className={inputCls}
            value={ni.category}
            onChange={(e) =>
              setNewItems((prev) =>
                prev.map((x, i) => (i === idx ? { ...x, category: e.target.value as CargoCategory } : x)),
              )
            }
          >
            <option value="细色">细色</option>
            <option value="粗色">粗色</option>
          </select>
          <input
            type="number"
            min={0}
            className={`${inputCls} w-20 text-right`}
            value={ni.quantity}
            onChange={(e) =>
              setNewItems((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)))
            }
          />
          <input
            type="number"
            min={0}
            step={0.1}
            className={`${inputCls} w-20 text-right`}
            value={ni.unitPrice}
            onChange={(e) =>
              setNewItems((prev) => prev.map((x, i) => (i === idx ? { ...x, unitPrice: Number(e.target.value) } : x)))
            }
          />
          <button
            className="rounded px-2 py-0.5 text-xs text-[#922b21] hover:bg-[#922b2115]"
            onClick={() => setNewItems((prev) => prev.filter((_, i) => i !== idx))}
          >
            移除
          </button>
        </div>
      ))}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setNewItems((prev) => [...prev, { name: '', category: '细色', quantity: 1, unitPrice: 1 }])}
          className="rounded-md border border-[#8b4513] px-2 py-1 text-xs text-[#8b4513] hover:bg-[#ffd70022]"
        >
          + 补充登记货单未载货物
        </button>
        <input
          className={`${inputCls} flex-1`}
          placeholder="裁定备注（可选）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {error && <p className="mb-2 rounded bg-[#922b2115] px-2 py-1 text-sm text-[#922b21]">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={submit}
          className="rounded-md bg-gradient-to-b from-[#8b4513] to-[#6b3a2a] px-4 py-1.5 text-sm text-[#f5f0e0] transition hover:brightness-110"
        >
          落裁定
        </button>
        <button
          onClick={() => {
            const r = voidInspection(ship.id, inspection.id);
            setError(r.ok ? null : r.ok === false ? r.error : null);
          }}
          className="rounded-md border border-[#922b21] px-3 py-1.5 text-sm text-[#922b21] hover:bg-[#922b2110]"
        >
          作废本轮抽检
        </button>
      </div>
    </div>
  );
}
