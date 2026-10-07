import { useMemo } from 'react';
import type { SealDocument } from '../types/index.ts';
import { generateSealSVG } from '../utils/sealGenerator.ts';

/**
 * 印石设计稿。以 data URL 整图替换渲染，且容器按印章 id 作为 key，
 * 切换印章时整块重建，杜绝旧印章图像残留。
 */
export default function SealCanvas({ seal }: { seal: SealDocument }) {
  const src = useMemo(() => {
    const svg = generateSealSVG(seal, { mode: 'stone' });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [seal]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="rounded-lg shadow-[inset_0_2px_12px_rgba(0,0,0,0.25),0_6px_18px_rgba(90,70,50,0.35)] overflow-hidden"
        style={{ lineHeight: 0 }}
      >
        <img key={seal.id} src={src} alt={`${seal.name}印面`} draggable={false} data-testid="seal-canvas" />
      </div>
      <div className="text-sm text-[#8a7150]">
        {seal.name} · {seal.text || '（未刻字）'}
      </div>
    </div>
  );
}
