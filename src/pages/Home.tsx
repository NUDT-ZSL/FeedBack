import { useCallback, useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import SealTabs from '@/components/SealTabs';
import Toolbar from '@/components/Toolbar';
import SealDesigner from '@/components/SealDesigner';
import StampGallery from '@/components/StampGallery';
import EmptyGuide from '@/components/EmptyGuide';
import ActionToast from '@/components/ActionToast';
import { useWorkbench } from '@/store/workbenchStore';
import { getSelectedSeal } from '@/store/workbench';
import { browserPngDeps, exportSealPng } from '@/core/renderer';
import type { SealState } from '@/types';

const downloadPng = (dataUrl: string, filename: string) => {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
};

export default function Home() {
  const seal = useWorkbench(getSelectedSeal);
  const hasSeals = useWorkbench((state) => state.seals.length > 0);
  const stampCurrent = useWorkbench((state) => state.stampCurrent);
  const [toast, setToast] = useState({ message: '', key: 0 });
  const [pressing, setPressing] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, key: prev.key + 1 }));
  }, []);

  useEffect(() => {
    if (!toast.message) return;
    const timer = window.setTimeout(() => setToast((prev) => ({ ...prev, message: '' })), 1500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const exportState = useCallback(
    async (state: SealState, name: string) => {
      try {
        const dataUrl = await exportSealPng(state, browserPngDeps());
        downloadPng(dataUrl, `${name}.png`);
        showToast(`已导出「${name}」`);
      } catch {
        showToast('导出失败，请重试');
      }
    },
    [showToast],
  );

  const handleStamp = useCallback(() => {
    if (!seal) return;
    const record = stampCurrent();
    if (!record) {
      showToast('请先输入印文再钤盖');
      return;
    }
    setPressing(true);
    window.setTimeout(() => setPressing(false), 800);
    confetti({
      particleCount: 30,
      colors: ['#cc3333'],
      spread: 70,
      origin: { y: 0.6 },
    });
    showToast(`已钤盖「${seal.name}」`);
  }, [seal, stampCurrent, showToast]);

  const handleExport = useCallback(() => {
    if (!seal) return;
    if (seal.state.characters.length === 0) {
      showToast('请先输入印文再导出');
      return;
    }
    void exportState(seal.state, seal.name);
  }, [seal, exportState, showToast]);

  return (
    <div className="flex h-screen flex-col bg-[#f4ecd8]">
      <header className="flex items-center gap-2 border-b border-[#d4c4a8] bg-[#e8dcc8] px-4 py-2">
        <span className="text-lg text-[#7a2a2a]">虚拟篆刻工坊</span>
        <span className="text-xs text-[#8a7a58]">多方印章并行治印</span>
      </header>
      <SealTabs />
      {hasSeals && seal ? (
        <>
          <Toolbar onToast={showToast} onStamp={handleStamp} onExport={handleExport} />
          <main className="flex flex-1 items-center justify-center overflow-auto p-2.5">
            <SealDesigner key={seal.id} seal={seal} pressing={pressing} />
          </main>
          <StampGallery
            onToast={showToast}
            onExportStamp={async (record) => {
              await exportState(record.snapshot, `${seal.name}-印谱`);
            }}
          />
        </>
      ) : (
        <main className="flex-1">
          <EmptyGuide />
        </main>
      )}
      <ActionToast message={toast.message} toastKey={toast.key} />
    </div>
  );
}
