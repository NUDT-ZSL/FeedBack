import { useEffect, useMemo, useRef } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH, renderComposition } from '@/art/composite';
import type { Shape } from '@/art/types';
import { getLayerShapes, useArtStore } from '@/store/artStore';

export default function ArtCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layers = useArtStore((s) => s.layers);

  // 第一层：按种子确定性生成每层形状（带缓存，合成参数变化不会触发重算）
  const shapesByLayer = useMemo(() => {
    const map = new Map<string, Shape[]>();
    for (const layer of layers) {
      map.set(layer.id, getLayerShapes(layer));
    }
    return map;
  }, [layers]);

  // 第二、三层：按图层顺序与混合模式合成，输出到画布
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    renderComposition(ctx, { layers, shapesByLayer });
  }, [layers, shapesByLayer]);

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="max-h-full max-w-full rounded-lg shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
        style={{ aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
      />
    </div>
  );
}
