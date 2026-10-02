import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Image as ImageIcon, ChevronUp, ChevronDown } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import type { GalleryItem } from '@/types';

interface GalleryProps {
  isMobileOpen: boolean;
  onToggleMobile: () => void;
}

export const Gallery: React.FC<GalleryProps> = ({ isMobileOpen, onToggleMobile }) => {
  const gallery = useGameStore(state => state.gallery);
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  
  return (
    <>
      <button
        className="drawer-toggle fixed bottom-0 left-0 right-0 z-40 drawer-handle py-3 flex items-center justify-center gap-2 text-amber-100"
        onClick={onToggleMobile}
      >
        {isMobileOpen ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        <span className="font-kai text-sm">图鉴库 ({gallery.length}/20)</span>
      </button>
      
      <div className={`gallery-sidebar bg-amber-50 border-l-2 border-amber-900/20 flex flex-col ${isMobileOpen ? 'open' : ''}`}
        style={{
          width: '320px',
          minHeight: '100vh',
        }}
      >
        <div className="p-4 border-b border-amber-900/20">
          <h2 className="font-title text-xl text-amber-900 flex items-center gap-2">
            <ImageIcon size={20} />
            分茶图鉴
          </h2>
          <p className="text-xs font-kai text-amber-700 mt-1">
            已收藏 {gallery.length}/20 幅
          </p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-3">
          {gallery.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <div className="text-6xl mb-4 opacity-30">🍵</div>
              <p className="font-kai text-amber-700 text-sm">
                完成斗茶比赛后<br/>点击分茶图案即可收藏
              </p>
            </div>
          ) : (
            <div 
              className="grid gap-2"
              style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
            >
              {gallery.map((item) => (
                <motion.div
                  key={item.id}
                  className="gallery-thumb aspect-square rounded-lg overflow-hidden bg-amber-100 border border-amber-300/50"
                  style={{ width: '100%', paddingBottom: '100%', position: 'relative' }}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSelectedItem(item)}
                >
                  <img
                    src={item.thumbnail}
                    alt={item.pattern.name}
                    className="absolute inset-0 w-full h-full object-cover"
                  />
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
                <h3 className="font-title text-2xl text-amber-900">
                  {selectedItem.pattern.name}
                </h3>
                <p className="text-xs text-amber-600 font-kai mt-1">
                  {new Date(selectedItem.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </div>
              
              <div 
                className="rounded-xl overflow-hidden mb-4 mx-auto"
                style={{ width: '320px', height: '320px', background: 'radial-gradient(ellipse at 50% 40%, #c49a3c 0%, #8b5a2b 15%, #5c3a1e 40%, #3a2010 100%)' }}
              >
                <img
                  src={selectedItem.thumbnail}
                  alt={selectedItem.pattern.name}
                  className="w-full h-full object-cover"
                />
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
