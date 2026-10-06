// 铜钱组件（被 Stage 调用）：framer-motion 抛物线动画
import { memo, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { Coin as CoinType } from '@/types';
import { useGameStore } from '@/store';

interface CoinProps {
  coin: CoinType;
}

const Coin = memo(function Coin({ coin }: CoinProps) {
  const collectCoin = useGameStore((s) => s.collectCoin);

  // 兜底：若动画因卸载等原因未触发 onAnimationComplete，超时强制结算
  useEffect(() => {
    const timer = window.setTimeout(() => collectCoin(coin.id), (coin.flightTime + 0.5) * 1000);
    return () => window.clearTimeout(timer);
  }, [coin.id, coin.flightTime, collectCoin]);

  const midX = (coin.startPos.x + coin.endPos.x) / 2;
  const peakY = Math.min(coin.startPos.y, coin.endPos.y) - 18; // 抛物线顶点

  return (
    <motion.div
      className="pointer-events-none absolute z-30"
      initial={{ left: `${coin.startPos.x}%`, top: `${coin.startPos.y}%`, opacity: 1 }}
      animate={{
        left: [`${coin.startPos.x}%`, `${midX}%`, `${coin.endPos.x}%`],
        top: [`${coin.startPos.y}%`, `${peakY}%`, `${coin.endPos.y}%`],
        opacity: coin.collected ? 0 : 1,
      }}
      transition={{ duration: coin.flightTime, ease: 'easeOut', times: [0, 0.5, 1] }}
      onAnimationComplete={() => collectCoin(coin.id)}
    >
      <div
        className="coin-face h-3 w-3 rounded-full"
        style={{
          background: 'radial-gradient(circle at 35% 35%, #ebb04b, #8b6914)',
          boxShadow: '0 0 4px rgba(235, 176, 75, 0.8)',
        }}
        title={`${coin.value}文`}
      />
    </motion.div>
  );
});

export default Coin;
