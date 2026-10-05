import BacklogChart from '@/components/BacklogChart';
import DecisionList from '@/components/DecisionList';
import EventTable from '@/components/EventTable';
import ParamsPanel from '@/components/ParamsPanel';
import StatusBar from '@/components/StatusBar';

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header>
          <h1 className="text-lg font-semibold">离线事件流 · 背压调节状态一致性台</h1>
          <p className="mt-1 text-xs text-slate-500">
            积压推算、背压触发与处置结论基于同一份事件集合；参数或事件修正后仅重推受影响区间，结果与整体重推逐点一致。
          </p>
        </header>
        <StatusBar />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <BacklogChart />
          <DecisionList />
          <ParamsPanel />
          <EventTable />
        </div>
      </div>
    </div>
  );
}
