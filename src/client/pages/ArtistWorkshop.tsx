import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import LazyLoad from 'react-lazyload';
import { Plus, X, Image as ImageIcon, User, Calendar, Send } from 'lucide-react';
import { useAppState, authHeaders } from '../App';
import { Artist, Work, Exhibition } from '../types';
import { useState, useEffect, useMemo } from 'react';
import PortfolioViewer from '../components/PortfolioViewer';

export default function ArtistWorkshop() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch } = useAppState();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [artistWorks, setArtistWorks] = useState<Work[]>([]);
  const [applyModalOpen, setApplyModalOpen] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [portfolioViewerOpen, setPortfolioViewerOpen] = useState(false);
  const [targetExhibitionId, setTargetExhibitionId] = useState<string | null>(null);
  const [loadingWorks, setLoadingWorks] = useState(false);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const found = state.artists.find((a) => a.id === id);
    if (found) setArtist(found);
  }, [id, state.artists]);

  useEffect(() => {
    if (!id) return;

    const worksInState = state.works.filter((w) => w.artistId === id);
    if (worksInState.length > 0) {
      setArtistWorks(worksInState);
      return;
    }

    const fetchWorksFromExhibitions = async () => {
      setLoadingWorks(true);
      try {
        const allWorks: Work[] = [];
        const seenIds = new Set<string>();

        for (const ex of state.exhibitions) {
          try {
            const res = await fetch(`/api/exhibitions/${ex.id}`);
            const data: Exhibition & { works: Work[] } = await res.json();
            dispatch({ type: 'UPDATE_EXHIBITION', payload: data });

            for (const w of data.works || []) {
              if (!seenIds.has(w.id)) {
                seenIds.add(w.id);
                allWorks.push(w);
                dispatch({ type: 'UPDATE_WORK', payload: w });
              }
            }
          } catch (err) {
            console.error(err);
          }
        }

        const filtered = allWorks.filter((w) => w.artistId === id);
        setArtistWorks(filtered);
      } catch (err) {
        console.error('Failed to fetch works:', err);
      } finally {
        setLoadingWorks(false);
      }
    };

    fetchWorksFromExhibitions();
  }, [id, state.exhibitions, state.works, dispatch]);

  const exhibitionCount = useMemo(() => {
    if (!id) return 0;
    return state.exhibitions.filter((ex) =>
      ex.workIds?.some((wid) => artistWorks.some((w) => w.id === wid))
    ).length;
  }, [id, state.exhibitions, artistWorks]);

  const openApplyModal = (workId: string) => {
    setSelectedWorkId(workId);
    setApplyModalOpen(true);
    setApplySuccess(null);
  };

  const handleApplyToExhibition = async (exhibitionId: string) => {
    if (!selectedWorkId || !state.currentUser?.id) return;
    setTargetExhibitionId(exhibitionId);

    try {
      const res = await fetch(`/api/exhibitions/${exhibitionId}`);
      const data: Exhibition & { works: Work[] } = await res.json();
      const currentWorkIds = data.workIds || [];

      if (currentWorkIds.includes(selectedWorkId)) {
        setApplySuccess('该作品已在此展览中');
        setTargetExhibitionId(null);
        return;
      }

      const updatedWorkIds = [...currentWorkIds, selectedWorkId];
      const updateRes = await fetch(`/api/exhibitions/${exhibitionId}/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ workIds: updatedWorkIds }),
      });
      const updated: Exhibition = await updateRes.json();
      dispatch({ type: 'UPDATE_EXHIBITION', payload: updated });

      setApplySuccess('申请已提交，等待策展人确认');
      setTimeout(() => {
        setApplyModalOpen(false);
        setApplySuccess(null);
      }, 1500);
    } catch (err) {
      console.error(err);
      setApplySuccess('申请失败，请稍后重试');
    } finally {
      setTargetExhibitionId(null);
    }
  };

  const openPortfolioViewer = (workId: string) => {
    setSelectedWorkId(workId);
    setPortfolioViewerOpen(true);
  };

  if (!artist) {
    return (
      <div className="min-h-screen bg-ivory flex items-center justify-center">
        <p className="text-charcoal/60">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ivory">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-forest-800 via-forest-700 to-forest-900" />
        <div className="absolute inset-0 opacity-30">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4a855' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
        </div>

        <div className="relative max-w-6xl mx-auto px-4 py-12 md:py-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col md:flex-row items-center md:items-start gap-6 md:gap-8"
          >
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-copper-400 to-gold-400 blur-md opacity-60" />
              <img
                src={artist.avatar}
                alt={artist.name}
                className="relative w-28 h-28 md:w-36 md:h-36 rounded-full border-4 border-copper-400 object-cover shadow-2xl"
              />
            </div>

            <div className="flex-1 text-center md:text-left">
              <h1 className="font-display text-3xl md:text-4xl font-bold text-ivory mb-2">
                {artist.name}
              </h1>
              <div className="flex items-center justify-center md:justify-start gap-3 mb-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-copper-500/20 text-copper-300 text-sm font-medium border border-copper-500/30">
                  <User size={14} />
                  {artist.role === 'curator' ? '策展人' : '模型师'}
                </span>
              </div>
              <p className="text-ivory/70 max-w-lg leading-relaxed mb-6">
                {artist.role === 'curator'
                  ? '专注于挖掘微缩模型艺术的策展人，致力于在方寸之间构建完整的世界。相信每一件微缩作品都承载着一个时代的回响。'
                  : '微缩模型艺术家，擅长用极致的细节还原被遗忘的场景。每一件作品都是对时间的凝视。'}
              </p>
              <div className="flex items-center justify-center md:justify-start gap-6">
                <div className="text-center">
                  <div className="font-display text-2xl font-bold text-copper-400">
                    {artistWorks.length}
                  </div>
                  <div className="text-sm text-ivory/60">作品</div>
                </div>
                <div className="w-px h-10 bg-ivory/20" />
                <div className="text-center">
                  <div className="font-display text-2xl font-bold text-copper-400">
                    {exhibitionCount}
                  </div>
                  <div className="text-sm text-ivory/60">参展</div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">
        <div className="flex items-center justify-between mb-6 md:mb-8">
          <h2 className="font-display text-xl md:text-2xl font-bold text-charcoal flex items-center gap-2">
            <ImageIcon size={24} className="text-copper-500" />
            我的作品
          </h2>
          <Link
            to="/create"
            className="inline-flex items-center gap-2 px-4 py-2 bg-copper-500 text-ivory rounded-lg font-medium hover:bg-copper-400 transition-colors shadow-md"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">发布新作品</span>
          </Link>
        </div>

        {loadingWorks ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-copper-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : artistWorks.length === 0 ? (
          <div className="text-center py-20 bg-white/50 rounded-xl border border-forest-100">
            <ImageIcon size={48} className="mx-auto text-forest-200 mb-4" />
            <p className="text-charcoal/60 mb-4">暂无作品</p>
            <Link
              to="/create"
              className="inline-flex items-center gap-2 px-4 py-2 bg-copper-500 text-ivory rounded-lg font-medium hover:bg-copper-400 transition-colors"
            >
              <Plus size={18} />
              发布第一件作品
            </Link>
          </div>
        ) : (
          <div className="masonry-grid">
            {artistWorks.map((work, index) => (
              <motion.div
                key={work.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08, duration: 0.4 }}
                className="masonry-item"
              >
                <motion.div
                  className="relative bg-white rounded-xl overflow-hidden shadow-md cursor-pointer group"
                  whileHover={{ scale: 1.03, y: -4 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  style={{ boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                >
                  <div className="relative overflow-hidden aspect-[4/3]">
                    <LazyLoad height={200} offset={100} once>
                      <motion.img
                        src={work.images[0]}
                        alt={work.title}
                        className="w-full h-full object-cover transition-transform duration-300"
                        whileHover={{ scale: 1.1 }}
                        transition={{ duration: 0.5 }}
                        onClick={() => openPortfolioViewer(work.id)}
                      />
                    </LazyLoad>

                    <div className="absolute inset-0 bg-forest-800/0 group-hover:bg-forest-800/80 transition-all duration-300 flex flex-col justify-end p-4 opacity-0 group-hover:opacity-100">
                      <h3 className="font-display text-lg font-bold text-ivory mb-1 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                        {work.title}
                      </h3>
                      <p className="text-copper-300 text-sm mb-3 transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-75">
                        {work.series}
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openApplyModal(work.id);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 w-full py-2 bg-copper-500 text-ivory rounded-lg text-sm font-medium hover:bg-copper-400 transition-colors transform translate-y-4 group-hover:translate-y-0 delay-100"
                      >
                        <Send size={14} />
                        申请参展
                      </button>
                    </div>
                  </div>

                  <div className="p-4">
                    <h3 className="font-display font-bold text-charcoal mb-1">
                      {work.title}
                    </h3>
                    <p className="text-sm text-copper-600 mb-2">{work.series}</p>
                    <p className="text-xs text-charcoal/50">
                      {work.scale} · {work.material}
                    </p>
                  </div>
                </motion.div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {applyModalOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setApplyModalOpen(false)}
          >
            <motion.div
              className="relative w-full max-w-md bg-ivory rounded-2xl overflow-hidden shadow-2xl"
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 bg-forest-800 text-ivory flex items-center justify-between">
                <h3 className="font-display text-xl font-bold">申请参展</h3>
                <button
                  onClick={() => setApplyModalOpen(false)}
                  className="p-1.5 rounded-full hover:bg-ivory/10 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 max-h-96 overflow-y-auto">
                {applySuccess ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-copper-100 flex items-center justify-center">
                      <Send size={28} className="text-copper-500" />
                    </div>
                    <p className="text-charcoal font-medium">{applySuccess}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-charcoal/70 mb-4">
                      选择要申请加入的展览：
                    </p>
                    {state.exhibitions.map((ex) => {
                      const curator = state.artists.find(
                        (a) => a.id === ex.curatorId
                      );
                      const isAlreadyIn = ex.workIds?.includes(selectedWorkId || '');
                      return (
                        <motion.button
                          key={ex.id}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleApplyToExhibition(ex.id)}
                          disabled={targetExhibitionId === ex.id || isAlreadyIn}
                          className={`w-full flex items-center gap-4 p-3 rounded-xl border transition-all text-left ${
                            isAlreadyIn
                              ? 'bg-forest-50 border-forest-200 opacity-60 cursor-not-allowed'
                              : 'bg-white border-forest-100 hover:border-copper-400 hover:shadow-md cursor-pointer'
                          }`}
                        >
                          <img
                            src={ex.coverImage}
                            alt={ex.title}
                            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-display font-bold text-charcoal text-sm truncate">
                              {ex.title}
                            </h4>
                            <p className="text-xs text-charcoal/60 mb-1">
                              策展人：{curator?.name || '未知'}
                            </p>
                            <div className="flex items-center gap-3 text-xs text-charcoal/50">
                              <span className="flex items-center gap-1">
                                <ImageIcon size={12} />
                                {ex.workCount || ex.workIds?.length || 0} 件作品
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar size={12} />
                                {ex.startDate}
                              </span>
                            </div>
                          </div>
                          {targetExhibitionId === ex.id && (
                            <div className="w-5 h-5 border-2 border-copper-400 border-t-transparent rounded-full animate-spin" />
                          )}
                          {isAlreadyIn && (
                            <span className="text-xs text-forest-600 font-medium">
                              已参展
                            </span>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {portfolioViewerOpen && selectedWorkId && (
          <PortfolioViewer
            workId={selectedWorkId}
            isOpen={portfolioViewerOpen}
            onClose={() => setPortfolioViewerOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
