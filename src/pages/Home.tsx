import ParameterPanel from '@/components/simulation/ParameterPanel';
import ResultsPanel from '@/components/simulation/ResultsPanel';

export default function Home() {
  return (
    <div className="flex h-screen flex-col bg-gradient-to-b from-[#e6f2f0] to-[#b8d4c8] text-stone-800">
      <header className="flex items-center justify-between px-5 py-3">
        <div>
          <h1 className="text-lg font-bold text-emerald-950">古代水车灌溉推演台</h1>
          <p className="text-xs text-stone-600">
            水车转速 · 渠道分流 · 田块蓄水 · 作物缺水判定 —— 全部由独立推演引擎计算，界面仅作展示与交互
          </p>
        </div>
        <div className="text-right text-[11px] text-stone-500">
          <div>离线复算：npm run simulate</div>
          <div>同一份输入，界面与批量入口结论一致</div>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 gap-4 px-5 pb-4">
        <ParameterPanel />
        <ResultsPanel />
      </main>
    </div>
  );
}
