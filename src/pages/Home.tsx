import { useEffect, useReducer, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { v4 as uuidv4 } from 'uuid';
import { DyeSession, type DyeRecord } from '@/engine/dyeSession';
import { COLOR_STAGES, MIN_INTERVAL_SEC, type DyeDerivation } from '@/engine/dyeEngine';

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-[#f5f0e1] px-3 py-2">
      <span className="text-xs text-[#8b5e3c]">{label}</span>
      <span className="text-lg font-semibold text-[#3d2b1f]">{value}</span>
    </div>
  );
}

function ParamSlider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-[#5a3d2b]">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 accent-[#8b5e3c]"
      />
      <span className="w-16 text-right font-medium">{display}</span>
    </label>
  );
}

function RecordCard({ record, onRevert }: { record: DyeRecord; onRevert: (round: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onRevert(record.round)}
      className="flex w-full items-center gap-3 rounded-lg bg-[#f5f0e1] px-3 py-2 text-left transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#e8dcc8] hover:shadow-md"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
        style={{ backgroundColor: record.colorHex, width: 10, height: 10 }}
      />
      <span className="flex-1 text-sm text-[#3d2b1f]">
        第 {record.round} 轮 · 氧化 {record.oxidationSeconds}s
      </span>
      <span className="text-xs text-[#8b5e3c]">
        {new Date(record.timestamp).toLocaleTimeString('zh-CN')}
      </span>
    </button>
  );
}

function CompletionModal({
  records,
  onExport,
  onClose,
}: {
  records: readonly DyeRecord[];
  onExport: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="max-h-[80vh] w-[420px] overflow-y-auto rounded-xl bg-[#f5f0e1] p-6 shadow-2xl">
        <h2 className="mb-1 text-xl font-bold text-[#3d2b1f]">蓝染完成</h2>
        <p className="mb-4 text-sm text-[#8b5e3c]">布料已染至最深色阶，共 {records.length} 轮浸染。</p>
        <ol className="mb-4 space-y-1 border-l-2 border-[#8b5e3c]/40 pl-4">
          {records.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm text-[#3d2b1f]">
              <span className="inline-block rounded-sm" style={{ backgroundColor: r.colorHex, width: 10, height: 10 }} />
              第 {r.round} 轮 · {r.colorHex} · 氧化 {r.oxidationSeconds}s
            </li>
          ))}
        </ol>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onExport}
            className="flex-1 rounded-lg bg-[#8b5e3c] py-2 text-sm font-medium text-white transition-transform hover:-translate-y-0.5"
          >
            导出记录
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg bg-[#e8dcc8] py-2 text-sm font-medium text-[#5a3d2b] transition-transform hover:-translate-y-0.5"
          >
            继续查看
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const sessionRef = useRef<DyeSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = new DyeSession();
  }
  const session = sessionRef.current;
  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [modalDismissed, setModalDismissed] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  const snapshot = session.snapshot();
  const derivation: DyeDerivation = snapshot.derivation;
  const remainingMs = session.oxidationRemainingMs(nowMs);
  const canDip = remainingMs <= 0;
  const countdownSec = Math.ceil(remainingMs / 1000);
  const showModal = derivation.completed && !modalDismissed;

  const handleDip = () => {
    const outcome = session.dip(uuidv4(), Date.now());
    if (outcome.applied) {
      setModalDismissed(false);
    }
    forceRender();
  };

  const handleRevert = (round: number) => {
    session.revertTo(round);
    setModalDismissed(false);
    forceRender();
  };

  const handleExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      params: snapshot.params,
      derivation: snapshot.derivation,
      records: snapshot.records,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `indigo-dye-records-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex min-h-screen flex-col gap-6 p-6 text-[#3d2b1f] lg:flex-row">
      {/* 左侧：染缸操作区 */}
      <section className="flex flex-[3] flex-col items-center gap-4">
        <h1 className="text-2xl font-bold tracking-widest">古代蓝染工坊</h1>

        <div className="grid w-full max-w-xl grid-cols-3 gap-2 sm:grid-cols-5">
          <StatItem label="浸染次数" value={`${derivation.dipCount}`} />
          <StatItem label="氧化进度" value={pct(derivation.oxidationProgress)} />
          <StatItem label="着色深度" value={pct(derivation.colorDepth)} />
          <StatItem label="剩余染液" value={pct(derivation.concentrationAfter)} />
          <StatItem label="染液消耗" value={pct(derivation.concentrationConsumed)} />
        </div>

        <div className="w-full max-w-xl space-y-2 rounded-xl bg-[#e8dcc8]/60 p-4">
          <ParamSlider
            label="染液浓度"
            min={0}
            max={1}
            step={0.05}
            value={snapshot.params.dyeConcentration}
            display={pct(snapshot.params.dyeConcentration)}
            onChange={(v) => {
              session.setParams({ dyeConcentration: v });
              forceRender();
            }}
          />
          <ParamSlider
            label="浸染时长"
            min={1}
            max={60}
            step={1}
            value={snapshot.params.dipDurationSec}
            display={`${snapshot.params.dipDurationSec}s`}
            onChange={(v) => {
              session.setParams({ dipDurationSec: v });
              forceRender();
            }}
          />
          <ParamSlider
            label="晾晒时长"
            min={0}
            max={30}
            step={1}
            value={snapshot.params.airDurationSec}
            display={`${snapshot.params.airDurationSec}s`}
            onChange={(v) => {
              session.setParams({ airDurationSec: v });
              forceRender();
            }}
          />
        </div>

        {/* 染缸与布料 */}
        <div className="relative mt-2 flex flex-col items-center">
          <motion.div
            key={derivation.dipCount}
            initial={{ y: 40 }}
            animate={{ y: [40, -30, -24, -30, -24], rotate: [0, -2, 2, -1, 0] }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
            className="z-10 rounded-sm shadow-md transition-colors duration-500 ease-in-out"
            style={{ backgroundColor: derivation.colorHex, width: 60, height: 180 }}
          />
          <div
            className="relative -mt-3 h-[150px] w-[300px] overflow-hidden rounded-b-[150px] border-4 border-[#8b5e3c]"
            style={{ background: 'radial-gradient(circle at 50% 0%, #1a4a3a 0%, #0d2b1e 100%)' }}
          >
            {[8, 11, 14].map((size, i) => (
              <span
                key={i}
                className="absolute animate-pulse rounded-full bg-white/30"
                style={{
                  width: size,
                  height: size,
                  left: `${25 + i * 22}%`,
                  top: `${30 + (i % 2) * 30}%`,
                  animationDuration: '4s',
                  animationDelay: `${i * 0.8}s`,
                }}
              />
            ))}
          </div>
          <div className="-mt-2 h-6 w-40 rounded-full bg-[#5a3d2b]" />
        </div>

        <button
          type="button"
          onClick={handleDip}
          disabled={!canDip}
          className={`rounded-full px-8 py-3 text-lg font-semibold transition-all ${
            canDip
              ? 'bg-[#8b5e3c] text-white hover:-translate-y-0.5 hover:shadow-lg'
              : 'cursor-not-allowed bg-gray-400 text-gray-200'
          }`}
        >
          {canDip ? '提拉一次' : `氧化中 ${countdownSec}s`}
        </button>
        <p className="text-xs text-[#8b5e3c]">
          当前色阶 {derivation.stageIndex + 1} / {COLOR_STAGES.length} · {derivation.colorHex} ·
          两次提拉至少间隔 {MIN_INTERVAL_SEC}s
        </p>
      </section>

      {/* 右侧：浸染记录表 */}
      <aside className="flex flex-[2] flex-col rounded-xl bg-[#e8dcc8]/40 p-4">
        <h2 className="mb-3 text-lg font-semibold">浸染记录</h2>
        <div className="flex-1 space-y-2 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
          {snapshot.records.length === 0 && (
            <p className="py-8 text-center text-sm text-[#8b5e3c]">尚未开始浸染，点击"提拉一次"试试</p>
          )}
          {snapshot.records.map((record) => (
            <RecordCard key={record.id} record={record} onRevert={handleRevert} />
          ))}
        </div>
      </aside>

      {showModal && (
        <CompletionModal
          records={snapshot.records}
          onExport={handleExport}
          onClose={() => setModalDismissed(true)}
        />
      )}
    </div>
  );
}
