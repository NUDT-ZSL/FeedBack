import { useRepairStore } from '@/store/useRepairStore';
import { tools } from '@/utils/tools';
import { cn } from '@/lib/utils';

export default function ToolPanel() {
  const { selectedTool, setSelectedTool } = useRepairStore();

  return (
    <div className="bg-[var(--color-dark-bg)] bg-opacity-80 backdrop-blur-sm rounded-lg p-3 shadow-lg border border-[var(--color-paper-cream)] border-opacity-20">
      <h3 className="text-[var(--color-paper-cream)] text-center mb-3 font-[var(--font-brush)] text-sm border-b border-[var(--color-paper-cream)] border-opacity-30 pb-2">
        修复工具
      </h3>
      <div className="space-y-3">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => setSelectedTool(selectedTool === tool.type ? null : tool.type)}
            className={cn(
              'w-full p-3 rounded-lg transition-all duration-300 flex flex-col items-center gap-2',
              'hover:bg-opacity-30 hover:bg-white',
              selectedTool === tool.type
                ? 'bg-white bg-opacity-20 ring-2 ring-[var(--color-gold-glow)]'
                : 'bg-white bg-opacity-5'
            )}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shadow-md"
              style={{ backgroundColor: tool.color }}
            >
              <span className="text-white text-xs font-bold">
                {tool.name.charAt(0)}
              </span>
            </div>
            <span className="text-[var(--color-paper-cream)] text-xs font-[var(--font-brush)]">
              {tool.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
