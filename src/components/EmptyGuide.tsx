import { Stamp } from 'lucide-react';
import { useWorkbench } from '@/store/workbenchStore';

export default function EmptyGuide() {
  const addSeal = useWorkbench((state) => state.addSeal);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-[#6b5b3e]">
      <Stamp size={56} className="text-[#b8a07a]" />
      <p className="text-lg">案上尚无印石，先添一方再动刀</p>
      <button
        className="rounded-lg bg-[#cc3333] px-6 py-2 text-white shadow hover:bg-[#a82828] transition-colors duration-300"
        onClick={() => addSeal()}
      >
        新增一方印
      </button>
    </div>
  );
}
