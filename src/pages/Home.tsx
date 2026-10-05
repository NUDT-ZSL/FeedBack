import { useEffect, useReducer, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import BatchList from '@/components/BatchList';
import ControlPanel from '@/components/ControlPanel';
import MillScene from '@/components/MillScene';
import SieveTower from '@/components/SieveTower';
import {
  createInitialState,
  formatDate,
  getUnpackedTotals,
  millReducer,
} from '@/MillCore';
import type { FlourType } from '@/types';

const STORAGE_KEY = 'song-mill:batches:v1';

export default function Home() {
  const [state, dispatch] = useReducer(millReducer, undefined, () =>
    createInitialState(performance.now())
  );
  const hydrated = useRef(false);
  const lastFrame = useRef(performance.now());

  // 启动时恢复批次历史，重渲染/刷新不丢失
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const batches = JSON.parse(raw);
        if (Array.isArray(batches)) {
          dispatch({ type: 'LOAD_BATCHES', batches });
        }
      }
    } catch {
      // 存储损坏时忽略，从空台账开始
    }
    hydrated.current = true;
  }, []);

  // 批次变化即持久化
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(state.batches)
      );
    } catch {
      // 存储空间不足等情况忽略
    }
  }, [state.batches]);

  // 逐帧记账：单帧间隔钳位到 200ms，切后台回来不会一次性灌入巨量产出
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const clampedNow = Math.min(now, lastFrame.current + 200);
      lastFrame.current = clampedNow;
      dispatch({ type: 'TICK', now: clampedNow });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleValveChange = (valve: number) => {
    dispatch({ type: 'SET_VALVE', valve, now: performance.now() });
  };
  const handleGapChange = (gap: number) => {
    dispatch({ type: 'SET_GAP', gap, now: performance.now() });
  };
  const handlePack = (flourType: FlourType) => {
    dispatch({
      type: 'PACK',
      flourType,
      id: uuidv4(),
      now: performance.now(),
      timestamp: formatDate(new Date()),
    });
  };
  const handleBagDone = (id: string) => {
    dispatch({ type: 'REMOVE_BAG_ANIMATION', id });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4 text-center">
        <h1 className="text-2xl font-bold" style={{ color: '#5a3a1a' }}>
          宋代水力石磨坊
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#7a5a34' }}>
          每袋面粉的重量与成色由其产出期间的磨盘分段决定；调阀/调隙只影响之后的产出，已打包批次可追溯、不重算。
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <MillScene
          wheelSpeed={state.wheelSpeed}
          gap={state.gap}
          load={state.load}
          isOverloaded={state.isOverloaded}
          isRunning={state.isRunning}
        />
        <ControlPanel
          valveOpening={state.valveOpening}
          gap={state.gap}
          wheelSpeed={state.wheelSpeed}
          load={state.load}
          onValveChange={handleValveChange}
          onGapChange={handleGapChange}
        />
        <SieveTower
          totals={getUnpackedTotals(state)}
          animatingBags={state.animatingBags}
          onPack={handlePack}
          onBagAnimationDone={handleBagDone}
        />
        <BatchList batches={state.batches} />
      </div>
    </div>
  );
}
