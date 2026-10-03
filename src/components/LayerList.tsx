import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArtStore } from "@/store/useArtStore";

export default function LayerList() {
  const layers = useArtStore((s) => s.layers);
  const selectedId = useArtStore((s) => s.selectedId);
  const { addLayer, removeLayer, moveLayer, selectLayer, updateLayer } = useArtStore();

  // 列表顶部显示最上层（数组末尾）
  const display = [...layers].reverse();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          图层（{layers.length}）
        </span>
        <button
          onClick={addLayer}
          className="flex items-center gap-1 rounded-md bg-indigo-500/90 px-2 py-1 text-xs text-white hover:bg-indigo-500"
        >
          <Plus size={14} /> 添加
        </button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {display.map((layer) => {
          const index = layers.findIndex((l) => l.id === layer.id);
          const selected = layer.id === selectedId;
          return (
            <div
              key={layer.id}
              onClick={() => selectLayer(layer.id)}
              className={cn(
                "group flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1.5 text-sm",
                selected
                  ? "border-indigo-400 bg-indigo-500/10 dark:border-indigo-500"
                  : "border-transparent hover:bg-neutral-200/60 dark:hover:bg-white/5",
                !layer.visible && "opacity-50",
              )}
            >
              <button
                title={layer.visible ? "隐藏" : "显示"}
                onClick={(e) => {
                  e.stopPropagation();
                  updateLayer(layer.id, { visible: !layer.visible });
                }}
                className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                {layer.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <span className="flex-1 truncate text-neutral-800 dark:text-neutral-200">
                {layer.name}
              </span>
              <button
                title="上移"
                disabled={index === layers.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  moveLayer(layer.id, 1);
                }}
                className="text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
              >
                <ArrowUp size={14} />
              </button>
              <button
                title="下移"
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  moveLayer(layer.id, -1);
                }}
                className="text-neutral-400 hover:text-neutral-700 disabled:opacity-30 dark:hover:text-neutral-200"
              >
                <ArrowDown size={14} />
              </button>
              <button
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  removeLayer(layer.id);
                }}
                className="text-neutral-400 hover:text-red-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
        {layers.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-neutral-400">
            暂无图层，点击「添加」创建
          </p>
        )}
      </div>
    </div>
  );
}
