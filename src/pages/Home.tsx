import { useMemo, useState } from 'react';
import scrolls from '../data/scrolls.ts';
import Gallery from '../components/Gallery.tsx';
import ScrollDetail, { type SealDraft } from '../components/ScrollDetail.tsx';
import UserWall from '../components/UserWall.tsx';
import { useCollection } from '../collection/hooks/useCollection.ts';
import type { CollectionEngine } from '../collection/engine.ts';
import type { Scroll, ScrollCategory } from '../types/index.ts';

export default function Home({ engine }: { engine: CollectionEngine }) {
  const { collection, isCollected, collect, remove, setColophon, setSeal, reorder } = useCollection(engine);
  const [filter, setFilter] = useState<'全部' | ScrollCategory>('全部');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'gallery' | 'wall'>('gallery');

  const collectedIds = useMemo(() => new Set(Object.keys(collection.entries)), [collection]);
  const selected: Scroll | null = useMemo(
    () => scrolls.find((s) => s.id === selectedId) ?? null,
    [selectedId],
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>古风卷轴画廊</h1>
        <button type="button" className="btn-g small" onClick={() => setView(view === 'wall' ? 'gallery' : 'wall')}>
          {view === 'wall' ? '返回画廊' : `收藏墙（${collection.ordered.length}）`}
        </button>
      </header>

      {view === 'wall' ? (
        <UserWall
          ordered={collection.ordered}
          onReorder={reorder}
          onRemove={remove}
          onBack={() => setView('gallery')}
        />
      ) : (
        <div className={selected ? 'gallery-layout with-detail' : 'gallery-layout'}>
          <Gallery
            scrolls={scrolls}
            filter={filter}
            onFilterChange={setFilter}
            collectedIds={collectedIds}
            onSelect={(scroll) => setSelectedId(scroll.id)}
          />
          {selected && (
            <ScrollDetail
              scroll={selected}
              entry={collection.entries[selected.id] ?? null}
              collected={isCollected(selected.id)}
              onClose={() => setSelectedId(null)}
              onCollect={() => collect(selected.id)}
              onRemove={() => remove(selected.id)}
              onColophonChange={(text) => setColophon(selected.id, text)}
              onSealChange={(seal: SealDraft | null) =>
                setSeal(selected.id, seal ? { ...seal, character: undefined } : null)
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
