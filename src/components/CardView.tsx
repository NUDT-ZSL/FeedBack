import { useRef, useState } from 'react';
import type { Card } from '../types.ts';
import { CARD_COLORS, CONTENT_MAX_LENGTH, TITLE_MAX_LENGTH } from '../types.ts';

interface CardViewProps {
  card: Card;
  selected: boolean;
  connectPending: boolean;
  connectMode: boolean;
  onPointerDown: (event: React.PointerEvent, cardId: string) => void;
  onResizeStart: (event: React.PointerEvent, cardId: string) => void;
  onUpdate: (cardId: string, patch: Partial<Card>) => void;
}

export function CardView({
  card,
  selected,
  connectPending,
  connectMode,
  onPointerDown,
  onResizeStart,
  onUpdate,
}: CardViewProps) {
  const [editing, setEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImagePick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onUpdate(card.id, { imageUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <div
      className={[
        'card',
        selected ? 'card--selected' : '',
        connectPending ? 'card--connect-pending' : '',
        connectMode ? 'card--connect-mode' : '',
      ].join(' ')}
      style={{
        left: card.x,
        top: card.y,
        width: card.width,
        height: card.height,
        backgroundColor: card.color,
      }}
      onPointerDown={(event) => onPointerDown(event, card.id)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      {editing ? (
        <div className="card__editor" onPointerDown={(event) => event.stopPropagation()}>
          <input
            className="card__title-input"
            value={card.title}
            maxLength={TITLE_MAX_LENGTH}
            autoFocus
            onChange={(event) => onUpdate(card.id, { title: event.target.value })}
            onKeyDown={(event) => event.key === 'Enter' && setEditing(false)}
          />
          <textarea
            className="card__content-input"
            value={card.content}
            maxLength={CONTENT_MAX_LENGTH}
            placeholder="记录灵感片段…"
            onChange={(event) => onUpdate(card.id, { content: event.target.value })}
          />
          <button className="card__done" onClick={() => setEditing(false)}>
            完成
          </button>
        </div>
      ) : (
        <>
          <div className="card__title">{card.title || '未命名'}</div>
          {card.imageUrl && <img className="card__image" src={card.imageUrl} alt="" draggable={false} />}
          <div className="card__content">{card.content}</div>
        </>
      )}
      {selected && !editing && (
        <div className="card__toolbar" onPointerDown={(event) => event.stopPropagation()}>
          {CARD_COLORS.map((color) => (
            <button
              key={color}
              className="card__color-dot"
              style={{ backgroundColor: color }}
              onClick={() => onUpdate(card.id, { color })}
            />
          ))}
          <button className="card__tool-btn" title="插入图片" onClick={() => fileInputRef.current?.click()}>
            图
          </button>
          {card.imageUrl && (
            <button className="card__tool-btn" title="移除图片" onClick={() => onUpdate(card.id, { imageUrl: undefined })}>
              ✕图
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => handleImagePick(event.target.files)}
          />
        </div>
      )}
      {selected && (
        <div
          className="card__resize-handle"
          onPointerDown={(event) => {
            event.stopPropagation();
            onResizeStart(event, card.id);
          }}
        />
      )}
    </div>
  );
}
