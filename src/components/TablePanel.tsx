import { useState } from 'react';
import { Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import type { BanquetTable, Rank } from '@/core/types';
import { actions, useActiveBanquet, useWorkspace } from '@/store/useWorkspace';
import { groupSize } from '@/core/solver';

/** 桌次与菜品：桌容/主桌门槛/菜品调整都会触发增量重推 */
export default function TablePanel() {
  const banquet = useActiveBanquet();
  const dispatch = useWorkspace((s) => s.dispatch);
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState(8);
  const [isMain, setIsMain] = useState(false);
  const [minRank, setMinRank] = useState<Rank>(4);
  const [dishName, setDishName] = useState('');
  const [dishTags, setDishTags] = useState('');

  if (!banquet) return null;
  const bid = banquet.id;

  const add = () => {
    if (!name.trim()) return;
    dispatch(actions.addTable(bid, { name, capacity, isMain, minRank }));
    setName('');
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="rounded-lg border border-[#c9a97e] bg-[#fdf8ec] p-3">
        <h3 className="mb-2 font-bold text-[#6b4c3a]">
          <UtensilsCrossed size={15} className="mr-1 inline" />
          设桌
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input
            className="w-28 rounded border border-[#c9a97e] px-2 py-1"
            placeholder="桌名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label className="flex items-center gap-1 text-stone-600">
            容量
            <input
              type="number"
              min={1}
              className="w-16 rounded border border-[#c9a97e] px-2 py-1"
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number(e.target.value)))}
            />
          </label>
          <label className="flex items-center gap-1 text-stone-600">
            <input
              type="checkbox"
              checked={isMain}
              onChange={(e) => setIsMain(e.target.checked)}
            />
            主桌
          </label>
          {isMain && (
            <label className="flex items-center gap-1 text-stone-600">
              门槛
              <select
                className="rounded border border-[#c9a97e] bg-white px-1 py-1"
                value={minRank}
                onChange={(e) => setMinRank(Number(e.target.value) as Rank)}
              >
                {[2, 3, 4, 5].map((r) => (
                  <option key={r} value={r}>
                    等级{r}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="flex items-center gap-1 rounded bg-[#8b4513] px-3 py-1 text-white hover:bg-[#6b3410]"
            onClick={add}
          >
            <Plus size={14} /> 开桌
          </button>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        {banquet.tables.map((t) => (
          <TableCard key={t.id} table={t} />
        ))}
        {banquet.tables.length === 0 && (
          <p className="rounded border border-dashed border-[#c9a97e] p-3 text-center text-sm text-stone-500">
            尚未设桌，宾客无处落座
          </p>
        )}
      </div>

      <div className="rounded-lg border border-[#c9a97e] bg-[#fdf8ec] p-3">
        <h4 className="mb-2 text-sm font-bold text-[#6b4c3a]">菜品（标签用于忌口比对）</h4>
        <div className="flex flex-wrap gap-2 text-sm">
          <input
            className="w-28 rounded border border-[#c9a97e] px-2 py-1"
            placeholder="菜名"
            value={dishName}
            onChange={(e) => setDishName(e.target.value)}
          />
          <input
            className="w-40 rounded border border-[#c9a97e] px-2 py-1"
            placeholder="标签（如 花生、河鲜）"
            value={dishTags}
            onChange={(e) => setDishTags(e.target.value)}
          />
          <button
            className="rounded bg-[#8b4513] px-3 py-1 text-white hover:bg-[#6b3410]"
            onClick={() => {
              if (!dishName.trim()) return;
              dispatch(
                actions.addDish(bid, {
                  name: dishName,
                  tags: dishTags
                    .split(/[、,，\s]+/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                }),
              );
              setDishName('');
              setDishTags('');
            }}
          >
            添菜
          </button>
        </div>
        <ul className="mt-2 flex flex-wrap gap-2">
          {banquet.dishes.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-1 rounded-full border border-[#c9a97e] bg-white px-2 py-0.5 text-xs"
            >
              <span className="font-semibold">{d.name}</span>
              {d.tags.length > 0 && (
                <span className="text-stone-500">[{d.tags.join('/')}]</span>
              )}
              <button
                className="ml-1 text-stone-400 hover:text-red-600"
                onClick={() => dispatch(actions.removeDish(bid, d.id))}
                title="撤下此菜（自动重推相关桌）"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function TableCard({ table }: { table: BanquetTable }) {
  const banquet = useActiveBanquet()!;
  const dispatch = useWorkspace((s) => s.dispatch);
  const bid = banquet.id;
  const occupancy = banquet.arrangement.assignments
    .filter((a) => a.tableId === table.id)
    .reduce(
      (sum, a) =>
        sum + groupSize(banquet.guests.find((g) => g.id === a.guestId)!),
      0,
    );
  const over = occupancy > table.capacity;

  return (
    <div
      className={`rounded-lg border-2 p-3 ${
        table.isMain ? 'border-amber-500 bg-amber-50' : 'border-[#c9a97e] bg-[#fdf8ec]'
      }`}
    >
      <div className="flex items-center gap-2">
        <input
          className="w-24 rounded border border-[#c9a97e] bg-transparent px-1 font-semibold text-[#5b3a29]"
          defaultValue={table.name}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== table.name) {
              dispatch(actions.updateTable(bid, table.id, { name }));
            }
          }}
          title="桌名"
        />
        {table.isMain && (
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-900">
            主桌
          </span>
        )}
        <button
          className="ml-auto text-stone-400 hover:text-red-600"
          onClick={() => dispatch(actions.removeTable(bid, table.id))}
          title="撤桌（宾客自动疏散重排）"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-stone-600">
          容量
          <input
            type="number"
            min={1}
            className="w-14 rounded border border-[#c9a97e] px-1 py-0.5"
            value={table.capacity}
            onChange={(e) =>
              dispatch(
                actions.updateTable(bid, table.id, {
                  capacity: Math.max(1, Number(e.target.value)),
                }),
              )
            }
          />
        </label>
        <label className="flex items-center gap-1 text-stone-600">
          <input
            type="checkbox"
            checked={table.isMain}
            onChange={(e) =>
              dispatch(
                actions.updateTable(bid, table.id, { isMain: e.target.checked }),
              )
            }
          />
          主桌
        </label>
        {table.isMain && (
          <label className="flex items-center gap-1 text-stone-600">
            门槛
            <select
              className="rounded border border-[#c9a97e] bg-white px-1 py-0.5"
              value={table.minRank}
              onChange={(e) =>
                dispatch(
                  actions.updateTable(bid, table.id, {
                    minRank: Number(e.target.value) as Rank,
                  }),
                )
              }
            >
              {[2, 3, 4, 5].map((r) => (
                <option key={r} value={r}>
                  等级{r}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className={over ? 'font-bold text-red-600' : 'text-stone-500'}>
          在座 {occupancy}/{table.capacity} 人
        </span>
      </div>
      {banquet.dishes.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-stone-500">该桌菜品：</p>
          <div className="flex flex-wrap gap-1">
            {banquet.dishes.map((d) => {
              const on = table.dishIds.includes(d.id);
              return (
                <button
                  key={d.id}
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    on
                      ? 'border-[#8b4513] bg-[#8b4513] text-white'
                      : 'border-[#c9a97e] bg-white text-stone-600'
                  }`}
                  onClick={() =>
                    dispatch(
                      actions.setTableDishes(
                        bid,
                        table.id,
                        on
                          ? table.dishIds.filter((id) => id !== d.id)
                          : [...table.dishIds, d.id],
                      ),
                    )
                  }
                >
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
