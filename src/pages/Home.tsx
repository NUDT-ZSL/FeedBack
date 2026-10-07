import { useEffect, useRef } from 'react';
import { useProcessMachine } from '@/hooks/useProcessMachine';
import { useParticleSystem } from '@/hooks/useParticleSystem';
import { useDragControls } from '@/hooks/useDragControls';
import { computeQuality, UNIFORMITY_RETRY_THRESHOLD } from '@/core/processMachine';
import type { WatermarkType } from '@/types';

const WATERMARKS: WatermarkType[] = ['竹韵', '云鹤', '福寿', '兰亭', '山水', '墨韵'];
const MAX_PARTICLES = 300;
const LIGHT_INTENSITY = 80;

const STAGE_LABEL: Record<string, string> = {
  boiling_idle: '蒸煮（待开始）',
  boiling_active: '蒸煮中',
  beating_active: '打浆中',
  scooping_active: '抄纸',
  drying_active: '晒纸',
  finished: '成品',
};

export default function Home() {
  const { state, dispatch } = useProcessMachine();
  const { stage, paper } = state;
  const { emitSteam, emitPulp, emitWaterDrop, update, attachCanvas, system } =
    useParticleSystem(MAX_PARTICLES);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const curtainRef = useRef<HTMLDivElement>(null);
  const { onDragStart, onDragMove, onDragEnd, getPositions, resetDrag } =
    useDragControls(curtainRef);

  // 粒子渲染帧循环：canvas 引用在内核中显式绑定，卸载时由 hook dispose 统一释放
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    attachCanvas(canvas);
    const ctx = canvas.getContext('2d');
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const deltaTime = Math.min(0.1, (now - last) / 1000);
      last = now;

      if (stage === 'boiling_active') emitSteam(canvas.width / 2, canvas.height / 2, 0);
      if (stage === 'beating_active') emitPulp(canvas.width / 2, canvas.height / 2, 0, '#f5f0e6');
      if (stage === 'scooping_active' && state.pressed === false && state.scoopAttempts > 0) {
        emitWaterDrop(canvas.width / 2, canvas.height / 2, 0);
      }
      update(deltaTime);
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of system.getParticles()) {
        if (!ctx) continue;
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      if (ctx) ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [stage, state.pressed, state.scoopAttempts, attachCanvas, emitSteam, emitPulp, emitWaterDrop, update, system]);

  // 蒸煮 / 晒纸阶段的时间推进
  useEffect(() => {
    if (stage !== 'boiling_active' && stage !== 'drying_active') return;
    const timer = setInterval(() => {
      if (stage === 'boiling_active') {
        dispatch({ type: 'TICK_BOILING', deltaTime: 0.1 });
        // 蒸煮满 100 后自动转入打浆
        dispatch({ type: 'BOIL_COMPLETE' });
      } else {
        dispatch({ type: 'TICK_DRYING', lightIntensity: LIGHT_INTENSITY, deltaTime: 0.1 });
      }
    }, 100);
    return () => clearInterval(timer);
  }, [stage, dispatch]);

  // 拖拽结束：把整段采样作为一个语义事件原子提交，快速连续拖拽也不会覆盖
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    onDragEnd(e.nativeEvent);
    if (stage !== 'scooping_active') return;
    const positions = getPositions();
    dispatch({ type: 'SCOOP_DRAG_END', positions });
    resetDrag();
  };

  return (
    <div className="min-h-screen bg-[#6b4226] p-6 text-[#f5deb3]">
      <h1 className="mb-4 text-2xl font-bold">宣纸作坊 · 工序状态机重构版</h1>

      <div className="mb-4 flex items-center gap-4 text-sm">
        <span data-testid="stage-label">当前工序：{STAGE_LABEL[stage]}</span>
        <span>蒸煮 {paper.boilingProgress.toFixed(0)}%</span>
        <span>碎裂度 {paper.fragmentationLevel}%</span>
        <span data-testid="uniformity">均匀度 {paper.uniformity.toFixed(1)}%</span>
        <span data-testid="dryness">干燥度 {paper.dryness.toFixed(1)}%</span>
        {stage === 'finished' && <span data-testid="quality">成品质量 {computeQuality(paper)}</span>}
      </div>

      <canvas
        ref={canvasRef}
        width={640}
        height={120}
        className="mb-4 block w-full rounded bg-black/20"
      />

      <div className="space-y-4">
        {(stage === 'boiling_idle' || stage === 'boiling_active') && (
          <button
            className="rounded bg-[#8b5e3c] px-4 py-2 disabled:opacity-40"
            disabled={stage === 'boiling_active'}
            onClick={() => dispatch({ type: 'START_BOILING' })}
          >
            开始蒸煮（停留约 2 秒）
          </button>
        )}

        {stage === 'beating_active' && (
          <div className="flex gap-3">
            <button className="rounded bg-[#8b5e3c] px-4 py-2" onClick={() => dispatch({ type: 'HIT_PESTLE' })}>
              木杵敲击（已击 {state.hitCount} 次）
            </button>
            <button
              className="rounded bg-[#8b5e3c] px-4 py-2 disabled:opacity-40"
              disabled={paper.fragmentationLevel < 80}
              onClick={() => dispatch({ type: 'SIEVE' })}
            >
              过筛
            </button>
          </div>
        )}

        {stage === 'scooping_active' && (
          <div>
            <div
              ref={curtainRef}
              onPointerDown={(e) => onDragStart(e.nativeEvent)}
              onPointerMove={(e) => onDragMove(e.nativeEvent)}
              onPointerUp={handlePointerUp}
              className="flex h-32 w-64 cursor-grab touch-none items-center justify-center rounded border border-[#e8d5b0]/40 bg-[#e8d5b0]/30 select-none"
            >
              竹帘（自上而下匀速拖入水中再捞起）
            </div>
            {state.scoopAttempts > 0 && (
              <p className="mt-2 text-sm">
                {state.needsRescoop ? (
                  <span data-testid="rescoop-hint" className="text-red-300">
                    均匀度低于 {UNIFORMITY_RETRY_THRESHOLD}%，请重抄
                  </span>
                ) : (
                  <span className="text-green-300">均匀度达标，可以压榨</span>
                )}
              </p>
            )}
            <button
              className="mt-3 rounded bg-[#8b5e3c] px-4 py-2 disabled:opacity-40"
              disabled={state.needsRescoop || state.scoopAttempts === 0}
              onClick={() => dispatch({ type: 'PRESS' })}
            >
              压榨（3 秒）
            </button>
          </div>
        )}

        {stage === 'drying_active' && <p className="text-sm">晒纸墙干燥中，光照强度 {LIGHT_INTENSITY}%…</p>}

        {stage === 'finished' && (
          <div className="space-y-3">
            <p>
              水印：{paper.watermark} ｜ 题诗：{paper.poemText || '（无）'}
            </p>
            <button className="rounded bg-[#8b5e3c] px-4 py-2" onClick={() => dispatch({ type: 'RESET' })}>
              再做一张
            </button>
          </div>
        )}

        {stage === 'drying_active' && paper.dryness >= 100 && (
          <div className="flex flex-wrap gap-2">
            {WATERMARKS.map((mark) => (
              <button
                key={mark}
                className="rounded bg-[#e8d5b0] px-3 py-1 text-sm text-[#6b4226]"
                onClick={() => dispatch({ type: 'FINISH', watermark: mark, poemText: '' })}
              >
                盖章「{mark}」
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
