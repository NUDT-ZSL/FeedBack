import { useEffect, useMemo, useRef, useState } from "react";
import { compositeLayers, renderLayer } from "@/lib/art/render";
import type { Layer } from "@/lib/art/types";
import { useArtStore } from "@/store/useArtStore";
import { useTheme } from "@/hooks/useTheme";

/** 只取生成相关参数作为缓存键：合成参数变化不会触发重新生成 */
function generationKey(layer: Layer): string {
  return [
    layer.id,
    layer.seed,
    layer.shapeType,
    layer.count,
    layer.minSize,
    layer.maxSize,
    layer.rotation,
    layer.baseHue,
  ].join("|");
}

export default function CanvasView() {
  const layers = useArtStore((s) => s.layers);
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setSize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const pixelWidth = Math.max(1, Math.round(size.width * dpr));
  const pixelHeight = Math.max(1, Math.round(size.height * dpr));

  // 第一层：每层形状序列只在生成参数变化时重算（隐藏层无需栅格化）
  const layerCanvases = useMemo(() => {
    return layers
      .filter((layer) => layer.visible)
      .map((layer) => ({ layer, canvas: renderLayer(layer, pixelWidth, pixelHeight) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.map(generationKey).join("#"), pixelWidth, pixelHeight]);

  // 第二、三层：按当前顺序 / 可见性 / 透明度 / 混合模式合成输出
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const visible = new Set(layerCanvases.map((c) => c.layer.id));
    const ordered = layers
      .filter((layer) => visible.has(layer.id))
      .map((layer) => ({
        layer,
        canvas: layerCanvases.find((c) => c.layer.id === layer.id)!.canvas,
      }));
    compositeLayers(ctx, ordered, pixelWidth, pixelHeight, {
      background: isDark ? "#1a1a2e" : "#f4f1ea",
    });
  }, [layers, layerCanvases, pixelWidth, pixelHeight, size.width, isDark]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height }}
        className="block"
      />
    </div>
  );
}
