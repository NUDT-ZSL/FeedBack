import { cn } from '@/lib/utils';

interface RecipeCardSkeletonProps {
  aspectRatio?: string;
  className?: string;
}

export default function RecipeCardSkeleton({
  aspectRatio = '4/3',
  className,
}: RecipeCardSkeletonProps) {
  return (
    <div
      className={cn(
        'bg-cream-50 rounded-xl overflow-hidden shadow-card',
        'animate-pulse',
        className
      )}
    >
      <div
        className="bg-brown-100 w-full"
        style={{ aspectRatio }}
      />

      <div className="p-4 space-y-3">
        <div className="space-y-2">
          <div className="h-5 bg-brown-100 rounded-md w-3/4" />
          <div className="h-4 bg-brown-50 rounded-md w-1/2" />
        </div>

        <div className="flex items-center gap-2 pt-2">
          <div className="w-7 h-7 rounded-full bg-brown-100" />
          <div className="h-3 bg-brown-100 rounded-md w-20" />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-brown-100">
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-brown-100 rounded" />
            <div className="h-3 bg-brown-100 rounded-md w-12" />
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-4 bg-brown-100 rounded" />
            <div className="h-3 bg-brown-100 rounded-md w-8" />
          </div>
        </div>
      </div>
    </div>
  );
}
