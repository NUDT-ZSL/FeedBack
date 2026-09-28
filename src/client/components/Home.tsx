import { useEffect, useState, useCallback } from 'react';
import { Search, Sparkles, Filter, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useInfiniteScroll } from '../hooks/useInfiniteScroll';
import { debounce } from '../utils/format';
import PlayCard from './ui/PlayCard';

export default function Home() {
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const plays = useStore((s) => s.plays);
  const playsTotal = useStore((s) => s.playsTotal);
  const playsPage = useStore((s) => s.playsPage);
  const hasMorePlays = useStore((s) => s.hasMorePlays);
  const loadPlays = useStore((s) => s.loadPlays);
  const showToast = useStore((s) => s.showToast);

  useEffect(() => {
    loadPlays(1, '', false).catch((err) => showToast(err.message, 'error'));
  }, [loadPlays, showToast]);

  const debouncedSearch = debounce((q: string) => {
    setSearching(true);
    loadPlays(1, q, false)
      .catch((err) => showToast(err.message, 'error'))
      .finally(() => setSearching(false));
  }, 200);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    debouncedSearch(e.target.value);
  };

  const loadMore = useCallback(async () => {
    if (!hasMorePlays) return;
    try {
      await loadPlays(playsPage + 1, search, true);
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }, [hasMorePlays, playsPage, search, loadPlays, showToast]);

  const sentinelRef = useInfiniteScroll(loadMore, hasMorePlays, 300);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden card !p-0 fade-in-up">
        <div
          className="absolute inset-0 bg-gradient-to-br from-wine-900/80 via-theater-card to-theater-card"
          style={{
            backgroundImage:
              'radial-gradient(ellipse at top left, rgba(212, 175, 55, 0.15) 0%, transparent 50%), radial-gradient(ellipse at bottom right, rgba(114, 47, 55, 0.4) 0%, transparent 50%)',
          }}
        />
        <div className="relative p-6 md:p-10 lg:p-12">
          <div className="max-w-3xl space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold-500/10 border border-gold-500/30 text-gold-400 text-sm">
              <Sparkles className="w-4 h-4" />
              发现您的下一个舞台角色
            </div>
            <h1 className="font-display text-3xl md:text-5xl lg:text-6xl font-bold leading-tight">
              <span className="text-theater-text">业余戏剧社</span>
              <br />
              <span className="gold-gradient-text">演员招募平台</span>
            </h1>
            <p className="text-theater-textDim text-base md:text-lg max-w-xl leading-relaxed">
              汇聚优质剧本与演员资源，打造高效的角色匹配与面试协作体验。
              浏览热门剧本、报名心仪角色、掌握面试动态，一切尽在戏剧社招募系统。
            </p>

            <div className="relative max-w-2xl mt-4">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-theater-textMuted" />
              <input
                type="text"
                value={search}
                onChange={handleSearch}
                placeholder="搜索剧本名称、作者或剧情..."
                className="input pl-12 pr-14 py-3.5 text-base !bg-theater-bg/80 backdrop-blur-sm
                  border-gold-500/30 focus:border-gold-400 focus:ring-gold-500/30"
              />
              {searching && (
                <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gold-400 animate-spin" />
              )}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="page-title">招募中的剧本</h2>
            <p className="text-theater-textDim mt-2 text-sm">
              共 <span className="text-gold-400 font-semibold">{playsTotal}</span> 个剧本正在招募
              {search && (
                <>
                  {' '}· 搜索关键词：
                  <span className="text-gold-400">"{search}"</span>
                </>
              )}
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-sm text-theater-textDim">
            <Filter className="w-4 h-4 text-gold-400" />
            <span>按发布时间排序</span>
          </div>
        </div>

        {plays.length === 0 && !searching ? (
          <div className="card p-16 text-center">
            <Sparkles className="w-16 h-16 text-theater-textMuted mx-auto mb-4 opacity-30" />
            <h3 className="font-display text-xl font-semibold mb-2">
              {search ? '未找到匹配的剧本' : '暂无招募中的剧本'}
            </h3>
            <p className="text-theater-textDim">
              {search ? '请尝试其他关键词' : '请稍后再来查看，或等待导演发布新剧本'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6 stagger">
              {plays.map((play, idx) => (
                <PlayCard key={play.id} play={play} index={idx} />
              ))}
            </div>

            <div ref={sentinelRef} className="h-20 flex items-center justify-center mt-8">
              {hasMorePlays ? (
                <div className="flex items-center gap-3 text-theater-textDim">
                  <Loader2 className="w-5 h-5 animate-spin text-gold-400" />
                  <span className="text-sm">加载更多剧本...</span>
                </div>
              ) : plays.length > 0 ? (
                <div className="text-sm text-theater-textMuted">
                  — 已加载全部 {playsTotal} 个剧本 —
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
