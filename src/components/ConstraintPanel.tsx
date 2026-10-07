import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { actions, useActiveBanquet, useWorkspace } from '@/store/useWorkspace';

/** 不宜同桌约束：全部保留，冲突时给出可追溯说明，绝不静默择一 */
export default function ConstraintPanel() {
  const banquet = useActiveBanquet();
  const dispatch = useWorkspace((s) => s.dispatch);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [note, setNote] = useState('');

  if (!banquet) return null;
  const bid = banquet.id;
  const nameOf = (id: string) =>
    banquet.guests.find((g) => g.id === id)?.name ?? id;
  const conflicts = banquet.arrangement.conflicts;

  const add = () => {
    if (!a || !b || a === b) return;
    dispatch(actions.addConstraint(bid, a, b, note.trim() || undefined));
    setA('');
    setB('');
    setNote('');
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="rounded-lg border border-[#c9a97e] bg-[#fdf8ec] p-3">
        <h3 className="mb-2 font-bold text-[#6b4c3a]">不宜同桌</h3>
        {banquet.guests.length < 2 ? (
          <p className="text-sm text-stone-500">宾客不足两人，无需设置。</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              className="rounded border border-[#c9a97e] bg-white px-2 py-1"
              value={a}
              onChange={(e) => setA(e.target.value)}
            >
              <option value="">宾客甲</option>
              {banquet.guests.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <span className="text-stone-500">不宜与</span>
            <select
              className="rounded border border-[#c9a97e] bg-white px-2 py-1"
              value={b}
              onChange={(e) => setB(e.target.value)}
            >
              <option value="">宾客乙</option>
              {banquet.guests.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <span className="text-stone-500">同桌</span>
            <input
              className="w-32 rounded border border-[#c9a97e] px-2 py-1"
              placeholder="缘由（可选）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="flex items-center gap-1 rounded bg-[#8b4513] px-3 py-1 text-white hover:bg-[#6b3410] disabled:opacity-40"
              disabled={!a || !b || a === b}
              onClick={add}
            >
              <Plus size={14} /> 记下
            </button>
          </div>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {banquet.constraints.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-lg border border-[#c9a97e] bg-[#fdf8ec] px-3 py-1.5 text-sm"
          >
            <span className="font-semibold text-[#5b3a29]">{nameOf(c.a)}</span>
            <span className="text-red-700">⚔</span>
            <span className="font-semibold text-[#5b3a29]">{nameOf(c.b)}</span>
            {c.note && <span className="text-xs text-stone-500">（{c.note}）</span>}
            <button
              className="ml-auto text-stone-400 hover:text-red-600"
              title="解除约束（自动重推）"
              onClick={() => dispatch(actions.removeConstraint(bid, c.id))}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {banquet.constraints.length === 0 && (
          <li className="rounded border border-dashed border-[#c9a97e] p-3 text-center text-sm text-stone-500">
            暂无不宜同桌约束
          </li>
        )}
      </ul>

      {conflicts && (
        <div className="rounded-lg border-2 border-red-400 bg-red-50 p-3">
          <h4 className="mb-1 font-bold text-red-800">约束冲突（全部保留，未做取舍）</h4>
          <ul className="list-disc pl-5 text-sm text-red-800">
            {conflicts.core.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {conflicts.notes.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs text-red-700">
              {conflicts.notes.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
