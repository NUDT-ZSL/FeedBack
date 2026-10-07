import { memo, useState } from 'react';
import type { SealShape } from '../types';
import { sealComponents } from '../utils/sealShapes';
import type { DerivedCollectionItem } from '../collection/types';

const SEAL_COMPONENT_KEY: Record<SealShape, keyof typeof sealComponents> = {
  gourd: 'gourd',
  square: 'square',
  circle: 'circle',
  oval: 'oval',
  rectangle: 'rect',
};

interface UserWallProps {
  items: DerivedCollectionItem[];
  onMove: (scrollId: string, requestedOrder: number) => void;
  onBack: () => void;
}

const WallCard = memo(function WallCard({
  item,
  onDropAt,
}: {
  item: DerivedCollectionItem;
  onDropAt: (scrollId: string, requestedOrder: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const Seal = item.seal ? sealComponents[SEAL_COMPONENT_KEY[item.seal.shape]] : null;

  return (
    <article
      className={`wall-card${dragOver ? ' wall-card--dragover' : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', item.scrollId);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const draggedId = event.dataTransfer.getData('text/plain');
        if (draggedId && draggedId !== item.scrollId) {
          // 落到该卡之前：请求位取相邻两位的中点，由推导层统一归一，冲突确定性裁决。
          onDropAt(draggedId, item.order - 0.5);
        }
      }}
    >
      <div className="wall-card__image-wrap">
        <img className="wall-card__image" src={item.scroll.largeImageUrl} alt={item.scroll.name} />
        {item.seal && Seal && (
          <span
            className="wall-card__seal"
            style={{
              left: `${item.seal.position.x}%`,
              top: `${item.seal.position.y}%`,
              transform: `translate(-50%, -50%) rotate(${item.seal.rotation}deg)`,
            }}
          >
            <Seal color={item.seal.color} size={44} />
          </span>
        )}
      </div>
      <h3>{item.scroll.name}</h3>
      <p className="wall-card__colophon">{item.colophon || '（无题跋）'}</p>
      <p className="wall-card__order">第 {item.order + 1} 位</p>
    </article>
  );
});

function UserWall({ items, onMove, onBack }: UserWallProps) {
  return (
    <section className="wall" aria-label="个人收藏墙">
      <div className="wall__bar">
        <button type="button" className="btn btn--ghost" onClick={onBack}>返回画廊</button>
        <span>拖拽卡片即可重新排序，顺序由收藏域统一裁决。</span>
      </div>
      {items.length === 0 ? (
        <p className="wall-empty">尚未入藏任何卷轴，回到画廊挑选心仪之作吧。</p>
      ) : (
        <div className="wall__grid">
          {items.map((item) => (
            <WallCard key={item.scrollId} item={item} onDropAt={onMove} />
          ))}
        </div>
      )}
    </section>
  );
}

export default UserWall;
