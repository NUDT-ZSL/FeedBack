import type { Tea } from '@/types';
import { teaCategoryMap } from '@/utils/helpers';
import { cn } from '@/utils/helpers';

interface TeaCardProps {
  tea: Tea;
  onClick?: () => void;
  isNew?: boolean;
  isHighlighted?: boolean;
}

export default function TeaCard({ tea, onClick, isNew, isHighlighted }: TeaCardProps) {
  const category = teaCategoryMap[tea.category] || teaCategoryMap.green;
  const hasPhoto = tea.photo_path && tea.photo_path.trim() !== '';

  return (
    <div
      className={cn(
        'relative w-[200px] h-[260px] rounded-lg cursor-pointer overflow-hidden',
        'transition-all duration-300 ease-out',
        'hover:-translate-y-2 hover:shadow-xl',
        'sm:w-[180px] sm:h-[240px]',
        'md:w-[200px] md:h-[260px]',
        'lg:w-[200px] lg:h-[260px]',
        isNew && 'animate-fadeInUp',
        isHighlighted && 'animate-highlight'
      )}
      style={{
        backgroundColor: '#f5f0e8',
        backgroundImage: `
          radial-gradient(ellipse at 20% 30%, rgba(212, 163, 115, 0.1) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 70%, rgba(74, 44, 26, 0.08) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 0.3) 0%, transparent 70%)
        `,
        boxShadow: '0 4px 6px rgba(74, 44, 26, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
        fontFamily: "'Noto Serif SC', serif",
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 12px 24px rgba(212, 163, 115, 0.4), 0 4px 8px rgba(212, 163, 115, 0.2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 6px rgba(74, 44, 26, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.5)';
      }}
    >
      <div className="absolute top-0 left-0 w-full h-2 opacity-20"
        style={{
          backgroundImage: 'linear-gradient(90deg, transparent, rgba(74, 44, 26, 0.3), transparent)',
        }}
      />

      <div className="relative w-full h-[120px] sm:h-[110px] overflow-hidden">
        {hasPhoto ? (
          <img
            src={tea.photo_path}
            alt={tea.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const sibling = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
              if (sibling) sibling.style.display = 'flex';
            }}
          />
        ) : null}
        <div
          className={cn(
            'absolute inset-0 items-center justify-center text-5xl',
            hasPhoto ? 'hidden' : 'flex'
          )}
          style={{
            backgroundColor: category.color + '20',
          }}
        >
          {category.icon}
        </div>

        <div
          className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-xs text-white font-medium"
          style={{ backgroundColor: category.color }}
        >
          {category.name}
        </div>
      </div>

      <div className="p-3 flex flex-col h-[calc(100%-120px)] sm:h-[calc(100%-110px)]">
        <h3
          className="text-sm font-semibold truncate mb-1"
          style={{ color: '#4a2c1a' }}
        >
          {tea.name}
        </h3>

        <div className="space-y-1 text-xs flex-1">
          <div className="flex items-center gap-1" style={{ color: '#6b5344' }}>
            <span>📍</span>
            <span className="truncate">{tea.origin}</span>
          </div>
          <div className="flex items-center gap-1" style={{ color: '#6b5344' }}>
            <span>📅</span>
            <span>{tea.year}年</span>
          </div>
        </div>

        {tea.avg_score !== undefined && tea.avg_score !== null && (
          <div className="flex items-center justify-end mt-auto">
            <span
              className="text-lg font-bold"
              style={{
                background: `linear-gradient(135deg, ${category.color} 0%, ${category.color}cc 100%)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              {tea.avg_score.toFixed(1)}
            </span>
            <span className="text-xs ml-1" style={{ color: '#6b5344' }}>/ 10</span>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes highlight {
          0%, 100% {
            background-color: #f5f0e8;
          }
          50% {
            background-color: #fff3cd;
          }
        }

        .animate-fadeInUp {
          animation: fadeInUp 0.4s ease-out forwards;
        }

        .animate-highlight {
          animation: highlight 1s ease-in-out;
        }
      `}</style>
    </div>
  );
}
