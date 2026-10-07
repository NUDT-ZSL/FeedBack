import { useState } from 'react';
import { ClipboardCheck, Users, UtensilsCrossed, Armchair, Link2 } from 'lucide-react';
import BanquetSidebar from '@/components/BanquetSidebar';
import GuestPanel from '@/components/GuestPanel';
import TablePanel from '@/components/TablePanel';
import ConstraintPanel from '@/components/ConstraintPanel';
import SeatingView from '@/components/SeatingView';
import { actions, auditOf, useActiveBanquet, useWorkspace } from '@/store/useWorkspace';

type Tab = 'seating' | 'guests' | 'tables' | 'constraints';

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: 'seating', label: '座次编排', icon: Armchair },
  { key: 'guests', label: '宾客名单', icon: Users },
  { key: 'tables', label: '桌次与菜品', icon: UtensilsCrossed },
  { key: 'constraints', label: '同桌约束', icon: Link2 },
];

export default function Home() {
  const workspace = useWorkspace((s) => s.workspace);
  const dispatch = useWorkspace((s) => s.dispatch);
  const banquet = useActiveBanquet();
  const [tab, setTab] = useState<Tab>('seating');
  const [showAudit, setShowAudit] = useState(false);

  const audit = auditOf(workspace);
  const problemCount = audit.filter(
    (a) => a.status !== 'arranged' || a.issues.length > 0,
  ).length;

  return (
    <div className="min-h-screen bg-[#fcf5e8] px-4 py-4 text-[#3f2c1d]">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-mashan text-3xl text-[#8b4513]">司膳官·宴席编排台</h1>
        <p className="text-sm text-stone-500">多场宴席并行筹备，座次增量重推、冲突可溯</p>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="flex items-center gap-1 rounded-lg border-2 border-[#8b4513] bg-[#f7ecd7] px-3 py-1.5 text-sm font-semibold text-[#8b4513] hover:bg-[#8b4513] hover:text-white"
            onClick={() => {
              dispatch(actions.arrangeAll());
              setShowAudit(true);
            }}
            title="对所有宴席执行整体编排并核对"
          >
            <ClipboardCheck size={16} /> 批量编排与核对
          </button>
          {problemCount > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
              {problemCount} 场待处理
            </span>
          )}
        </div>
      </header>

      {showAudit && (
        <div className="mb-4 rounded-lg border-2 border-[#8b5e3c] bg-[#f7ecd7] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold text-[#6b4c3a]">全场核对结果</h2>
            <button
              className="text-xs text-stone-500 underline"
              onClick={() => setShowAudit(false)}
            >
              收起
            </button>
          </div>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {audit.map((a) => (
              <li
                key={a.banquetId}
                className={`rounded border p-2 text-sm ${
                  a.status === 'arranged' && a.issues.length === 0
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-red-300 bg-red-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{a.banquetName}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      a.status === 'arranged'
                        ? 'bg-emerald-100 text-emerald-800'
                        : a.status === 'unarrangeable'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-stone-200 text-stone-600'
                    }`}
                  >
                    {a.status === 'arranged'
                      ? '已编排'
                      : a.status === 'unarrangeable'
                        ? '不可编排'
                        : '待编排'}
                  </span>
                </div>
                {a.issues.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-xs text-red-700">
                    {a.issues.slice(0, 5).map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                )}
                {a.conflictCount > 0 && (
                  <p className="mt-1 text-xs text-red-700">
                    冲突/环 {a.conflictCount} 条，详见该宴席追溯记录
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <BanquetSidebar />
        <main className="min-w-0 flex-1">
          {banquet ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="text-xl font-bold text-[#5b3a29]">{banquet.name}</h2>
                <span className="text-sm text-stone-500">
                  {banquet.guests.length} 宾客 · {banquet.tables.length} 桌 ·{' '}
                  {banquet.constraints.length} 条约束
                </span>
              </div>
              <div className="mb-3 flex flex-wrap gap-1">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.key;
                  return (
                    <button
                      key={t.key}
                      className={`flex items-center gap-1 rounded-t-lg border-b-2 px-4 py-1.5 text-sm transition ${
                        active
                          ? 'border-[#8b4513] bg-[#f7ecd7] font-semibold text-[#8b4513]'
                          : 'border-transparent text-stone-500 hover:text-[#8b4513]'
                      }`}
                      onClick={() => setTab(t.key)}
                    >
                      <Icon size={15} /> {t.label}
                    </button>
                  );
                })}
              </div>
              <div className="rounded-xl border-4 border-[#8b5e3c] bg-[#fdf8ec] p-4">
                {tab === 'seating' && <SeatingView />}
                {tab === 'guests' && <GuestPanel />}
                {tab === 'tables' && <TablePanel />}
                {tab === 'constraints' && <ConstraintPanel />}
              </div>
            </>
          ) : (
            <div className="rounded-xl border-4 border-dashed border-[#8b5e3c] bg-[#fdf8ec] p-12 text-center text-stone-500">
              左侧新建一场宴席，即可开始编排
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
