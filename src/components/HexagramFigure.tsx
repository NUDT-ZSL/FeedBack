import { yaoLabel } from '@/utils/hexagramCalc';
import { cn } from '@/lib/utils';

interface HexagramFigureProps {
  /** 六爻二进制：索引 0 为初爻（最下），阳 1 阴 0 */
  binary: string;
  /** 动爻位置（1-6），以红点与“动”字标识 */
  movingPositions?: number[];
  /** 是否显示爻题（初九、六五…） */
  showLabels?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** 以淡色虚线占位的爻位（尚未摇出） */
  dimmedPositions?: number[];
  className?: string;
}

const sizeStyles = {
  sm: { bar: 'h-1.5 w-12', gap: 'gap-1', dot: 'h-1.5 w-1.5', label: 'text-[10px]' },
  md: { bar: 'h-2.5 w-24', gap: 'gap-1.5', dot: 'h-2 w-2', label: 'text-xs' },
  lg: { bar: 'h-3 w-36', gap: 'gap-2', dot: 'h-2.5 w-2.5', label: 'text-sm' },
} as const;

/** 六爻卦象图：上爻在上、初爻在下，阳实阴虚，动爻红点标记 */
export default function HexagramFigure({
  binary,
  movingPositions = [],
  showLabels = false,
  size = 'md',
  dimmedPositions = [],
  className,
}: HexagramFigureProps) {
  const styles = sizeStyles[size];
  const moving = new Set(movingPositions);
  const dimmed = new Set(dimmedPositions);
  // 渲染顺序：上爻（position 6）在最上，初爻（position 1）在最下
  const positions = [6, 5, 4, 3, 2, 1];

  return (
    <div className={cn('flex flex-col items-center', styles.gap, className)}>
      {positions.map((position) => {
        const isYang = binary[position - 1] === '1';
        const isMoving = moving.has(position);
        return (
          <div key={position} className="flex items-center gap-2">
            {showLabels && (
              <span className={cn('w-8 text-right text-stone-500', styles.label)}>
                {yaoLabel(position, isYang)}
              </span>
            )}
            {dimmed.has(position) ? (
              <div className={cn('rounded-sm border border-dashed border-[#2a1a0a]/25', styles.bar)} />
            ) : isYang ? (
              <div className={cn('rounded-sm bg-[#2a1a0a]', styles.bar)} />
            ) : (
              <div className={cn('flex justify-between', styles.bar)}>
                <div className="h-full w-[42%] rounded-sm bg-[#2a1a0a]" />
                <div className="h-full w-[42%] rounded-sm bg-[#2a1a0a]" />
              </div>
            )}
            <span className={cn('flex w-8 items-center gap-1', styles.label)}>
              {isMoving && (
                <>
                  <span className={cn('rounded-full bg-red-600', styles.dot)} />
                  <span className="text-red-700">动</span>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
