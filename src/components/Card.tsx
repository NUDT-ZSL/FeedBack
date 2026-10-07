import { useRef, useState } from 'react';
import type { Card as CardModel, ConnectionType } from '../types.ts';
import { CARD_COLORS, CONTENT_MAX_LENGTH, TITLE_MAX_LENGTH } from '../types.ts';

interface CardViewProps {
  card: CardModel;
  selected: boolean;
  connectMode: boolean;
  grouped: boolean;
  onBodyPointerDown: (e: React.PointerEvent, cardId: string) => void;
  onUpdate: (id: string, changes: Partial<Omit<CardModel, 'id' | 'createdAt'>>) => void;
  onDelete: (id: string) => void;
  onStartConnect: (cardId: string, e: React.PointerEvent) => void;
}

const GROUP_DROP_MIME = 'application/x-card-id';

export function setGroupDropPayload(e: React.DragEvent, cardId: string) {
  e.dataTransfer.setData(GROUP_DROP_MIME, cardId);
  e.dataTransfer.effectAllowed = 'move';
}

export function readGroupDropPayload(e: React.DragEvent): string | null {
  return e.dataTransfer.getData(GROUP_DROP_MIME) || null;
}

export default function CardView({
  card,
  selected,
  connectMode,
  grouped,
  onBodyPointerDown,
  onUpdate,
  onDelete,
  onStartConnect,
}: CardViewProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onUpdate(card.id, { imageUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <>
      <div
        className={`card ${selected ? 'card--selected' : ''} ${card.title || card.content ? '' : 'card--enter'}`}
        style={{
          left: card.x,
          top: card.y,
          width: card.width,
          height: card.height,
          backgroundColor: card.color,
        }}
        onPointerDown={(e) => onBodyPointerDown(e, card.id)}
      >
        <div className="card__head">
          <input
            className="card__title"
            value={card.title}
            maxLength={TITLE_MAX_LENGTH}
            placeholder="标题"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => onUpdate(card.id, { title: e.target.value })}
          />
          <button
            type="button"
            className="icon-btn card__palette-btn"
            title="卡片颜色"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setPaletteOpen((v) => !v);
            }}
          >
            ◈
          </button>
          <button
            type="button"
            className="icon-btn"
            title="删除卡片（同时删除其连线并移出卡组）"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(card.id);
            }}
          >
            ✕
          </button>
        </div>
        {paletteOpen && (
          <div className="palette" onPointerDown={(e) => e.stopPropagation()}>
            {CARD_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="palette__swatch"
                style={{ backgroundColor: color }}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate(card.id, { color });
                  setPaletteOpen(false);
                }}
              />
            ))}
          </div>
        )}
        <textarea
          className="card__content"
          value={card.content}
          maxLength={CONTENT_MAX_LENGTH}
          placeholder="写点灵感…"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate(card.id, { content: e.target.value })}
        />
        <div className="card__foot">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pickImage(e.target.files?.[0])}
          />
          {card.imageUrl ? (
            <img
              className="card__thumb"
              src={card.imageUrl}
              alt="卡片图片"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setPreview(true);
              }}
            />
          ) : (
            <button
              type="button"
              className="mini-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                fileRef.current?.click();
              }}
            >
              + 图片
            </button>
          )}
          <span
            className={`card__group-badge ${grouped ? '' : 'card__group-badge--handle'}`}
            title={grouped ? '已在卡组中（单卡单组，不可再拖入其他组）' : '拖到任意卡组容器上，把卡片加入该卡组'}
            draggable={!grouped}
            onDragStart={(e) => {
              setGroupDropPayload(e, card.id);
            }}
          >
            {grouped ? '已入组' : '⋕ 拖我入组'}
          </span>
        </div>
        {connectMode && (
          <>
            <span
              className="card__anchor card__anchor--r"
              onPointerDown={(e) => {
                e.stopPropagation();
                onStartConnect(card.id, e);
              }}
            />
            <span
              className="card__anchor card__anchor--l"
              onPointerDown={(e) => {
                e.stopPropagation();
                onStartConnect(card.id, e);
              }}
            />
          </>
        )}
      </div>
      {preview && card.imageUrl && (
        <div
          className="image-preview__backdrop"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setPreview(false)}
        >
          <img className="image-preview__img" src={card.imageUrl} alt="预览" />
        </div>
      )}
    </>
  );
}

export type { ConnectionType };
