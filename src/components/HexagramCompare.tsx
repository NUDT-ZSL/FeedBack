import type { HexagramSnapshot } from '@/types';
import HexagramFigure from '@/components/HexagramFigure';

interface HexagramCompareProps {
  benGua: HexagramSnapshot;
  bianGua: HexagramSnapshot;
  movingPositions: number[];
  figureSize?: 'sm' | 'md' | 'lg';
}

/** 本卦与变卦对照视图 */
export default function HexagramCompare({
  benGua,
  bianGua,
  movingPositions,
  figureSize = 'md',
}: HexagramCompareProps) {
  const unchanged = benGua.binary === bianGua.binary;
  return (
    <div className="flex items-start justify-center gap-4 sm:gap-8">
      <div className="flex flex-col items-center gap-2">
        <HexagramFigure
          binary={benGua.binary}
          movingPositions={movingPositions}
          showLabels
          size={figureSize}
        />
        <div className="text-center">
          <p className="text-xs text-stone-500">本卦</p>
          <p className="font-bold text-[#2a1a0a]">{benGua.fullName}</p>
          <p className="text-xs text-stone-500">
            上{benGua.upperTrigram} 下{benGua.lowerTrigram}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center self-center">
        <span className="text-2xl text-[#b8860b]">→</span>
        <span className="text-xs text-stone-500">{unchanged ? '无动爻' : '之变'}</span>
      </div>

      <div className="flex flex-col items-center gap-2">
        <HexagramFigure binary={bianGua.binary} showLabels size={figureSize} />
        <div className="text-center">
          <p className="text-xs text-stone-500">变卦{unchanged && '（同本卦）'}</p>
          <p className="font-bold text-[#2a1a0a]">{bianGua.fullName}</p>
          <p className="text-xs text-stone-500">
            上{bianGua.upperTrigram} 下{bianGua.lowerTrigram}
          </p>
        </div>
      </div>
    </div>
  );
}
