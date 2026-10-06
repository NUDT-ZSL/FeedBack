import type { CoinSide } from '@/types';
import { cn } from '@/lib/utils';

interface CoinBoxProps {
  casting: boolean;
  /** 最近一次摇出的三枚铜钱正背 */
  lastCoins: [CoinSide, CoinSide, CoinSide] | null;
  disabled: boolean;
  onThrow: () => void;
}

function Coin({ face, casting, index }: { face: CoinSide | null; casting: boolean; index: number }) {
  return (
    <div
      className={cn(
        'relative flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#8a6d1f] bg-gradient-to-br from-[#d9b64a] via-[#c9a227] to-[#9a7b1c] shadow-md',
        casting && 'coin-flip',
      )}
      style={casting ? { animationDelay: `${index * 90}ms` } : undefined}
    >
      {/* 方孔 */}
      <div className="flex h-6 w-6 items-center justify-center bg-[#f0e6d3] shadow-inner">
        <span className="absolute text-[10px] font-bold text-[#5d3a1a]">
          {!casting && face ? (face === 'zheng' ? '字' : '背') : ''}
        </span>
      </div>
    </div>
  );
}

/** 铜钱盒：点击摇卦，三枚铜钱翻转动画 */
export default function CoinBox({ casting, lastCoins, disabled, onThrow }: CoinBoxProps) {
  return (
    <button
      type="button"
      onClick={onThrow}
      disabled={disabled || casting}
      className={cn(
        'group relative flex flex-col items-center gap-3 rounded-2xl border-2 border-[#8a6d1f]/60 bg-gradient-to-b from-[#6b4423] to-[#5d3a1a] px-10 py-6 shadow-lg transition',
        disabled || casting ? 'cursor-not-allowed opacity-70' : 'hover:shadow-xl active:scale-95',
        casting && 'coin-box-shake',
      )}
    >
      <div className="flex gap-4">
        {[0, 1, 2].map((index) => (
          <Coin
            key={index}
            index={index}
            casting={casting}
            face={lastCoins ? lastCoins[index] : null}
          />
        ))}
      </div>
      <span className="text-sm tracking-widest text-[#f0e6d3]/90">
        {casting ? '铜钱翻滚中…' : '点击铜钱盒摇卦'}
      </span>
    </button>
  );
}
