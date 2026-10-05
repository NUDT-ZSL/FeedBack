import { scenarios } from '@/simulation/scenarios';
import { useSimulationStore } from '@/store/simulationStore';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, unit, onChange }: SliderProps) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs text-stone-600">
        <span>{label}</span>
        <span className="font-mono text-stone-800">
          {value}
          {unit ?? ''}
        </span>
      </div>
      <input
        type="range"
        className="w-full accent-emerald-700"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function ParameterPanel() {
  const params = useSimulationStore((state) => state.params);
  const activeScenarioId = useSimulationStore((state) => state.activeScenarioId);
  const setParams = useSimulationStore((state) => state.setParams);
  const applyScenario = useSimulationStore((state) => state.applyScenario);
  const reset = useSimulationStore((state) => state.reset);

  return (
    <aside className="w-80 shrink-0 space-y-4 overflow-y-auto rounded-lg bg-white/70 p-4 shadow backdrop-blur">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-emerald-900">批量场景</h2>
        <div className="flex flex-wrap gap-1.5">
          {scenarios().map((scenario, index) => (
            <button
              key={scenario.id}
              title={scenario.description}
              onClick={() => applyScenario(index)}
              className={`rounded-md border px-2 py-1 text-xs transition hover:scale-105 ${
                activeScenarioId === scenario.id
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-emerald-800/30 bg-white/60 text-emerald-900'
              }`}
            >
              {scenario.title}
            </button>
          ))}
          <button
            onClick={reset}
            className="rounded-md border border-stone-400/50 bg-white/60 px-2 py-1 text-xs text-stone-700 transition hover:scale-105"
          >
            恢复基准
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-emerald-900">水源与水车</h2>
        <Slider
          label="上游来水量（每刻）"
          value={params.upstreamInflow}
          min={0}
          max={15}
          step={0.5}
          onChange={(value) => setParams((draft) => { draft.upstreamInflow = value; })}
        />
        <Slider
          label="闸门开度"
          value={params.wheel.gateOpening}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(value) => setParams((draft) => { draft.wheel.gateOpening = value; })}
        />
        <Slider
          label="风帆角度"
          value={params.wheel.sailAngle}
          min={0}
          max={90}
          step={1}
          unit="°"
          onChange={(value) => setParams((draft) => { draft.wheel.sailAngle = value; })}
        />
        <Slider
          label="提水系数"
          value={params.wheel.liftCoefficient}
          min={0}
          max={20}
          step={0.5}
          onChange={(value) => setParams((draft) => { draft.wheel.liftCoefficient = value; })}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-emerald-900">渠道分流比例</h2>
        {params.channels.map((channel, index) => (
          <Slider
            key={channel.id}
            label={`${channel.name}（${channel.id}）`}
            value={channel.ratio}
            min={0}
            max={0.8}
            step={0.05}
            onChange={(value) =>
              setParams((draft) => { draft.channels[index].ratio = value; })
            }
          />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-emerald-900">田块参数</h2>
        {params.fields.map((field, index) => (
          <div key={field.id} className="space-y-1 rounded-md bg-emerald-950/5 p-2">
            <div className="text-xs font-medium text-stone-700">
              {field.name}（{field.channelId}）
            </div>
            <Slider
              label="容量"
              value={field.capacity}
              min={10}
              max={80}
              step={1}
              onChange={(value) =>
                setParams((draft) => { draft.fields[index].capacity = value; })
              }
            />
            <Slider
              label="作物需水阈值"
              value={field.cropThreshold}
              min={0}
              max={0.9}
              step={0.05}
              onChange={(value) =>
                setParams((draft) => { draft.fields[index].cropThreshold = value; })
              }
            />
            <Slider
              label="每刻耗水"
              value={field.consumptionRate}
              min={0}
              max={2}
              step={0.1}
              onChange={(value) =>
                setParams((draft) => { draft.fields[index].consumptionRate = value; })
              }
            />
          </div>
        ))}
      </section>
    </aside>
  );
}
