import { Plus, X } from 'lucide-react';
import { useWorkbench } from '@/store/workbenchStore';

export default function SealTabs() {
  const seals = useWorkbench((state) => state.seals);
  const selectedId = useWorkbench((state) => state.selectedId);
  const selectSeal = useWorkbench((state) => state.selectSeal);
  const deleteSeal = useWorkbench((state) => state.deleteSeal);
  const addSeal = useWorkbench((state) => state.addSeal);

  return (
    <div className="flex items-center gap-2 overflow-x-auto px-4 py-2 bg-[#efe5cf] border-b border-[#d4c4a8]">
      {seals.map((seal) => {
        const active = seal.id === selectedId;
        return (
          <div
            key={seal.id}
            className={`group flex items-center gap-1 rounded-t-lg px-3 py-1.5 cursor-pointer select-none whitespace-nowrap border-b-2 transition-colors duration-300 ${
              active
                ? 'bg-[#e8dcc8] border-[#cc3333] text-[#7a2a2a]'
                : 'bg-[#e2d5bc] border-transparent text-[#6b5b3e] hover:bg-[#d4c4a8]'
            }`}
            onClick={() => selectSeal(seal.id)}
          >
            <span className="text-sm">{seal.name}</span>
            <span className="text-xs text-[#a08c64]">{seal.state.characters.join('') || '空白'}</span>
            <button
              aria-label={`删除${seal.name}`}
              className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[#cc3333] hover:text-white transition-opacity"
              onClick={(event) => {
                event.stopPropagation();
                deleteSeal(seal.id);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button
        aria-label="新增印章"
        className="flex items-center gap-1 rounded-lg bg-[#e8dcc8] px-3 py-1.5 text-sm text-[#4a6b8a] hover:bg-[#d4c4a8] transition-colors duration-300"
        onClick={() => addSeal()}
      >
        <Plus size={14} />
        新增一方印
      </button>
    </div>
  );
}
