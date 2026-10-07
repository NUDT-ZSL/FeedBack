/**
 * 配置面板：只负责编辑参数并通过 onChange 整体回传配方。
 * 数据流：用户操作 -> 构造新配方 -> onChange -> Home 更新引擎，渲染层自行决定是否重绘。
 */

import {
  BASE_COLORS,
  GOLD_DENSITY_COUNTS,
} from '../core/types.ts';
import type { GoldDensityPreset, PaperRecipe, PatternConfig } from '../core/types.ts';
import { PATTERN_LABELS, PATTERN_TYPES } from '../core/patterns.ts';

interface ConfigPanelProps {
  recipe: PaperRecipe;
  onChange: (recipe: PaperRecipe) => void;
  onReshuffleGold: () => void;
}

const DENSITY_OPTIONS: { value: GoldDensityPreset; label: string }[] = [
  { value: 'sparse', label: '稀疏' },
  { value: 'medium', label: '适中' },
  { value: 'dense', label: '密集' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[#5c3a21]/20 px-4 py-3">
      <h3 className="mb-2 text-sm font-semibold text-[#5c3a21]">{title}</h3>
      {children}
    </section>
  );
}

function Slider({
  label, value, min, max, step, onChange, suffix,
}: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-1 flex items-center gap-2 text-xs text-[#5c3a21]">
      <span className="w-10 shrink-0">{label}</span>
      <input
        type="range"
        className="h-1 flex-1 accent-[#8a5a2b]"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-12 text-right">{value}{suffix ?? ''}</span>
    </label>
  );
}

let newPatternSeq = 0;

export default function ConfigPanel({ recipe, onChange, onReshuffleGold }: ConfigPanelProps) {
  const patch = (partial: Partial<PaperRecipe>): void => onChange({ ...recipe, ...partial });

  const addPattern = (): void => {
    const type = PATTERN_TYPES[recipe.patterns.length % PATTERN_TYPES.length];
    const pattern: PatternConfig = {
      id: `p-${Date.now()}-${(newPatternSeq += 1)}`,
      type,
      scale: 1,
      position: { x: 50, y: 50 },
      rotation: 0,
      opacity: 0.45,
    };
    patch({ patterns: [...recipe.patterns, pattern] });
  };

  const updatePattern = (id: string, update: Partial<PatternConfig>): void => {
    patch({
      patterns: recipe.patterns.map((p) => (p.id === id ? { ...p, ...update } : p)),
    });
  };

  const movePattern = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= recipe.patterns.length) return;
    const patterns = [...recipe.patterns];
    [patterns[index], patterns[target]] = [patterns[target], patterns[index]];
    patch({ patterns });
  };

  const removePattern = (id: string): void => {
    patch({ patterns: recipe.patterns.filter((p) => p.id !== id) });
  };

  return (
    <div className="w-full overflow-y-auto bg-[#ffffff99] backdrop-blur-sm md:w-[300px] md:shrink-0">
      <div className="sticky top-0 z-10 border-b border-[#5c3a21]/20 bg-[#f5e6d3]/90 px-4 py-3">
        <span className="font-['Ma_Shan_Zheng'] text-lg text-[#5c3a21]">笺纸配方</span>
      </div>

      <Section title="宣纸底色">
        <div className="grid grid-cols-3 gap-2">
          {BASE_COLORS.map((color) => (
            <button
              key={color.hex}
              type="button"
              onClick={() => patch({ baseColor: color.hex })}
              className={`rounded-sm border px-1 py-2 text-xs ${
                recipe.baseColor === color.hex
                  ? 'border-2 border-[#d4af37] font-semibold'
                  : 'border-[#5c3a21]/20'
              }`}
              style={{ backgroundColor: color.hex }}
            >
              {color.name}
            </button>
          ))}
        </div>
      </Section>

      <Section title={`印花层叠（${recipe.patterns.length} 枚，自上而下按列表顺序绘制）`}>
        <div className="space-y-2">
          {recipe.patterns.map((pattern, index) => (
            <div key={pattern.id} className="rounded border border-[#5c3a21]/20 bg-white/40 p-2">
              <div className="mb-1 flex items-center gap-1">
                <select
                  className="flex-1 rounded border border-[#5c3a21]/20 bg-white/70 px-1 py-0.5 text-xs"
                  value={pattern.type}
                  onChange={(event) => updatePattern(pattern.id, { type: event.target.value })}
                >
                  {PATTERN_TYPES.map((type) => (
                    <option key={type} value={type}>{PATTERN_LABELS[type]}</option>
                  ))}
                </select>
                <button type="button" className="rounded px-1 text-xs hover:bg-[#d4af37]/20"
                  onClick={() => movePattern(index, -1)} disabled={index === 0}>↑</button>
                <button type="button" className="rounded px-1 text-xs hover:bg-[#d4af37]/20"
                  onClick={() => movePattern(index, 1)} disabled={index === recipe.patterns.length - 1}>↓</button>
                <button type="button" className="rounded px-1 text-xs text-[#8b3a2b] hover:bg-[#8b3a2b]/10"
                  onClick={() => removePattern(pattern.id)}>删</button>
              </div>
              <Slider label="大小" value={pattern.scale} min={0.5} max={3} step={0.05}
                suffix="x" onChange={(scale) => updatePattern(pattern.id, { scale })} />
              <Slider label="旋转" value={pattern.rotation} min={0} max={355} step={5}
                suffix="°" onChange={(rotation) => updatePattern(pattern.id, { rotation })} />
              <Slider label="透明" value={pattern.opacity} min={0.3} max={0.6} step={0.01}
                onChange={(opacity) => updatePattern(pattern.id, { opacity })} />
              <Slider label="位置X" value={pattern.position.x} min={0} max={100} step={1}
                suffix="%" onChange={(x) => updatePattern(pattern.id, { position: { ...pattern.position, x } })} />
              <Slider label="位置Y" value={pattern.position.y} min={0} max={100} step={1}
                suffix="%" onChange={(y) => updatePattern(pattern.id, { position: { ...pattern.position, y } })} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addPattern}
          className="mt-2 w-full rounded border border-[#8a5a2b] bg-gradient-to-b from-[#a67040] to-[#7a4f28] py-1.5 text-xs text-[#f5e6d3] shadow hover:-translate-y-0.5 hover:shadow-md"
        >
          添一枚印花
        </button>
      </Section>

      <Section title="洒金工艺">
        <div className="flex gap-2">
          {DENSITY_OPTIONS.map((option) => {
            const active = recipe.goldFoil.density === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => patch({ goldFoil: { ...recipe.goldFoil, density: option.value } })}
                className={`flex-1 rounded border py-1.5 text-xs ${
                  active ? 'border-2 border-[#d4af37] bg-[#d4af37]/20 font-semibold' : 'border-[#5c3a21]/20'
                }`}
              >
                {option.label} {GOLD_DENSITY_COUNTS[option.value]}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onReshuffleGold}
          className="mt-2 w-full rounded border border-[#8a5a2b]/40 py-1 text-xs text-[#5c3a21] hover:bg-[#d4af37]/10"
        >
          重新排布金箔（更换随机种子）
        </button>
      </Section>

      <Section title="题字排版">
        <input
          type="text"
          className="mb-2 w-full rounded border border-[#5c3a21]/20 bg-white/70 px-2 py-1 text-sm"
          placeholder="输入题字，如：清风徐来"
          value={recipe.inscription.text}
          onChange={(event) =>
            patch({ inscription: { ...recipe.inscription, text: event.target.value } })
          }
        />
        <Slider label="字号" value={recipe.inscription.fontSize} min={8} max={120} step={1}
          onChange={(fontSize) => patch({ inscription: { ...recipe.inscription, fontSize } })} />
        <Slider label="题字X" value={recipe.inscription.position.x} min={0} max={100} step={1}
          suffix="%" onChange={(x) => patch({ inscription: {
            ...recipe.inscription, position: { ...recipe.inscription.position, x },
          } })} />
        <Slider label="题字Y" value={recipe.inscription.position.y} min={0} max={100} step={1}
          suffix="%" onChange={(y) => patch({ inscription: {
            ...recipe.inscription, position: { ...recipe.inscription.position, y },
          } })} />
        <div className="mt-1 flex items-center gap-3 text-xs text-[#5c3a21]">
          {(['right', 'center', 'left'] as const).map((align) => (
            <label key={align} className="flex items-center gap-1">
              <input
                type="radio"
                name="inscription-align"
                checked={recipe.inscription.align === align}
                onChange={() => patch({ inscription: { ...recipe.inscription, align } })}
              />
              {align === 'right' ? '右起' : align === 'center' ? '居中' : '左起'}
            </label>
          ))}
          <label className="ml-auto flex items-center gap-1">
            <input
              type="checkbox"
              checked={recipe.inscription.vertical}
              onChange={(event) => patch({ inscription: { ...recipe.inscription, vertical: event.target.checked } })}
            />
            竖排
          </label>
        </div>
      </Section>
    </div>
  );
}
