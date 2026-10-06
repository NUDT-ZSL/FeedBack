import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Image as ImageIcon, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import type { StoredGalleryItem } from '@/types';

interface GalleryProps {
  isMobileOpen: boolean;
  onToggleMobile: () => void;
}

export const Gallery: React.FC<GalleryProps> = ({ isMobileOpen, onToggleMobile }) => {
  const gallery = useGameStore((state) => state.gallery);
  const adjudicateGallery = useGameStore((state) => state.adjudicateGallery);
  const [selectedItem, setSelectedItem] = useState<StoredGalleryItem | null>(null);

  const conflictGroups = useMemo(() => {
    const groups = new Map<string, StoredGalleryItem[]>();
    gallery
      .filter((item) => item.conflictKey !== null)
      .forEach((item) => {
        const key = item.conflictKey as string;
        const group = groups.get(key);
        if (group) group.push(item);
        else groups.set(key, [item]);
      });
    return groups;
  }, [gallery]);

  return (
    <>
      <button
        className="drawer-toggle fixed bottom-0 left-0 right-0 z-40 drawer-handle py-3 flex items-center justify-center gap-2 text-amber-100"
        onClick={onToggleMobile}
      >
        {isMobileOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        <span className="font-kai text-sm">
          图鉴库 ({gallery.length}/20)
          {conflictGroups.size > 0 && (
            <span className="ml-2 text-red-300">{conflictGroups.size} 项冲突待裁决</span>
          )}
        </span>
      </button>

      <div
        className={`gallery-sidebar bg-amber-50 border-l-2 border-amber-900/20 flex flex-col ${isMobileOpen ? 'open' : ''}`}
        style={{ width: '320px', minHeight: '100vh' }}
      >
        <div className="p-4 border-b border-amber-900/20">
          <h2 className="font-title text-xl text-amber-900 flex items-center gap-2">
            <ImageIcon size={20} />
            分茶图鉴
          </h2>
          <p className="text-xs font-kai text-amber-700 mt-1">已收藏 {gallery.length}/20 幅（本地持久保存）</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {conflictGroups.size > 0 && (
            <div className="mb-3 rounded-lg border border-red-300 bg-red-50/70 p-3">
              <h3 className="font-title text-sm text-red-800 flex items-center gap-1 mb-2">
                <AlertTriangle size={14} />
                冲突图案待裁决
              </h3>
              {Array.from(conflictGroups.entries()).map(([key, group]) => (
                <div key={key} className="mb-3 last:mb-0">
                  <p className="text-xs font-kai text-red-700 mb-1">
                    第 {group[0].round} 回合 · {group[0].pattern.name} 存在 {group.length} 个版本
                  </p>
                  <div className="flex gap-2">
                    {group.map((item) => (
                      <button
                        key={item.id}
                        className="interactive-btn group relative w-16 shrink-0 text-left"
                        onClick={() => adjudicateGallery(key, item.id)}
                        title="保留此版本"
                      >
                        <img
                          src={item.thumbnail}
                          alt={item.pattern.name}
                          className="w-16 h-16 rounded-md border border-red-300 object-cover"
                        />
                        <span className="mt-1 block rounded bg-amber-600 text-white text-[10px] text-center py-0.5 font-kai">
                          保留此幅
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {gallery.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="text-6xl mb-4 opacity-30">🍵</div>
              <p className="font-kai text-amber-700 text-sm">
                完成斗茶比赛后
                <br />
                点击分茶图案即可收藏
              </p>
            </div>
          ) : (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
              {gallery.map((item) => (
                <motion.div
                  key={item.id}
                  className={`gallery-thumb aspect-square rounded-lg overflow-hidden bg-amber-100 border relative cursor-pointer ${
                    item.conflictKey ? 'border-red-400 ring-2 ring-red-300' : 'border-amber-300/50'
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSelectedItem(item)}
                >
                  <img src={item.thumbnail} alt={item.pattern.name} className="absolute inset-0 w-full h-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/45 text-amber-50 text-[9px] text-center font-kai py-0.5">
                    第{item.round}回合
                  </span>
                  {item.conflictKey && (
                    <span className="absolute top-0 right-0 bg-red-500 text-white text-[8px] px-1 rounded-bl">
                      冲突
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {selectedItem && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              className="relative bg-amber-50 rounded-2xl p-6 max-w-md mx-4"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-amber-200/50 transition-colors"
                onClick={() => setSelectedItem(null)}
              >
                <X size={20} className="text-amber-900" />
              </button>

              <div className="text-center mb-4">
                <h3 className="font-title text-2xl text-amber-900">{selectedItem.pattern.name}</h3>
                <p className="text-xs text-amber-600 font-kai mt-1">
                  第 {selectedItem.round} 回合 · {new Date(selectedItem.updatedAt).toLocaleString('zh-CN')}
                </p>
              </div>

              <div
                className="rounded-xl overflow-hidden mb-4 mx-auto"
                style={{
                  width: '320px',
                  height: '320px',
                  background: 'radial-gradient(ellipse at 50% 40%, #c49a3c 0%, #8b5a2b 15%, #5c3a1e 40%, #3a2010 100%)',
                }}
              >
                <img src={selectedItem.thumbnail} alt={selectedItem.pattern.name} className="w-full h-full object-cover" />
              </div>

              <div className="bg-amber-100/50 rounded-lg p-4 mb-4">
                <p className="font-kai text-amber-900 text-center whitespace-pre-line leading-relaxed">
                  {selectedItem.pattern.poem}
                </p>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-amber-100/50 rounded-lg p-2">
                  <div className="text-xs font-kai text-amber-700">色泽</div>
                  <div className="font-bold text-amber-900">{selectedItem.roundScore.color}</div>
                </div>
                <div className="bg-amber-100/50 rounded-lg p-2">
                  <div className="text-xs font-kai text-amber-700">持久</div>
                  <div className="font-bold text-amber-900">{selectedItem.roundScore.duration}</div>
                </div>
                <div className="bg-amber-100/50 rounded-lg p-2">
                  <div className="text-xs font-kai text-amber-700">咬盏</div>
                  <div className="font-bold text-amber-900">{selectedItem.roundScore.adhesion}</div>
                </div>
                <div className="bg-amber-100/50 rounded-lg p-2">
                  <div className="text-xs font-kai text-amber-700">总分</div>
                  <div className="font-bold text-amber-900">{selectedItem.roundScore.total}</div>
                </div>
              </div>

              {selectedItem.conflictKey && (
                <p className="mt-3 text-center text-xs font-kai text-red-700">
                  该图案存在冲突版本，请在左侧“冲突图案待裁决”中选择保留
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
