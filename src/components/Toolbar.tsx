import { Download, Redo2, Stamp, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { FONTS, SEAL_SIZES } from '@/types';
import { useWorkbench } from '@/store/workbenchStore';
import { getSelectedSeal } from '@/store/workbench';
import { canRedo, canUndo } from '@/core/seal';

interface ToolbarProps {
  onToast(message: string): void;
  onStamp(): void;
  onExport(): void;
}

function ToolButton({
  active,
  disabled,
  onClick,
  children,
  label,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors duration-300 border-b-2 ${
        active
          ? 'bg-[#e8dcc8] border-[#cc3333] text-[#7a2a2a]'
          : 'bg-[#e8dcc8] border-transparent text-[#4a4632] hover:bg-[#d4c4a8]'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

export default function Toolbar({ onToast, onStamp, onExport }: ToolbarProps) {
  const seal = useWorkbench(getSelectedSeal);
  const setFont = useWorkbench((state) => state.setFont);
  const setStyle = useWorkbench((state) => state.setStyle);
  const setSize = useWorkbench((state) => state.setSize);
  const undo = useWorkbench((state) => state.undo);
  const redo = useWorkbench((state) => state.redo);

  if (!seal) return null;
  const { state } = seal;

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-[#efe5cf] border-b border-[#d4c4a8] max-md:flex-col max-md:items-stretch">
      <select
        aria-label="篆书字体"
        className="rounded-lg bg-[#e8dcc8] px-3 py-1.5 text-sm text-[#4a4632] hover:bg-[#d4c4a8]"
        value={state.font}
        onChange={(event) => setFont(event.target.value as typeof state.font)}
      >
        {FONTS.map((font) => (
          <option key={font.value} value={font.value}>
            {font.label}
          </option>
        ))}
      </select>
      <div className="flex gap-1">
        {SEAL_SIZES.map((size) => (
          <ToolButton
            key={size.value}
            label={`尺寸${size.label}`}
            active={state.size === size.value}
            onClick={() => setSize(size.value)}
          >
            {size.label}
          </ToolButton>
        ))}
      </div>
      <div className="flex gap-1">
        <ToolButton label="阴刻" active={state.style === 'yinke'} onClick={() => setStyle('yinke')}>
          阴刻
        </ToolButton>
        <ToolButton label="阳刻" active={state.style === 'yangke'} onClick={() => setStyle('yangke')}>
          阳刻
        </ToolButton>
      </div>
      <div className="flex gap-1">
        <ToolButton
          label="撤销"
          disabled={!canUndo(seal)}
          onClick={() => {
            const action = undo();
            if (action) onToast(`撤销：${action}`);
          }}
        >
          <Undo2 size={14} />
          撤销
        </ToolButton>
        <ToolButton
          label="重做"
          disabled={!canRedo(seal)}
          onClick={() => {
            const action = redo();
            if (action) onToast(`重做：${action}`);
          }}
        >
          <Redo2 size={14} />
          重做
        </ToolButton>
      </div>
      <div className="flex gap-1 md:ml-auto">
        <ToolButton label="钤盖" onClick={onStamp}>
          <Stamp size={14} />
          钤盖
        </ToolButton>
        <ToolButton label="导出" onClick={onExport}>
          <Download size={14} />
          导出
        </ToolButton>
      </div>
    </div>
  );
}
