import { useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { actions, auditOf, useWorkspace } from '@/store/useWorkspace';

const statusLabel: Record<string, { text: string; cls: string }> = {
  arranged: { text: '已编排', cls: 'bg-emerald-100 text-emerald-800' },
  unarrangeable: { text: '不可编排', cls: 'bg-red-100 text-red-800' },
  empty: { text: '待编排', cls: 'bg-stone-200 text-stone-600' },
};

/** 左侧宴席列表：多场并行管理，随时切换 */
export default function BanquetSidebar() {
  const workspace = useWorkspace((s) => s.workspace);
  const dispatch = useWorkspace((s) => s.dispatch);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const audit = auditOf(workspace);

  const create = () => {
    dispatch(actions.addBanquet(name));
    setName('');
    setNaming(false);
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-3 rounded-xl border-4 border-[#8b5e3c] bg-[#f7ecd7] p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-[#6b4c3a]">宴席名录</h2>
        <button
          className="rounded-md border border-[#8b4513] px-2 py-1 text-xs text-[#8b4513] hover:bg-[#8b4513] hover:text-white"
          onClick={() => setNaming((v) => !v)}
          title="筹备新宴席"
        >
          <Plus size={14} className="inline" /> 新宴席
        </button>
      </div>
      {naming && (
        <div className="flex gap-1">
          <input
            autoFocus
            className="w-full rounded border border-[#8b5e3c] bg-white px-2 py-1 text-sm"
            placeholder="宴席名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button
            className="rounded bg-[#8b4513] px-2 text-sm text-white"
            onClick={create}
          >
            立
          </button>
        </div>
      )}
      <ul className="flex flex-col gap-2 overflow-y-auto">
        {workspace.banquets.map((b) => {
          const active = b.id === workspace.activeBanquetId;
          const st = statusLabel[b.arrangement.status];
          const a = audit.find((x) => x.banquetId === b.id);
          return (
            <li
              key={b.id}
              className={`group cursor-pointer rounded-lg border-2 p-2 transition ${
                active
                  ? 'border-[#8b4513] bg-[#fcf5e8] shadow'
                  : 'border-transparent bg-[#fdf8ec] hover:border-[#c9a97e]'
              }`}
              onClick={() => dispatch(actions.switchBanquet(b.id))}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#5b3a29]">{b.name}</span>
                <button
                  className="invisible text-stone-400 group-hover:visible hover:text-red-600"
                  title="撤销此宴席"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`确定撤销「${b.name}」？其宾客与座次将一并删除。`)) {
                      dispatch(actions.removeBanquet(b.id));
                    }
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-stone-500">
                <Users size={12} />
                <span>{b.guests.length} 位宾客</span>
                <span className={`rounded px-1.5 py-0.5 ${st.cls}`}>{st.text}</span>
                {b.arrangement.confirmed && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                    已确认
                  </span>
                )}
                {a && a.issues.length > 0 && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                    {a.issues.length} 处异常
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {workspace.banquets.length === 0 && (
          <li className="rounded border border-dashed border-[#c9a97e] p-3 text-center text-sm text-stone-500">
            尚无宴席，点击「新宴席」开始筹备
          </li>
        )}
      </ul>
    </aside>
  );
}
