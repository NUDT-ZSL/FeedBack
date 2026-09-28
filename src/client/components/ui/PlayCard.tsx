import { useNavigate } from 'react-router-dom';
import { User, Users, ChevronRight } from 'lucide-react';
import type { Play } from '../../types';
import CountdownTimer from './CountdownTimer';

interface Props {
  play: Play;
  index?: number;
}

export default function PlayCard({ play, index = 0 }: Props) {
  const navigate = useNavigate();

  return (
    <article
      onClick={() => navigate(`/play/${play.id}`)}
      className="card card-hover cursor-pointer group stagger-item"
      style={{ animationDelay: `${Math.min(index * 0.05, 0.6)}s` }}
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-t-card">
        {play.coverUrl ? (
          <img
            src={play.coverUrl}
            alt={play.title}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-wine-950/90 via-wine-950/30 to-transparent" />
        <div className="absolute inset-x-0 top-0 p-3 flex items-start justify-between">
          <CountdownTimer deadline={play.deadline} />
          <span className="badge bg-wine-700/90 text-white backdrop-blur-sm">
            {play.roleCount || play.roles?.length || 0} 角色
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4">
          <h3 className="font-display text-xl md:text-2xl font-bold text-white drop-shadow-lg line-clamp-2">
            {play.title}
          </h3>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-theater-textDim">
          <User className="w-4 h-4 text-gold-500/70 shrink-0" />
          <span className="truncate">{play.author}</span>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-theater-border/50">
          {play.director?.avatar && (
            <img
              src={play.director.avatar}
              alt={play.director.name}
              className="w-8 h-8 rounded-full border border-gold-500/30"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-theater-textMuted">导演</p>
            <p className="text-sm font-medium text-theater-text truncate">
              {play.director?.name || '未知'}
            </p>
          </div>
          <div className="flex items-center gap-1 text-sm text-gold-400 font-medium group-hover:translate-x-1 transition-transform">
            <span>详情</span>
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>

        {play.roles && play.roles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {play.roles.slice(0, 4).map((role) => (
              <span
                key={role.id}
                className="text-[11px] px-2 py-0.5 rounded-full bg-theater-bg text-theater-textDim
                  border border-theater-border/50 truncate max-w-[120px]"
                title={role.name}
              >
                {role.name}
                {role.selectedActor && (
                  <span className="text-gold-400 ml-1">✓</span>
                )}
              </span>
            ))}
            {play.roles.length > 4 && (
              <span className="text-[11px] px-2 py-0.5 text-theater-textMuted">
                +{play.roles.length - 4}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
