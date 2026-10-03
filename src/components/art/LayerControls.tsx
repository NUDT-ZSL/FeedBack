import { Dices } from 'lucide-react';
import { BLEND_MODES, SHAPE_KINDS } from '@/art/types';
import { useArtStore } from '@/store/artStore';
import Slider from './Slider';

const SHAPE_LABELS: Record<string, string> = {
  circle: '圆形',
  square: '方形',
  triangle: '三角形',
  polygon: '多边形',
  mixed: '混合',
};

const BLEND_LABELS: Record<string, string> = {
  'source-over': '正常',
  multiply: '正片叠底',
  screen: '滤色',
  overlay: '叠加',
  darken: '变暗',
  lighten: '变亮',
  'color-dodge': '颜色减淡',
  'color-burn': '颜色加深',
  'hard-light': '强光',
  'soft-light': '柔光',
  difference: '差值',
  exclusion: '排除',
  hue: '色相',
  saturation: '饱和度',
  color: '颜色',
  luminosity: '明度',
};

export default function LayerControls() {
  const layers = useArtStore((s) => s.layers);
  const selectedId = useArtStore((s) => s.selectedId);
  const { updateLayer, rerollSeed } = useArtStore();
  const layer = layers.find((l) => l.id === selectedId) ?? null;

  if (!layer) {
    return (
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          图层参数
        </h2>
        <p className="rounded-md border border-dashed border-gray-300 p-3 text-center text-xs text-gray-400 dark:border-gray-600">
          选中一个图层以编辑参数
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        图层参数 · {layer.name}
      </h2>

      <label className="block">
        <span className="mb-1 block text-xs text-gray-600 dark:text-gray-300">形状类型</span>
        <select
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-white/5"
          value={layer.shape}
          onChange={(e) => updateLayer(layer.id, { shape: e.target.value as typeof layer.shape })}
        >
          {SHAPE_KINDS.map((k) => (
            <option key={k} value={k}>{SHAPE_LABELS[k]}</option>
          ))}
        </select>
      </label>

      <Slider label="数量" value={layer.count} min={0} max={200} step={1}
        onChange={(v) => updateLayer(layer.id, { count: v })} />
      <Slider label="最小尺寸" value={layer.minSize} min={0} max={0.5} step={0.005}
        format={(v) => v.toFixed(3)}
        onChange={(v) => updateLayer(layer.id, { minSize: v })} />
      <Slider label="最大尺寸" value={layer.maxSize} min={0} max={0.5} step={0.005}
        format={(v) => v.toFixed(3)}
        onChange={(v) => updateLayer(layer.id, { maxSize: v })} />
      <Slider label="旋转范围" value={layer.rotation} min={0} max={360} step={1}
        format={(v) => `±${v}°`}
        onChange={(v) => updateLayer(layer.id, { rotation: v })} />
      <Slider label="不透明度" value={layer.opacity} min={0} max={1} step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => updateLayer(layer.id, { opacity: v })} />

      <label className="block">
        <span className="mb-1 block text-xs text-gray-600 dark:text-gray-300">混合模式</span>
        <select
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-white/5"
          value={layer.blendMode}
          onChange={(e) => updateLayer(layer.id, { blendMode: e.target.value as typeof layer.blendMode })}
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>{BLEND_LABELS[m] ?? m}</option>
          ))}
        </select>
      </label>

      <div>
        <span className="mb-1 block text-xs text-gray-600 dark:text-gray-300">随机种子</span>
        <div className="flex gap-2">
          <input
            type="number"
            className="w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-sm dark:border-gray-600 dark:bg-white/5"
            value={layer.seed}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) updateLayer(layer.id, { seed: Math.trunc(v) >>> 0 });
            }}
          />
          <button
            title="换一批形状（仅更换种子，其他参数不变）"
            onClick={() => rerollSeed(layer.id)}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs transition hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-white/10"
          >
            <Dices size={14} /> 换一批
          </button>
        </div>
      </div>
    </section>
  );
}
