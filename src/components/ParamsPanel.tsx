import { Dices } from "lucide-react";
import { BLEND_MODES, SHAPE_TYPES } from "@/lib/art/types";
import { useArtStore } from "@/store/useArtStore";
import Slider from "./Slider";

const SHAPE_LABELS: Record<string, string> = {
  circle: "圆形",
  triangle: "三角形",
  rect: "矩形",
  star: "星形",
  ring: "圆环",
};

export default function ParamsPanel() {
  const layers = useArtStore((s) => s.layers);
  const selectedId = useArtStore((s) => s.selectedId);
  const { updateLayer, randomizeSeed } = useArtStore();

  const layer = layers.find((l) => l.id === selectedId);

  if (!layer) {
    return (
      <p className="px-3 py-6 text-center text-xs text-neutral-400">
        {layers.length === 0 ? "请先添加一个图层" : "请选择一个图层"}
      </p>
    );
  }

  const set = (patch: Parameters<typeof updateLayer>[1]) => updateLayer(layer.id, patch);

  return (
    <div className="space-y-4 px-3 py-2">
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          生成参数
        </h3>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">形状类型</span>
          <select
            value={layer.shapeType}
            onChange={(e) => set({ shapeType: e.target.value as typeof layer.shapeType })}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-white/10 dark:bg-white/5 dark:text-neutral-100"
          >
            {SHAPE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SHAPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <Slider label="数量" value={layer.count} min={0} max={200} step={1} onChange={(v) => set({ count: v })} />
        <Slider
          label="尺寸下限（短边比例）"
          value={layer.minSize}
          min={0}
          max={0.5}
          step={0.005}
          onChange={(v) => set({ minSize: v })}
          format={(v) => v.toFixed(3)}
        />
        <Slider
          label="尺寸上限（短边比例）"
          value={layer.maxSize}
          min={0}
          max={0.5}
          step={0.005}
          onChange={(v) => set({ maxSize: v })}
          format={(v) => v.toFixed(3)}
        />
        <Slider
          label="旋转范围（度）"
          value={layer.rotation}
          min={0}
          max={360}
          step={1}
          onChange={(v) => set({ rotation: v })}
        />
        <Slider
          label="基础色相"
          value={layer.baseHue}
          min={0}
          max={360}
          step={1}
          onChange={(v) => set({ baseHue: v })}
          format={(v) => `${v}°`}
        />

        <div>
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">随机种子</span>
          <div className="flex gap-1">
            <input
              type="number"
              value={layer.seed}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) set({ seed: Math.trunc(v) });
              }}
              className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-sm dark:border-white/10 dark:bg-white/5 dark:text-neutral-100"
            />
            <button
              title="换一批形状（仅更换种子）"
              onClick={() => randomizeSeed(layer.id)}
              className="flex shrink-0 items-center gap-1 rounded-md bg-neutral-200 px-2 text-sm text-neutral-700 hover:bg-neutral-300 dark:bg-white/10 dark:text-neutral-200 dark:hover:bg-white/20"
            >
              <Dices size={15} />
            </button>
          </div>
          <p className="mt-1 text-[10px] leading-tight text-neutral-400">
            相同种子与参数永远生成相同形状
          </p>
        </div>
      </section>

      <section className="space-y-3 border-t border-neutral-200 pt-3 dark:border-white/10">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          合成参数
        </h3>
        <Slider
          label="透明度"
          value={layer.opacity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => set({ opacity: v })}
          format={(v) => v.toFixed(2)}
        />
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">混合模式</span>
          <select
            value={layer.blendMode}
            onChange={(e) => set({ blendMode: e.target.value as typeof layer.blendMode })}
            className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-xs dark:border-white/10 dark:bg-white/5 dark:text-neutral-100"
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={layer.visible}
            onChange={(e) => set({ visible: e.target.checked })}
            className="accent-indigo-500"
          />
          图层可见
        </label>
      </section>
    </div>
  );
}
