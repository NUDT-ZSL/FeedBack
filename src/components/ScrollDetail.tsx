import { useEffect, useMemo, useState } from 'react';
import type { Scroll, SealColor, SealShape } from '../types';
import { sealComponents } from '../utils/sealShapes';
import {
  COLOPHON_MAX_LENGTH,
  SEAL_COLORS,
  SEAL_ROTATION_MAX,
  SEAL_ROTATION_MIN,
  SEAL_SHAPES,
} from '../collection/constants';
import type { AdjudicationRecord, DerivedCollectionItem } from '../collection/types';

const SEAL_COMPONENT_KEY: Record<SealShape, keyof typeof sealComponents> = {
  gourd: 'gourd',
  square: 'square',
  circle: 'circle',
  oval: 'oval',
  rectangle: 'rect',
};

const SHAPE_LABELS: Record<SealShape, string> = {
  gourd: '葫芦·永',
  square: '方·赏',
  circle: '圆·藏',
  oval: '椭圆·鉴',
  rectangle: '长方·玩',
};

interface ScrollDetailProps {
  scroll: Scroll;
  collected: DerivedCollectionItem | null;
  adjudications: AdjudicationRecord[];
  onCollect: (colophon: string, seal: { shape: SealShape; color: SealColor; rotation: number; position: { x: number; y: number } } | null) => void;
  onUpdate: (patch: { colophon?: string; seal?: { shape: SealShape; color: SealColor; rotation: number; position: { x: number; y: number } } | null }) => void;
  onRemove: () => void;
  onClose: () => void;
}

function ScrollDetail({ scroll, collected, adjudications, onCollect, onUpdate, onRemove, onClose }: ScrollDetailProps) {
  const [colophon, setColophon] = useState(collected?.colophon ?? '');
  const [shape, setShape] = useState<SealShape>(collected?.seal?.shape ?? 'circle');
  const [color, setColor] = useState<SealColor>(collected?.seal?.color ?? '#c0392b');

  useEffect(() => {
    setColophon(collected?.colophon ?? '');
    setShape(collected?.seal?.shape ?? 'circle');
    setColor(collected?.seal?.color ?? '#c0392b');
  }, [scroll.id, collected?.colophon, collected?.seal?.shape, collected?.seal?.color]);

  const SealPreview = useMemo(() => sealComponents[SEAL_COMPONENT_KEY[shape]], [shape]);

  const buildSeal = () => ({
    shape,
    color,
    rotation: SEAL_ROTATION_MIN + Math.round(Math.random() * (SEAL_ROTATION_MAX - SEAL_ROTATION_MIN)),
    position: { x: 88, y: 88 },
  });

  const handleCollect = () => {
    onCollect(colophon, buildSeal());
  };

  const handleSave = () => {
    onUpdate({ colophon, seal: buildSeal() });
  };

  return (
    <aside className="scroll-detail" aria-label="卷轴详情">
      <button type="button" className="scroll-detail__close" onClick={onClose} aria-label="关闭详情">×</button>
      <div className="scroll-detail__image-wrap">
        <img className="scroll-detail__image" src={scroll.largeImageUrl} alt={scroll.name} />
        {collected?.seal && (
          <span
            className="scroll-detail__seal"
            style={{
              left: `${collected.seal.position.x}%`,
              top: `${collected.seal.position.y}%`,
              transform: `translate(-50%, -50%) rotate(${collected.seal.rotation}deg)`,
            }}
          >
            <SealPreview color={collected.seal.color} size={56} />
          </span>
        )}
        {collected?.colophon && <p className="scroll-detail__colophon">{collected.colophon}</p>}
      </div>
      <h2>{scroll.name}</h2>
      <p className="scroll-detail__author">{scroll.dynasty} · {scroll.author}</p>
      <p className="scroll-detail__desc">{scroll.description}</p>

      <label className="scroll-detail__label" htmlFor="colophon-input">
        题跋（{colophon.length}/{COLOPHON_MAX_LENGTH}）
      </label>
      <textarea
        id="colophon-input"
        className="scroll-detail__textarea"
        value={colophon}
        maxLength={COLOPHON_MAX_LENGTH}
        placeholder="为此卷题写跋文……"
        onChange={(event) => setColophon(event.target.value)}
      />

      <div className="scroll-detail__label">钤印</div>
      <div className="seal-picker">
        {SEAL_SHAPES.map((candidate) => {
          const Component = sealComponents[SEAL_COMPONENT_KEY[candidate]];
          return (
            <button
              key={candidate}
              type="button"
              className={`seal-picker__option${candidate === shape ? ' seal-picker__option--active' : ''}`}
              title={SHAPE_LABELS[candidate]}
              onClick={() => setShape(candidate)}
            >
              <Component color={color} size={40} />
            </button>
          );
        })}
      </div>
      <div className="seal-colors">
        {SEAL_COLORS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`seal-colors__option${candidate === color ? ' seal-colors__option--active' : ''}`}
            style={{ backgroundColor: candidate }}
            aria-label={`印色 ${candidate}`}
            onClick={() => setColor(candidate)}
          />
        ))}
      </div>

      <div className="scroll-detail__actions">
        {collected ? (
          <>
            <button type="button" className="btn" onClick={handleSave}>保存题跋与钤印</button>
            <button type="button" className="btn btn--ghost" onClick={onRemove}>移出收藏</button>
          </>
        ) : (
          <button type="button" className="btn" onClick={handleCollect}>入藏</button>
        )}
      </div>

      {adjudications.length > 0 && (
        <div className="adjudication-panel">
          <div className="scroll-detail__label">裁决记录（{adjudications.length}）</div>
          <ul>
            {adjudications.map((item) => (
              <li key={item.id}>
                <code>{item.field}</code>：{item.decision}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

export default ScrollDetail;
