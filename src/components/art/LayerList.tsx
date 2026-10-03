import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useArtStore } from '@/store/artStore';
import { cn } from '@/lib/utils';

export default function LayerList() {
  const layers = useArtStore((s) => s.layers);
  const selectedId = useArtStore((s) => s.selectedId);
  const { addLayer, removeLayer, selectLayer, moveLayer, toggleVisible } = useArtStore();

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          图层（底层 → 顶层）
        </h2>
        <button
          onClick={addLayer}
          className="flex items-center gap-1 rounded-md bg-indigo-500 px-2 py-1 text-xs font-medium text-white transition hover:bg-indigo-400"
        >
          <Plus size={14} /> 添加图层
        </button>
      </div>

      {layers.length === 0 && (
        <p className="rounded-md border border-dashed border-gray-300 p-3 text-center text-xs text-gray-400 dark:border-gray-600">
          还没有图层，点击「添加图层」开始创作
        </p>
      )}

      <ul className="space-y-1">
        {layers.map((layer, index) => (
          <li
            key={layer.id}
            onClick={() => selectLayer(layer.id)}
            className={cn(
              'flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 text-sm transition',
              layer.id === selectedId
                ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-500/10'
                : 'border-transparent hover:bg-gray-100 dark:hover:bg-white/5',
              !layer.visible && 'opacity-50',
            )}
          >
            <span className="flex-1 truncate">{layer.name}</span>
            <IconBtn
              title="上移（更晚绘制）"
              disabled={index === layers.length - 1}
              onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 1); }}
            >
              <ArrowUp size={14} />
            </IconBtn>
            <IconBtn
              title="下移（更早绘制）"
              disabled={index === 0}
              onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, -1); }}
            >
              <ArrowDown size={14} />
            </IconBtn>
            <IconBtn
              title={layer.visible ? '隐藏' : '显示'}
              onClick={(e) => { e.stopPropagation(); toggleVisible(layer.id); }}
            >
              {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </IconBtn>
            <IconBtn
              title="删除图层"
              onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }}
            >
              <Trash2 size={14} />
            </IconBtn>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IconBtn({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-gray-500 transition hover:bg-gray-200 hover:text-gray-800 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
    >
      {children}
    </button>
  );
}
