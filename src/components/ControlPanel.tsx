import { MAX_GAP, MIN_GAP } from '../MillCore';

interface ControlPanelProps {
  valveOpening: number;
  gap: number;
  wheelSpeed: number;
  load: number;
  onValveChange: (value: number) => void;
  onGapChange: (value: number) => void;
}

const panelStyle: React.CSSProperties = {
  background: '#e8d5b0',
  border: '2px solid #8b5a2b',
  borderRadius: 8,
  color: '#5a3a1a',
};

export default function ControlPanel({
  valveOpening,
  gap,
  wheelSpeed,
  load,
  onValveChange,
  onGapChange,
}: ControlPanelProps) {
  return (
    <div className="rounded-lg p-4" style={panelStyle}>
      <h3 className="mb-3 text-base font-bold">操作控制</h3>

      <label className="mb-1 block text-sm font-semibold">
        水流阀门 {valveOpening.toFixed(0)}%
      </label>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={valveOpening}
        onChange={(e) => onValveChange(Number(e.target.value))}
        className="mb-3 w-full accent-amber-800"
        aria-label="水流阀门开度"
      />

      <label className="mb-1 block text-sm font-semibold">
        磨盘间隙 {gap.toFixed(1)}mm
      </label>
      <input
        type="range"
        min={MIN_GAP}
        max={MAX_GAP}
        step={0.1}
        value={gap}
        onChange={(e) => onGapChange(Number(e.target.value))}
        className="mb-3 w-full accent-amber-800"
        aria-label="磨盘间隙"
      />

      <div className="grid grid-cols-2 gap-2 text-center text-sm">
        <div className="rounded p-2" style={{ background: '#d9c196' }}>
          <div className="text-xs">水轮转速</div>
          <div className="text-lg font-bold">{wheelSpeed.toFixed(1)}</div>
        </div>
        <div className="rounded p-2" style={{ background: '#d9c196' }}>
          <div className="text-xs">磨盘负载</div>
          <div
            className="text-lg font-bold"
            style={{ color: load > 85 ? '#dc2626' : '#5a3a1a' }}
          >
            {load.toFixed(0)}%
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed" style={{ color: '#7a5a34' }}>
        调整阀门或间隙后，之后的产出按新状态计入新分段；已打包批次的历史依据保持不变。
      </p>
    </div>
  );
}
