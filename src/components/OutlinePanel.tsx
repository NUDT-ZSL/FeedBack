import { useState } from 'react';
import type { Card } from '../types.ts';

interface OutlinePanelProps {
  open: boolean;
  ordered: Card[];
  cyclic: string[];
  onReorder: (order: string[]) => void;
  onClose: () => void;
}

export default function OutlinePanel({ open, ordered, cyclic, onReorder, onClose }: OutlinePanelProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ordered.length) return;
    const ids = ordered.map((c) => c.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder(ids);
  };

  return (
    <aside className={`outline-panel ${open ? 'outline-panel--open' : ''}`}>
      <div className="outline-panel__head">
        <span>叙事大纲</span>
        <button type="button" className="icon-btn" onClick={onClose}>✕</button>
      </div>
      {cyclic.length > 0 && (
        <div className="outline-panel__warn">检测到 {cyclic.length} 张卡片处于循环连线中，未纳入线性路径</div>
      )}
      <ol className="outline-panel__list">
        {ordered.map((card, i) => (
          <li
            key={card.id}
            className={`outline-step ${dragIndex === i ? 'outline-step--dragging' : ''}`}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== i) {
                move(dragIndex, i);
                setDragIndex(i);
              }
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <span className="outline-step__no">{i + 1}</span>
            <div className="outline-step__body">
              <div className="outline-step__title">{card.title || '未命名卡片'}</div>
              <div className="outline-step__desc">{(card.content || '').slice(0, 40)}</div>
            </div>
          </li>
        ))}
        {ordered.length === 0 && <li className="outline-panel__empty">暂无卡片，先创建卡片并连线吧</li>}
      </ol>
    </aside>
  );
}
