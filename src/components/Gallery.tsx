import { memo } from 'react';
import type { Scroll, ScrollCategory } from '../types';

interface GalleryProps {
  scrolls: Scroll[];
  collectedIds: ReadonlySet<string>;
  onSelect: (scroll: Scroll) => void;
}

const GalleryCard = memo(function GalleryCard({
  scroll,
  collected,
  onSelect,
}: {
  scroll: Scroll;
  collected: boolean;
  onSelect: (scroll: Scroll) => void;
}) {
  return (
    <button type="button" className="gallery-card" onClick={() => onSelect(scroll)}>
      <img className="gallery-card__img" src={scroll.thumbnailUrl} alt={scroll.name} loading="lazy" />
      <div className="gallery-card__veil" />
      <div className="gallery-card__meta">
        <span className="gallery-card__name">{scroll.name}</span>
        <span className="gallery-card__author">{scroll.dynasty} · {scroll.author}</span>
      </div>
      {collected && <span className="gallery-card__seal">藏</span>}
    </button>
  );
});

function Gallery({ scrolls, collectedIds, onSelect }: GalleryProps) {
  return (
    <section className="gallery" aria-label="卷轴画廊">
      {scrolls.map((scroll) => (
        <GalleryCard key={scroll.id} scroll={scroll} collected={collectedIds.has(scroll.id)} onSelect={onSelect} />
      ))}
      {scrolls.length === 0 && <p className="gallery-empty">此画派暂无藏品可赏。</p>}
    </section>
  );
}

export const FILTERS: Array<ScrollCategory | '全部'> = ['全部', '山水', '花鸟', '人物', '书法'];

export default Gallery;
