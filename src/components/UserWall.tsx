import { useState } from 'react';
import type { CollectedScroll } from '../types/index.ts';
import { sealComponents } from '../utils/sealShapes.tsx';

interface UserWallProps {
  ordered: CollectedScroll[];
  onReorder: (orderedScrollIds: string[]) => void;
  onRemove: (scrollId: string) => void;
  onBack: () => void;
}

function WallCard({ item }: { item: CollectedScroll }) {
  const SealComponent = item.seal ? sealComponents[item.seal.shape] : null;
  return (
    <article className="wall-card">
      <div className="wall-image">
        <img src={item.thumbnailUrl} alt={item.name} loading="lazy" />
        {SealComponent && item.seal && (
          <span
            className="wall-seal"
            style={{
              left: `${item.seal.position.x * 100}%`,
              top: `${item.seal.position.y * 100}%`,
              transform: `translate(-50%, -50%) rotate(${item.seal.rotation}deg)`,
            }}
          >
            <SealComponent color={item.seal.color} size={36} />
          </span>
        )}
      </div>
      <div className="wall-meta">
        <strong>{item.name}</strong>
        <em>{item.dynasty} · {item.author}</em>
        {item.colophon && <p className="wall-colophon">{item.colophon}</p>}
      </div>
    </article>
  );
}

export default function UserWall({ ordered, onReorder, onRemove, onBack }: UserWallProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const ids = ordered.map((c) => c.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    ids.splice(to, 0, ...ids.splice(from, 1));
    onReorder(ids);
    setDragId(null);
    setOverId(null);
  };

  return (
    <section className="user-wall">
      <header className="wall-header">
        <button type="button" className="link-btn" onClick={onBack}>← 返回画廊</button>
        <h2>个人收藏墙</h2>
        <span className="wall-count">共 {ordered.length} 件</span>
      </header>
      {ordered.length === 0 ? (
        <p className="wall-empty">收藏墙空空如也，去画廊为心仪的卷轴钤印入藏吧。</p>
      ) : (
        <div className="wall-grid">
          {ordered.map((item) => (
            <div
              key={item.id}
              className={[
                'wall-item',
                dragId === item.id ? 'dragging' : '',
                overId === item.id && dragId !== item.id ? 'drag-over' : '',
              ].join(' ').trim()}
              draggable
              onDragStart={() => setDragId(item.id)}
              onDragOver={(e) => { e.preventDefault(); setOverId(item.id); }}
              onDragLeave={() => setOverId((prev) => (prev === item.id ? null : prev))}
              onDrop={(e) => { e.preventDefault(); handleDrop(item.id); }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
            >
              <WallCard item={item} />
              <button
                type="button"
                className="wall-remove"
                aria-label={`移出收藏 ${item.name}`}
                onClick={() => onRemove(item.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
