import { Plus, X } from 'lucide-react';
import type { SealDocument } from '../types/index.ts';
import { useWorkshopStore } from '../store/workshopStore.ts';
import { generateSealSVG } from '../utils/sealGenerator.ts';
import { cn } from '../lib/utils';

function sealThumbnail(seal: SealDocument): string {
  const svg = generateSealSVG(seal, { mode: 'stamp' });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function SealTabs() {
  const seals = useWorkshopStore((s) => s.seals);
  const activeId = useWorkshopStore((s) => s.activeId);
  const selectSeal = useWorkshopStore((s) => s.selectSeal);
  const addSeal = useWorkshopStore((s) => s.addSeal);
  const removeSeal = useWorkshopStore((s) => s.removeSeal);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-[#e8dcc0] border-b border-[#c9b78f]">
      {seals.map((seal) => {
        const active = seal.id === activeId;
        return (
          <div
            key={seal.id}
            data-testid={`seal-tab-${seal.id}`}
            className={cn(
              'group flex items-center gap-2 rounded-md pl-1.5 pr-1 py-1 border cursor-pointer transition-colors',
              active
                ? 'bg-[#b5342a] text-[#fdf6e3] border-[#8f241c] shadow-sm'
                : 'bg-[#f4ecd8] text-[#5a4632] border-[#c9b78f] hover:bg-[#efe3c6]',
            )}
            onClick={() => selectSeal(seal.id)}
          >
            <img
              src={sealThumbnail(seal)}
              alt={seal.name}
              className="w-8 h-8 rounded-sm"
              draggable={false}
            />
            <span className="text-sm whitespace-nowrap">{seal.name}</span>
            <button
              type="button"
              aria-label={`删除${seal.name}`}
              data-testid={`remove-seal-${seal.id}`}
              className={cn(
                'rounded-full w-5 h-5 flex items-center justify-center opacity-70 hover:opacity-100',
                active ? 'hover:bg-[#8f241c]' : 'hover:bg-[#c9b78f]',
              )}
              onClick={(e) => {
                e.stopPropagation();
                removeSeal(seal.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        data-testid="add-seal"
        onClick={addSeal}
        className="flex items-center gap-1 rounded-md px-3 py-2 text-sm bg-[#f4ecd8] text-[#5a4632] border border-dashed border-[#8a7150] hover:bg-[#efe3c6]"
      >
        <Plus size={14} />
        新增印章
      </button>
    </div>
  );
}
