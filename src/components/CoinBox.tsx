import { cn } from '@/lib/utils';
import { useDivinationStore } from '@/store';
import { playVibrateSound } from '@/utils/audio';

const STEP_LABELS = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
const YAO_LABELS: Record<string, string> = {
  'lao-yang': '老阳（阳动）',
  'lao-yin': '老阴（阴动）',
  'shao-yang': '少阳（阳静）',
  'shao-yin': '少阴（阴静）',
};

function Coin({ face, flipping, index }: { face: 'zheng' | 'bei'; flipping: boolean; index: number }) {
  return (
    <button
      type="button"
      aria-label="铜钱"
      onClick={() => playVibrateSound()}
      className={cn(
        'flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#8a6a2f] shadow-md',
        'bg-gradient-to-br from-[#ffe58a] via-[#e8b84b] to-[#a87a25]',
        flipping && 'coin-flipping cursor-wait'
      )}
      style={flipping ? { animationDelay: `${index * 60}ms` } : undefined}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-[3px] bg-[#f0e6d3]">
        {face === 'zheng' ? (
          <span className="font-kai text-[9px] font-bold leading-none text-[#8a6a2f]">通宝</span>
        ) : null}
      </span>
    </button>
  );
}

/** 占卦桌：铜钱盒、摇卦按钮、从初爻到上爻的步骤指示器 */
export default function CoinBox() {
  const { yaos, coins, flipping, complete, cast, resetCast } = useDivinationStore();
  const step = yaos.length;
  const lastYao = yaos[yaos.length - 1];

  const handleCast = () => {
    if (complete) {
      resetCast();
      window.setTimeout(() => cast(), 0);
      return;
    }
    cast();
  };

  return (
    <div className="rounded-xl border border-amber-900/25 bg-[#e8dcc8] p-5 shadow-inner">
      <h2 className="font-kai mb-3 text-xl font-bold text-amber-950">铜钱盒</h2>

      <div className="mb-4 rounded-lg bg-gradient-to-br from-[#6b4423] to-[#5d3a1a] p-5 shadow-inner">
        <div className="flex items-end justify-center gap-4">
          {[0, 1, 2].map((i) => {
            const face = coins[i]?.face ?? (i === 0 ? 'zheng' : 'bei');
            return <Coin key={i} index={i} face={face} flipping={flipping} />;
          })}
        </div>
        <p className="mt-3 text-center text-xs text-amber-100/70">
          字（正）一枚为少阳，二枚为少阴；三字为老阳，三背为老阴，老则动
        </p>
      </div>

      <div className="mb-4 flex items-center justify-between">
        {STEP_LABELS.map((label, i) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                i < step && 'border-amber-700 bg-amber-700 text-white',
                i === step && !complete && 'border-red-700 bg-red-100 text-red-700 ring-2 ring-red-300',
                i > step && 'border-stone-400 bg-[#f0e6d3] text-stone-400',
                complete && 'border-amber-700 bg-amber-700 text-white'
              )}
            >
              {i + 1}
            </span>
            <span className="text-[10px] text-stone-600">{label}</span>
          </div>
        ))}
      </div>

      <div className="min-h-6 text-center text-sm">
        {complete ? (
          <span className="font-kai font-bold text-red-800">六爻成卦，已存入卦录</span>
        ) : lastYao && !flipping ? (
          <span className="text-stone-700">
            第{step}爻得：<span className="font-kai font-bold text-amber-900">{YAO_LABELS[lastYao.type]}</span>
          </span>
        ) : (
          <span className="text-stone-500">点击铜钱盒摇卦，六次成卦</span>
        )}
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={handleCast}
          disabled={flipping}
          className={cn(
            'flex-1 rounded-lg px-4 py-2.5 font-kai font-bold text-white shadow transition',
            flipping
              ? 'cursor-wait bg-stone-400'
              : 'bg-amber-800 hover:bg-amber-900 active:scale-[0.98]'
          )}
        >
          {flipping ? '铜钱翻落中…' : complete ? '再摇一卦' : step === 0 ? '开始摇卦' : `摇第${step + 1}爻`}
        </button>
        <button
          type="button"
          onClick={resetCast}
          disabled={flipping || (step === 0 && !complete)}
          className="rounded-lg border border-stone-400 px-4 py-2.5 text-sm text-stone-700 transition hover:bg-stone-200/60 disabled:opacity-40"
        >
          清空卦盘
        </button>
      </div>
    </div>
  );
}
