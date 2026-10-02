import { motion } from 'framer-motion';
import type { ForeignTrader as ForeignTraderType } from '../types';

interface ForeignTraderProps {
  trader: ForeignTraderType;
  reaction?: 'idle' | 'happy' | 'sad' | 'thinking';
}

export default function ForeignTrader({ trader, reaction = 'idle' }: ForeignTraderProps) {
  const getAnimation = () => {
    switch (reaction) {
      case 'happy':
        return {
          animate: { y: [0, -5, 0], transition: { repeat: 2, duration: 0.3 } }
        };
      case 'sad':
        return {
          animate: { rotate: [-5, 5, -5], transition: { repeat: 2, duration: 0.3 } }
        };
      case 'thinking':
        return {
          animate: { scale: [1, 1.02, 1], transition: { repeat: 1, duration: 0.5 } }
        };
      default:
        return {};
    }
  };

  const animation = getAnimation();

  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div
        className="relative w-20 h-20 rounded-full overflow-hidden border-4 border-[#8b6914] shadow-lg"
        style={{ backgroundColor: trader.clothingColor }}
        {...animation}
      >
        <div
          className="absolute top-2 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full"
          style={{ backgroundColor: trader.skinColor }}
        />
        <div className="absolute top-8 left-1/2 -translate-x-1/2 flex gap-3">
          <div className="w-2 h-2 bg-[#2c1810] rounded-full" />
          <div className="w-2 h-2 bg-[#2c1810] rounded-full" />
        </div>
        <div className="absolute top-12 left-1/2 -translate-x-1/2 w-4 h-1 bg-[#2c1810] rounded-full" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-6 rounded-t-full" style={{ backgroundColor: trader.clothingColor }} />
      </motion.div>
      <div className="text-center">
        <p className="font-bold text-[#2c1810] text-lg">{trader.name}</p>
        <p className="text-sm text-[#5d3a1a]">来自{trader.origin}</p>
      </div>
    </div>
  );
}
