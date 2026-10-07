import { Redo2, Undo2 } from 'lucide-react';
import SealTabs from '../components/SealTabs.tsx';
import ParamPanel from '../components/ParamPanel.tsx';
import SealCanvas from '../components/SealCanvas.tsx';
import StampPreview from '../components/StampPreview.tsx';
import { useWorkshopStore, workshopSelectors } from '../store/workshopStore.ts';

export default function Home() {
  const activeSeal = useWorkshopStore(workshopSelectors.activeSeal);
  const undoable = useWorkshopStore(workshopSelectors.canUndo);
  const redoable = useWorkshopStore(workshopSelectors.canRedo);
  const undo = useWorkshopStore((s) => s.undo);
  const redo = useWorkshopStore((s) => s.redo);
  const addSeal = useWorkshopStore((s) => s.addSeal);

  return (
    <div className="min-h-screen flex flex-col text-[#3a2c1c]">
      <header className="flex items-center gap-3 px-4 py-3 bg-[#e8dcc0] border-b border-[#c9b78f]">
        <h1 className="text-xl tracking-wide">虚拟篆刻工坊</h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="undo-button"
            onClick={undo}
            disabled={!undoable}
            className="flex items-center gap-1 rounded-md border border-[#c9b78f] bg-[#fffdf5] px-3 py-1.5 text-sm text-[#5a4632] hover:bg-[#efe3c6] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Undo2 size={14} />
            撤销
          </button>
          <button
            type="button"
            data-testid="redo-button"
            onClick={redo}
            disabled={!redoable}
            className="flex items-center gap-1 rounded-md border border-[#c9b78f] bg-[#fffdf5] px-3 py-1.5 text-sm text-[#5a4632] hover:bg-[#efe3c6] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Redo2 size={14} />
            重做
          </button>
        </div>
      </header>

      <SealTabs />

      {activeSeal ? (
        <main className="flex flex-1 min-h-0">
          <ParamPanel />
          <section className="flex-1 flex items-center justify-center gap-10 p-8 flex-wrap">
            <SealCanvas key={activeSeal.id} seal={activeSeal} />
            <div className="w-px self-stretch bg-[#c9b78f]" />
            <StampPreview key={activeSeal.id} seal={activeSeal} />
          </section>
        </main>
      ) : (
        <main className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="text-2xl text-[#5a4632]">案上尚无印石</div>
          <p className="text-sm text-[#8a7150]">新增一方印，开始奏刀。每方印的文字、字体、尺寸、刀法与修改历史各自独立保存。</p>
          <button
            type="button"
            data-testid="empty-add-seal"
            onClick={addSeal}
            className="rounded-md bg-[#b5342a] px-5 py-2.5 text-[#fdf6e3] hover:bg-[#8f241c]"
          >
            新增第一方印
          </button>
        </main>
      )}
    </div>
  );
}
