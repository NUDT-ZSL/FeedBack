import type { ScenarioInput } from '@/simulation';
import { NumberField } from './NumberField';

interface ParameterPanelProps {
  scenario: ScenarioInput;
  onChange: (next: ScenarioInput) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-emerald-900/15 bg-white/60 p-3">
      <h3 className="mb-2 text-sm font-semibold text-emerald-900">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** 参数面板：只负责编辑输入，推演结果一律由引擎产出 */
export function ParameterPanel({ scenario, onChange }: ParameterPanelProps) {
  const update = (mutate: (draft: ScenarioInput) => void) => {
    const draft: ScenarioInput = JSON.parse(JSON.stringify(scenario));
    mutate(draft);
    onChange(draft);
  };

  return (
    <div className="space-y-3">
      <Section title="全局来水">
        <NumberField
          label="上游来水量 / tick"
          value={scenario.upstreamInflow}
          min={0}
          step={5}
          onChange={(v) => update((d) => { d.upstreamInflow = v; })}
        />
        <NumberField
          label="推演步数 (tick)"
          value={scenario.ticks}
          min={1}
          step={1}
          onChange={(v) => update((d) => { d.ticks = Math.max(1, Math.round(v)); })}
        />
      </Section>

      <Section title="水车工况">
        {scenario.wheels.map((wheel, index) => (
          <div key={wheel.id} className="rounded border border-stone-200 bg-white/50 p-2">
            <p className="mb-1 text-xs font-medium text-stone-800">{wheel.name}</p>
            <div className="space-y-1">
              <NumberField label="闸门开度 %" value={wheel.gateOpening} min={0} max={100}
                onChange={(v) => update((d) => { d.wheels[index].gateOpening = v; })} />
              <NumberField label="风帆角度 °" value={wheel.sailAngle} min={0} max={90}
                onChange={(v) => update((d) => { d.wheels[index].sailAngle = v; })} />
              <NumberField label="提水效率" value={wheel.liftEfficiency} min={0} step={0.1}
                onChange={(v) => update((d) => { d.wheels[index].liftEfficiency = v; })} />
            </div>
          </div>
        ))}
      </Section>

      <Section title="渠道分流">
        {scenario.channels.map((channel, index) => (
          <div key={channel.id} className="rounded border border-stone-200 bg-white/50 p-2">
            <p className="mb-1 text-xs font-medium text-stone-800">{channel.name}</p>
            <NumberField label="分流比例" value={channel.shareRatio} min={0} max={1} step={0.05}
              onChange={(v) => update((d) => { d.channels[index].shareRatio = v; })} />
          </div>
        ))}
        <p className="text-[11px] text-stone-500">
          分流比例合计 {(scenario.channels.reduce((acc, c) => acc + c.shareRatio, 0)).toFixed(2)}（应 ≤ 1，余量为未分配弃水）
        </p>
      </Section>

      <Section title="田块与作物">
        {scenario.fields.map((field, index) => (
          <div key={field.id} className="rounded border border-stone-200 bg-white/50 p-2">
            <p className="mb-1 text-xs font-medium text-stone-800">{field.name}</p>
            <div className="space-y-1">
              <NumberField label="蓄水容量" value={field.capacity} min={1}
                onChange={(v) => update((d) => { d.fields[index].capacity = v; })} />
              <NumberField label="初始蓄水" value={field.initialStorage} min={0}
                onChange={(v) => update((d) => { d.fields[index].initialStorage = v; })} />
              <NumberField label="蒸散 / tick" value={field.evaporationRate} min={0}
                onChange={(v) => update((d) => { d.fields[index].evaporationRate = v; })} />
              <NumberField label="作物需水阈值" value={field.cropDemandThreshold} min={0}
                onChange={(v) => update((d) => { d.fields[index].cropDemandThreshold = v; })} />
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
}
