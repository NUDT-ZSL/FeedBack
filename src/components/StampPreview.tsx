import { useEffect, useRef, useState } from 'react';
import { Download, Stamp } from 'lucide-react';
import type { SealDocument } from '../types/index.ts';
import { downloadSealPNG, renderSealToCanvas } from '../utils/sealGenerator.ts';

interface Impression {
  id: string;
  sealId: string;
  sealName: string;
  imageData: string;
  rotation: number;
  stampedAt: number;
}

/**
 * 盖印预览：始终渲染传入的当前印章最新状态。
 * 组件以 seal.id 作为 key 挂载，切换印章即整体重建，画布不会残留上一方的图像。
 */
export default function StampPreview({ seal }: { seal: SealDocument }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [impressions, setImpressions] = useState<Impression[]>([]);

  useEffect(() => {
    if (canvasRef.current) {
      renderSealToCanvas(seal, canvasRef.current);
    }
  }, [seal]);

  const stamp = () => {
    const canvas = canvasRef.current;
    if (!canvas || !seal.text) return;
    setImpressions((list) => [
      ...list,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sealId: seal.id,
        sealName: seal.name,
        imageData: canvas.toDataURL('image/png'),
        rotation: (Math.random() - 0.5) * 6,
        stampedAt: Date.now(),
      },
    ]);
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="rounded-md p-6 shadow-inner"
        style={{
          backgroundColor: '#f8f2e0',
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(180,160,120,0.08) 0 1px, transparent 1px 4px)',
        }}
      >
        <canvas ref={canvasRef} data-testid="stamp-preview" className="rounded-sm" />
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          data-testid="stamp-button"
          onClick={stamp}
          disabled={!seal.text}
          className="flex items-center gap-1.5 rounded-md bg-[#b5342a] px-4 py-2 text-sm text-[#fdf6e3] hover:bg-[#8f241c] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Stamp size={15} />
          盖印
        </button>
        <button
          type="button"
          data-testid="export-button"
          onClick={() => downloadSealPNG(seal)}
          disabled={!seal.text}
          className="flex items-center gap-1.5 rounded-md border border-[#8a7150] bg-[#fffdf5] px-4 py-2 text-sm text-[#5a4632] hover:bg-[#efe3c6] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={15} />
          导出 PNG
        </button>
      </div>
      {impressions.length > 0 && (
        <div className="w-full">
          <div className="text-xs text-[#8a7150] mb-2">本印钤迹（仅当前印章）</div>
          <div className="flex flex-wrap gap-3">
            {impressions.map((imp) => (
              <img
                key={imp.id}
                src={imp.imageData}
                alt={`${imp.sealName}钤迹`}
                className="w-16 h-16 rounded-sm shadow"
                style={{ transform: `rotate(${imp.rotation}deg)` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
