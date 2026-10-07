import { cn } from '@/lib/utils';
import { yaoLabel } from '@/utils/hexagramCalc';

interface HexagramViewProps {
  /** 六位二进制爻序，初爻在前 */
  binary: string;
  /** 需要标注的动爻位置（1-6） */
  movingPositions?: number[];
  /** 需要高亮的变爻位置（变卦相对本卦翻转的位置） */
  changedPositions?: number[];
  /** 小尺寸（归档列表缩略图） */
  compact?: boolean;
}

const POSITIONS = [6, 5, 4, 3, 2, 1];

/** 六爻卦画：阳爻实线、阴爻断线，动爻红点与阴阳标记 */
export default function HexagramView({
  binary,
  movingPositions = [],
  changedPositions = [],
  compact = false,
}: HexagramViewProps) {
  const moving = new Set(movingPositions);
  const changed = new Set(changedPositions);

  return (
    <div className={cn('flex flex-col gap-1', compact ? 'w-16' : 'w-44')}>
      {POSITIONS.map((position) => {
        const isYang = binary[position - 1] === '1';
        const isMoving = moving.has(position);
        const isChanged = changed.has(position);
        const h = compact ? 'h-1.5' : 'h-2.5';
        return (
          <div key={position} className="flex items-center justify-center gap-2">
            <span
              className={cn(
                'w-4 shrink-0 text-center font-kai text-xs',
                compact && 'text-[10px]',
                isMoving ? 'font-bold text-red-700' : 'text-stone-500'
              )}
            >
              {yaoLabel(position, isYang)}
            </span>
            <div
              className={cn(
                'relative flex-1',
                h,
                isChanged && !isMoving && 'rounded-sm ring-2 ring-amber-500/70'
              )}
            >
              {isYang ? (
                <div
                  className={cn(
                    'h-full w-full rounded-sm',
                    isMoving ? 'bg-red-800' : 'bg-stone-800'
                  )}
                />
              ) : (
                <div className="flex h-full w-full items-stretch justify-between">
                  <div className={cn('h-full w-[46%] rounded-sm', isMoving ? 'bg-red-800' : 'bg-stone-800')} />
                  <div className={cn('h-full w-[46%] rounded-sm', isMoving ? 'bg-red-800' : 'bg-stone-800')} />
                </div>
              )}
            </div>
            <span
              className={cn(
                'w-4 shrink-0 text-center text-xs font-bold',
                compact && 'text-[10px]',
                isMoving ? 'text-red-700' : 'text-transparent'
              )}
            >
              {isYang ? '○' : '×'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
