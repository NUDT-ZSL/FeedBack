import { useState } from 'react';
import { Download, Share2, X } from 'lucide-react';
import type { StampRecord } from '@/types';
import { buildStampSvg, svgToDataUrl } from '@/core/renderer';
import { useWorkbench } from '@/store/workbenchStore';

const stampUrl = (record: StampRecord, size: number): string =>
  svgToDataUrl(buildStampSvg(record.snapshot, size));

interface StampGalleryProps {
  onToast(message: string): void;
  onExportStamp(record: StampRecord): Promise<void>;
}

export default function StampGallery({ onToast, onExportStamp }: StampGalleryProps) {
  const selectedId = useWorkbench((state) => state.selectedId);
  const allStamps = useWorkbench((state) => state.stamps);
  const [collapsed, setCollapsed] = useState(false);
  const [preview, setPreview] = useState<StampRecord | null>(null);

  const stamps = selectedId ? allStamps[selectedId] ?? [] : [];

  return (
    <>
      <div
        className={`flex shrink-0 border-t border-[#d4c4a8] bg-[#efe5cf] transition-[height] duration-500 ease-in-out ${
          collapsed ? 'h-9' : 'h-[140px]'
        }`}
      >
        <button
          className="flex w-12 flex-col items-center justify-center gap-1 bg-[#e8dcc8] text-xs text-[#4a6b8a] hover:bg-[#d4c4a8] transition-colors duration-300"
          onClick={() => setCollapsed((value) => !value)}
        >
          <span>{collapsed ? '▲' : '▼'}</span>
          印谱
        </button>
        {!collapsed && (
          <div className="flex flex-1 items-center gap-3 overflow-x-auto px-3 py-2">
            {stamps.length === 0 ? (
              <span className="text-sm text-[#a08c64]">钤盖后的印谱会收在此处</span>
            ) : (
              stamps.map((record) => (
                <img
                  key={record.id}
                  src={stampUrl(record, 110)}
                  alt={record.snapshot.characters.join('')}
                  className="h-[110px] w-[110px] shrink-0 cursor-pointer rounded-md bg-[#fcf6e6] p-1 shadow transition-transform duration-300 hover:scale-110"
                  onClick={() => setPreview(record)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative rounded-xl bg-[#f4ecd8] p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={stampUrl(preview, 600)}
              alt={preview.snapshot.characters.join('')}
              className="h-[600px] w-[600px] max-h-[80vh] max-w-[90vw] rounded-lg bg-[#fcf6e6] shadow-inner"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="flex items-center gap-1 rounded-lg bg-[#4a6b8a] px-4 py-1.5 text-sm text-white hover:bg-[#3a5570] transition-colors"
                onClick={() => void onExportStamp(preview)}
              >
                <Download size={14} />
                另存 PNG
              </button>
              <button
                className="flex items-center gap-1 rounded-lg bg-[#cc3333] px-4 py-1.5 text-sm text-white hover:bg-[#a82828] transition-colors"
                onClick={() => {
                  const link = `${window.location.origin}/#stamp-${preview.id}`;
                  void navigator.clipboard
                    ?.writeText(link)
                    .then(() => onToast('分享链接已复制到剪贴板'))
                    .catch(() => onToast(link));
                }}
              >
                <Share2 size={14} />
                分享
              </button>
              <button
                aria-label="关闭预览"
                className="rounded-lg bg-[#e8dcc8] px-3 py-1.5 text-sm hover:bg-[#d4c4a8] transition-colors"
                onClick={() => setPreview(null)}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
