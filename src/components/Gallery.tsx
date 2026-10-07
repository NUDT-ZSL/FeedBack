import { memo, useMemo } from 'react';
import type { Scroll, ScrollCategory } from '../types/index.ts';

const FILTERS: Array<'全部' | ScrollCategory> = ['全部', '山水', '花鸟', '人物', '书法'];

interface GalleryProps {
  scrolls: Scroll[];
  filter: '全部' | ScrollCategory;
  onFilterChange: (filter: '全部' | ScrollCategory) => void;
  collectedIds: Set<string>;
  onSelect: (scroll: Scroll) => void;
}

const ThumbCard = memo(function ThumbCard({
  scroll,
  collected,
  onSelect,
}: {
  scroll: Scroll;
  collected: boolean;
  onSelect: (scroll: Scroll) => void;
}) {
  return (
    <button
      type="button"
      className="thumb-card"
      onClick={() => onSelect(scroll)}
      aria-label={`查看${scroll.name}`}
    >
      <span className="thumb-frame">
        <img src={scroll.thumbnailUrl} alt={scroll.name} loading="lazy" />
        <span className="thumb-mask" />
        {collected && <span className="thumb-collected">藏</span>}
      </span>
      <span className="thumb-meta">
        <strong>{scroll.name}</strong>
        <em>{scroll.dynasty} · {scroll.author}</em>
      </span>
    </button>
  );
});

export default function Gallery({ scrolls, filter, onFilterChange, collectedIds, onSelect }: GalleryProps) {
  const visible = useMemo(
    () => (filter === '全部' ? scrolls : scrolls.filter((s) => s.category === filter)),
    [scrolls, filter],
  );

  return (
    <section>
      <nav className="filter-bar" aria-label="画派筛选">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={f === filter ? 'filter-btn active' : 'filter-btn'}
            onClick={() => onFilterChange(f)}
          >
            {f}
          </button>
        ))}
      </nav>
      <div className="thumb-grid" key={filter}>
        {visible.map((scroll) => (
          <ThumbCard
            key={scroll.id}
            scroll={scroll}
            collected={collectedIds.has(scroll.id)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
