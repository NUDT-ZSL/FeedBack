import { useMemo, useState } from 'react';
import scrolls from '../data/scrolls';
import type { Scroll, ScrollCategory } from '../types';
import Gallery, { FILTERS } from '../components/Gallery';
import ScrollDetail from '../components/ScrollDetail';
import UserWall from '../components/UserWall';
import { collectionStore, useCollectionState } from '../hooks/useCollection';
import type { SealColor, SealShape } from '../types';

type SealInput = { shape: SealShape; color: SealColor; rotation: number; position: { x: number; y: number } } | null;

export default function Home() {
  const [view, setView] = useState<'gallery' | 'wall'>('gallery');
  const [filter, setFilter] = useState<ScrollCategory | '全部'>('全部');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const collection = useCollectionState();

  const filteredScrolls = useMemo(
    () => (filter === '全部' ? scrolls : scrolls.filter((scroll) => scroll.category === filter)),
    [filter],
  );
  const collectedIds = useMemo(
    () => new Set(collection.items.map((item) => item.scrollId)),
    [collection.items],
  );
  const selectedScroll = scrolls.find((scroll) => scroll.id === selectedId) ?? null;
  const selectedItem = collection.items.find((item) => item.scrollId === selectedId) ?? null;
  const selectedAdjudications = collection.adjudications.filter((item) => item.scrollId === selectedId);

  const handleCollect = (scroll: Scroll, colophon: string, seal: SealInput) => {
    collectionStore.dispatch({
      kind: 'collect',
      record: {
        scrollId: scroll.id,
        colophon,
        seal: seal ?? undefined,
        requestedOrder: collection.items.length,
        collectedAt: Date.now(),
      },
    });
  };

  const handleUpdate = (scrollId: string, patch: { colophon?: string; seal?: SealInput }) => {
    collectionStore.dispatch({ kind: 'update', scrollId, patch });
  };

  return (
    <div className="home">
      <header className="home__header">
        <h1>古风卷轴画廊</h1>
        <button type="button" className="home__wall-toggle" onClick={() => setView(view === 'wall' ? 'gallery' : 'wall')}>
          收藏墙（{collection.items.length}）
        </button>
      </header>

      {view === 'gallery' ? (
        <>
          <nav className="home__filters" aria-label="画派筛选">
            {FILTERS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                className={`filter-btn${candidate === filter ? ' filter-btn--active' : ''}`}
                onClick={() => setFilter(candidate)}
              >
                {candidate}
              </button>
            ))}
          </nav>
          <Gallery
            scrolls={filteredScrolls}
            collectedIds={collectedIds}
            onSelect={(scroll: Scroll) => setSelectedId(scroll.id)}
          />
          {selectedScroll && (
            <ScrollDetail
              scroll={selectedScroll}
              collected={selectedItem}
              adjudications={selectedAdjudications}
              onCollect={(colophon, seal) => handleCollect(selectedScroll, colophon, seal)}
              onUpdate={(patch) => handleUpdate(selectedScroll.id, patch)}
              onRemove={() => collectionStore.dispatch({ kind: 'remove', scrollId: selectedScroll.id })}
              onClose={() => setSelectedId(null)}
            />
          )}
        </>
      ) : (
        <UserWall
          items={collection.items}
          onMove={(scrollId, requestedOrder) => collectionStore.dispatch({ kind: 'move', scrollId, requestedOrder })}
          onBack={() => setView('gallery')}
        />
      )}
    </div>
  );
}
