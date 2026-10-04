import { motion } from 'framer-motion';
import type { DyeingParams, DyeingResult } from '@/simulation';

interface GameBoardProps {
  result: DyeingResult;
  params: DyeingParams;
  onParamsChange: (patch: Partial<DyeingParams>) => void;
  lockedSeconds: number;
  onLift: () => void;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ReadoutItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#f5f0e1] px-3 py-2">
      <div className="text-xs text-[#8b7b68]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-[#5a3d2b]">{value}</div>
    </div>
  );
}

function ParamSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-sm text-[#5a4a38]">
        <span>{label}</span>
        <span className="font-semibold text-[#5a3d2b]">
          {value}
          {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full accent-[#0a2c5d]"
      />
    </label>
  );
}

export default function GameBoard({
  result,
  params,
  onParamsChange,
  lockedSeconds,
  onLift,
}: GameBoardProps) {
  const isLocked = lockedSeconds > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ReadoutItem label="浸染次数" value={`${result.dipCount} 次`} />
        <ReadoutItem label="氧化进度" value={percent(result.oxidationProgress)} />
        <ReadoutItem label="着色深度" value={percent(result.colorDepth)} />
        <ReadoutItem label="当前色阶" value={`${result.stage + 1} / 10`} />
        <ReadoutItem label="染液浓度" value={percent(result.dyeConcentration)} />
        <ReadoutItem label="染液消耗量" value={percent(result.concentrationLoss)} />
      </div>

      <div className="relative mx-auto flex h-[360px] w-full max-w-[420px] items-end justify-center overflow-hidden rounded-2xl bg-[#e8dcc8]/50 pb-2">
        <div className="relative flex h-[300px] w-[320px] items-end justify-center">
          <motion.div
            key={result.dipCount}
            className="absolute top-0 z-10 h-[180px] w-[60px] rounded-t-sm shadow-md"
            style={{
              background: `linear-gradient(to bottom, ${result.colorHex}, ${result.colorHex})`,
              backgroundColor: result.colorHex,
              transition: 'background-color 0.5s ease-in-out',
            }}
            initial={{ y: 30 }}
            animate={{ y: 0, rotate: [0, -3, 3, -2, 0] }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          />

          <div className="absolute top-[136px] z-40 flex w-[300px] justify-center">
            <span key={`bubble-${result.dipCount}-1`} className="bubble mr-16 h-2.5 w-2.5 rounded-full bg-white/40" />
            <span key={`bubble-${result.dipCount}-2`} className="bubble mr-8 mt-4 h-3.5 w-3.5 rounded-full bg-white/30" style={{ animationDelay: '0.8s' }} />
            <span key={`bubble-${result.dipCount}-3`} className="bubble ml-20 mt-2 h-2 w-2 rounded-full bg-white/50" style={{ animationDelay: '1.6s' }} />
          </div>

          <div className="absolute top-[120px] z-30 h-[150px] w-[300px] overflow-hidden rounded-b-[150px] border-[6px] border-[#8b5e3c] bg-[#8b5e3c]">
            <div
              className="absolute inset-0"
              style={{
                background: 'radial-gradient(ellipse at 50% 0%, #1a4a3a 0%, #0d2b1e 100%)',
              }}
            />
          </div>

          <div className="absolute bottom-0 z-40 h-[44px] w-[340px] rounded-[50%] bg-[#5a3d2b] shadow-lg" />
        </div>
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onLift}
          disabled={isLocked}
          className={
            isLocked
              ? 'min-w-[160px] cursor-not-allowed rounded-full bg-gray-400 px-8 py-3 text-lg font-semibold text-white'
              : 'min-w-[160px] rounded-full bg-[#0a2c5d] px-8 py-3 text-lg font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#0d3a7a] active:translate-y-0'
          }
        >
          {isLocked ? `氧化中 ${lockedSeconds}s` : '提拉一次'}
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-xl bg-[#f5f0e1] p-4">
        <ParamSlider
          label="染液浓度"
          unit="%"
          min={0}
          max={100}
          step={1}
          value={Math.round(params.dyeConcentration * 100)}
          onChange={(v) => onParamsChange({ dyeConcentration: v / 100 })}
        />
        <ParamSlider
          label="单次浸染时长"
          unit=" 秒"
          min={0}
          max={60}
          step={1}
          value={params.dipDurationSec}
          onChange={(v) => onParamsChange({ dipDurationSec: v })}
        />
        <ParamSlider
          label="单次晾晒（氧化）时长"
          unit=" 秒"
          min={0}
          max={60}
          step={1}
          value={params.airDrySec}
          onChange={(v) => onParamsChange({ airDrySec: v })}
        />
      </div>
    </div>
  );
}
