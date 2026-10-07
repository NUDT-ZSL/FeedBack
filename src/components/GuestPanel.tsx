import { useState } from 'react';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import type { Guest, Rank } from '@/core/types';
import { actions, useActiveBanquet, useWorkspace } from '@/store/useWorkspace';
import { groupSize } from '@/core/solver';

const RANKS: { value: Rank; label: string }[] = [
  { value: 1, label: '1 布衣' },
  { value: 2, label: '2 吏员' },
  { value: 3, label: '3 士人' },
  { value: 4, label: '4 卿相' },
  { value: 5, label: '5 王侯' },
];

/** 宾客名单：忌口、身份等级、随行人数，改动后自动增量重推 */
export default function GuestPanel() {
  const banquet = useActiveBanquet();
  const dispatch = useWorkspace((s) => s.dispatch);
  const [name, setName] = useState('');
  const [dietary, setDietary] = useState('');
  const [rank, setRank] = useState<Rank>(3);
  const [entourage, setEntourage] = useState(0);

  if (!banquet) return null;
  const bid = banquet.id;

  const add = () => {
    if (!name.trim()) return;
    dispatch(
      actions.addGuest(bid, {
        name,
        dietary: parseTags(dietary),
        rank,
        entourage,
      }),
    );
    setName('');
    setDietary('');
    setEntourage(0);
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="rounded-lg border border-[#c9a97e] bg-[#fdf8ec] p-3">
        <h3 className="mb-2 font-bold text-[#6b4c3a]">
          <UserPlus size={15} className="mr-1 inline" />
          入册宾客
        </h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <input
            className="rounded border border-[#c9a97e] px-2 py-1"
            placeholder="宾客名讳"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded border border-[#c9a97e] px-2 py-1"
            placeholder="忌口（顿号分隔）"
            value={dietary}
            onChange={(e) => setDietary(e.target.value)}
          />
          <select
            className="rounded border border-[#c9a97e] bg-white px-2 py-1"
            value={rank}
            onChange={(e) => setRank(Number(e.target.value) as Rank)}
          >
            {RANKS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <label className="whitespace-nowrap text-stone-600">随行</label>
            <input
              type="number"
              min={0}
              className="w-full rounded border border-[#c9a97e] px-2 py-1"
              value={entourage}
              onChange={(e) => setEntourage(Math.max(0, Number(e.target.value)))}
            />
            <span className="text-stone-500">人</span>
          </div>
        </div>
        <button
          className="mt-2 flex items-center gap-1 rounded bg-[#8b4513] px-3 py-1 text-sm text-white hover:bg-[#6b3410]"
          onClick={add}
        >
          <Plus size={14} /> 加入名单
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {banquet.guests.map((g) => (
          <GuestRow key={g.id} banquetId={bid} guest={g} />
        ))}
        {banquet.guests.length === 0 && (
          <li className="rounded border border-dashed border-[#c9a97e] p-3 text-center text-sm text-stone-500">
            名单为空，该宴席将标记为不可编排
          </li>
        )}
      </ul>

      {banquet.guests.length > 0 && (
        <button
          className="self-start rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
          onClick={() => {
            if (confirm('清空宾客名单？当前座次将归档，本场宴席转为不可编排状态。')) {
              dispatch(actions.clearGuests(bid));
            }
          }}
        >
          清空宾客名单
        </button>
      )}
    </section>
  );
}

function GuestRow({ banquetId, guest }: { banquetId: string; guest: Guest }) {
  const dispatch = useWorkspace((s) => s.dispatch);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-[#c9a97e] bg-[#fdf8ec] p-2 text-sm">
      <span className="min-w-16 font-semibold text-[#5b3a29]">{guest.name}</span>
      <select
        className="rounded border border-[#c9a97e] bg-white px-1 py-0.5 text-xs"
        value={guest.rank}
        onChange={(e) =>
          dispatch(
            actions.updateGuest(banquetId, guest.id, {
              rank: Number(e.target.value) as Rank,
            }),
          )
        }
        title="身份等级（改动自动重推座次）"
      >
        {RANKS.map((r) => (
          <option key={r.value} value={r.value}>
            等级{r.value}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs text-stone-600">
        忌口
        <input
          className="w-28 rounded border border-[#c9a97e] px-1 py-0.5"
          defaultValue={guest.dietary.join('、')}
          onBlur={(e) =>
            dispatch(
              actions.updateGuest(banquetId, guest.id, {
                dietary: parseTags(e.target.value),
              }),
            )
          }
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-stone-600">
        随行
        <input
          type="number"
          min={0}
          className="w-14 rounded border border-[#c9a97e] px-1 py-0.5"
          value={guest.entourage}
          onChange={(e) =>
            dispatch(
              actions.updateGuest(banquetId, guest.id, {
                entourage: Math.max(0, Number(e.target.value)),
              }),
            )
          }
        />
      </label>
      <span className="text-xs text-stone-500">
        一行 {groupSize(guest)} 人
      </span>
      <button
        className="ml-auto text-stone-400 hover:text-red-600"
        title="移出名单"
        onClick={() => dispatch(actions.removeGuest(banquetId, guest.id))}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

const parseTags = (text: string): string[] =>
  text
    .split(/[、,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
