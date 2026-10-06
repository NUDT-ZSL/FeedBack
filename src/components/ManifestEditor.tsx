import { useState } from 'react';
import type { CargoCategory, Ship } from '@/domain/types';
import { manifestLockReason } from '@/domain/operations';
import { useStore } from '@/store/useStore';

interface Props {
  ship: Ship;
  highlightKey: string | null;
}

const inputCls =
  'w-full rounded border border-[#c9b78c] bg-[#fffdf5] px-2 py-1 text-sm focus:border-[#8b4513] focus:outline-none disabled:bg-[#eee5cf] disabled:text-[#a08c6b]';

export default function ManifestEditor({ ship, highlightKey }: Props) {
  const addCargoItem = useStore((s) => s.addCargoItem);
  const updateCargoItem = useStore((s) => s.updateCargoItem);
  const removeCargoItem = useStore((s) => s.removeCargoItem);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', category: '细色' as CargoCategory, quantity: 1, unitPrice: 1 });

  const lockReason = manifestLockReason(ship);
  const locked = lockReason !== null;

  const run = (result: { ok: boolean; error?: string }) => {
    setError(result.ok ? null : result.error ?? '操作失败');
  };

  return (
    <section className="rounded-lg border-2 border-[#8b4513] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[#6b3a2a]">
          货单 <span className="text-xs font-normal text-[#8b4513]">版本 v{ship.manifestVersion}</span>
        </h2>
        {locked && (
          <span className="rounded-md bg-[#b9770e] px-2 py-0.5 text-xs text-white">
            🔒 {lockReason}
          </span>
        )}
      </div>
      {error && <p className="mb-2 rounded bg-[#922b2115] px-2 py-1 text-sm text-[#922b21]">{error}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-[#8b4513] text-left text-[#6b3a2a]">
            <th className="py-1 pr-2">货物</th>
            <th className="py-1 pr-2 w-24">类别</th>
            <th className="py-1 pr-2 w-24 text-right">数量</th>
            <th className="py-1 pr-2 w-24 text-right">单价（两）</th>
            <th className="py-1 w-16" />
          </tr>
        </thead>
        <tbody>
          {ship.manifest.map((item) => (
            <tr
              key={item.id}
              id={`cargo-${item.id}`}
              className={`border-b border-[#e8dcc0] transition-colors duration-500 ${
                highlightKey === `cargo:${item.id}` ? 'bg-[#ffd70055]' : ''
              }`}
            >
              <td className="py-1.5 pr-2">
                <input
                  className={inputCls}
                  value={item.name}
                  disabled={locked}
                  onChange={(e) => run(updateCargoItem(ship.id, item.id, { name: e.target.value }))}
                />
              </td>
              <td className="py-1.5 pr-2">
                <select
                  className={inputCls}
                  value={item.category}
                  disabled={locked}
                  onChange={(e) => run(updateCargoItem(ship.id, item.id, { category: e.target.value as CargoCategory }))}
                >
                  <option value="细色">细色</option>
                  <option value="粗色">粗色</option>
                </select>
              </td>
              <td className="py-1.5 pr-2">
                <input
                  type="number"
                  min={0}
                  className={`${inputCls} text-right`}
                  value={item.quantity}
                  disabled={locked}
                  onChange={(e) => run(updateCargoItem(ship.id, item.id, { quantity: Number(e.target.value) }))}
                />
              </td>
              <td className="py-1.5 pr-2">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  className={`${inputCls} text-right`}
                  value={item.unitPrice}
                  disabled={locked}
                  onChange={(e) => run(updateCargoItem(ship.id, item.id, { unitPrice: Number(e.target.value) }))}
                />
              </td>
              <td className="py-1.5 text-center">
                <button
                  disabled={locked}
                  onClick={() => run(removeCargoItem(ship.id, item.id))}
                  className="rounded px-2 py-0.5 text-xs text-[#922b21] hover:bg-[#922b2115] disabled:opacity-40"
                >
                  删
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5 pr-2">
              <input
                className={inputCls}
                placeholder="新增货物"
                value={draft.name}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </td>
            <td className="py-1.5 pr-2">
              <select
                className={inputCls}
                value={draft.category}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as CargoCategory })}
              >
                <option value="细色">细色</option>
                <option value="粗色">粗色</option>
              </select>
            </td>
            <td className="py-1.5 pr-2">
              <input
                type="number"
                min={0}
                className={`${inputCls} text-right`}
                value={draft.quantity}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}
              />
            </td>
            <td className="py-1.5 pr-2">
              <input
                type="number"
                min={0}
                step={0.1}
                className={`${inputCls} text-right`}
                value={draft.unitPrice}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, unitPrice: Number(e.target.value) })}
              />
            </td>
            <td className="py-1.5 text-center">
              <button
                disabled={locked || !draft.name.trim()}
                onClick={() => {
                  run(addCargoItem(ship.id, { ...draft, name: draft.name.trim() }));
                  setDraft({ name: '', category: '细色', quantity: 1, unitPrice: 1 });
                }}
                className="rounded-md bg-gradient-to-b from-[#8b4513] to-[#6b3a2a] px-3 py-1 text-xs text-[#f5f0e0] transition hover:brightness-110 disabled:opacity-40"
              >
                添
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
