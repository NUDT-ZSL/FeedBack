import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import GameBoard from '@/components/GameBoard';
import ColorRecord from '@/components/ColorRecord';
import CompletionModal from '@/components/CompletionModal';
import {
  DEFAULT_PARAMS,
  applyDip,
  createEngineState,
  derive,
  remainingLockMs,
  revertTo,
  type Derivation,
  type DyeingParams,
  type EngineState,
} from '@/simulation';

export default function Home() {
  const [params, setParams] = useState<DyeingParams>(DEFAULT_PARAMS);
  const [engine, setEngine] = useState<EngineState>(createEngineState);
  const [now, setNow] = useState(() => Date.now());
  const [modalDismissed, setModalDismissed] = useState(false);
  const cacheRef = useRef<Derivation | undefined>(undefined);

  // 全应用唯一的推演入口：界面所有展示字段都来自这个 derivation，
  // 参数变化时只增量重算受影响的阶段，结果与全量重算一致。
  const derivation = useMemo(() => {
    const next = derive({ ...params, dipCount: engine.dipCount }, cacheRef.current);
    cacheRef.current = next;
    return next;
  }, [params, engine.dipCount]);

  const lockedMs = remainingLockMs(engine, now);
  const isLocked = lockedMs > 0;

  useEffect(() => {
    if (!isLocked) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [isLocked]);

  const handleParamsChange = useCallback((patch: Partial<DyeingParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleLift = useCallback(() => {
    const at = Date.now();
    setNow(at);
    // applyDip 内部幂等：重复 opId 去重、氧化锁定期内的连点直接拒绝，
    // 快速连续点击不会造成浸染次数重复累加。
    setEngine((prev) => applyDip(prev, uuidv4(), at, params).state);
    setModalDismissed(false);
  }, [params]);

  const handleRevert = useCallback((round: number) => {
    setEngine((prev) => revertTo(prev, round));
    setNow(Date.now());
  }, []);

  const handleExport = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      params: derivation.params,
      result: derivation.result,
      records: engine.records,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `indigo-dye-record-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [derivation, engine.records]);

  const showModal = derivation.result.isComplete && !modalDismissed;

  return (
    <div className="min-h-screen bg-[#f0ead6] text-[#3d2b1f]">
      <header className="px-6 pt-6 text-center">
        <h1 className="text-2xl font-semibold tracking-wide">古代蓝染工坊</h1>
        <p className="mt-1 text-sm text-[#7a6a58]">
          反复提拉布料，观察靛蓝氧化的色阶变化
        </p>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6 md:flex-row">
        <section className="md:w-3/5">
          <GameBoard
            result={derivation.result}
            params={derivation.params}
            onParamsChange={handleParamsChange}
            lockedSeconds={Math.ceil(lockedMs / 1000)}
            onLift={handleLift}
          />
        </section>
        <aside className="md:w-2/5">
          <ColorRecord records={engine.records} onRevert={handleRevert} />
        </aside>
      </main>
      {showModal && (
        <CompletionModal
          records={engine.records}
          result={derivation.result}
          onExport={handleExport}
          onClose={() => setModalDismissed(true)}
        />
      )}
    </div>
  );
}
