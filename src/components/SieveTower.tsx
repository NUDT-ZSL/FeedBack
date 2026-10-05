import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import {
  getFlourTypeColor,
  getFlourTypeName,
  roundWeight,
} from '../MillCore';
import type { AnimatingBag, FlourType, FlourMix } from '../types';

interface SieveTowerProps {
  totals: FlourMix;
  animatingBags: AnimatingBag[];
  onPack: (type: FlourType) => void;
  onBagAnimationDone: (id: string) => void;
}

const FLOUR_TYPES: FlourType[] = ['fine', 'medium', 'bran'];
const MESH_LABEL: Record<FlourType, string> = {
  fine: '80目',
  medium: '60目',
  bran: '底层',
};

function Bucket({
  type,
  weight,
  bags,
  onPack,
  onBagAnimationDone,
}: {
  type: FlourType;
  weight: number;
  bags: AnimatingBag[];
  onPack: (type: FlourType) => void;
  onBagAnimationDone: (id: string) => void;
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="mb-1 rounded px-2 py-0.5 text-xs font-semibold"
        style={{ background: '#8b5a2b', color: '#f5deb3' }}
      >
        {MESH_LABEL[type]}
      </div>
      <div
        className="relative flex h-16 w-20 items-end justify-center overflow-visible rounded-b-2xl rounded-t-md"
        style={{
          background: 'linear-gradient(#8b5a2b, #6b4423)',
          border: '2px solid #5a3a1a',
        }}
      >
        <div
          className="w-full rounded-b-xl"
          style={{
            height: Math.min(40, weight * 14),
            background: getFlourTypeColor(type),
            opacity: 0.9,
            transition: 'height 0.4s ease-out',
          }}
        />
        {/* 动画袋：按唯一 id 渲染，同时打包多袋互不覆盖 */}
        <AnimatePresence>
          {bags.map((bag) => (
            <BagPop key={bag.id} bag={bag} onDone={onBagAnimationDone} />
          ))}
        </AnimatePresence>
      </div>
      <div className="mt-1 text-sm font-bold" style={{ color: '#5a3a1a' }}>
        {getFlourTypeName(type)} {roundWeight(weight).toFixed(1)} 斤
      </div>
      <button
        onClick={() => onPack(type)}
        className="mt-1 rounded-lg px-3 py-1 text-sm font-semibold text-white transition-colors duration-300 hover:bg-[#a0522d]"
        style={{ background: '#8b5a2b', minHeight: 32 }}
      >
        打包
      </button>
    </div>
  );
}

function BagPop({
  bag,
  onDone,
}: {
  bag: AnimatingBag;
  onDone: (id: string) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDone(bag.id), 1400);
    return () => window.clearTimeout(timer);
  }, [bag.id, onDone]);

  return (
    <motion.div
      className="absolute left-1/2 top-0 z-10 flex h-12 w-12 flex-col items-center justify-center rounded-lg text-center"
      style={{
        background: '#d4b886',
        border: '2px solid #8b5a2b',
        color: '#5a3a1a',
        fontSize: 9,
        lineHeight: 1.15,
      }}
      initial={{ scale: 0, y: 10, x: '-50%' }}
      animate={{ scale: 1, y: -44, x: '-50%', rotate: [0, -8, 6, 0] }}
      exit={{ opacity: 0, y: -56 }}
      transition={{
        scale: { type: 'spring', damping: 10, stiffness: 200 },
        y: { duration: 0.5, ease: 'easeOut' },
        rotate: { duration: 0.5, delay: 0.15 },
        opacity: { duration: 0.3, delay: 1.0 },
      }}
    >
      <span className="font-bold">{getFlourTypeName(bag.type)}</span>
      <span>{bag.weight.toFixed(1)}斤</span>
    </motion.div>
  );
}

export default function SieveTower({
  totals,
  animatingBags,
  onPack,
  onBagAnimationDone,
}: SieveTowerProps) {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: '#e8d5b0',
        border: '2px solid #8b5a2b',
        borderRadius: 8,
      }}
    >
      <div
        className="mb-3 flex items-center justify-center gap-2 text-sm"
        style={{ color: '#5a3a1a' }}
      >
        <span style={{ animation: 'sieve-shake 0.6s infinite' }}>罗筛分级</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {FLOUR_TYPES.map((type) => (
          <Bucket
            key={type}
            type={type}
            weight={totals[type]}
            bags={animatingBags.filter((bag) => bag.type === type)}
            onPack={onPack}
            onBagAnimationDone={onBagAnimationDone}
          />
        ))}
      </div>
      <style>{`@keyframes sieve-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(3px); } 75% { transform: translateX(-3px); } }`}</style>
    </div>
  );
}
