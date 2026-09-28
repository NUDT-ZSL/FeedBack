import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import LazyLoad from 'react-lazyload';
import {
  Heart,
  MessageCircle,
  GripVertical,
  Flame,
  ArrowLeft,
  Calendar,
} from 'lucide-react';
import { useAppState, authHeaders } from '../App';
import { Exhibition, Work, Artist } from '../types';
import PortfolioViewer from '../components/PortfolioViewer';

export default function ExhibitionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state, dispatch } = useAppState();

  const [exhibition, setExhibition] = useState<Exhibition | null>(null);
  const [localWorks, setLocalWorks] = useState<Work[]>([]);
  const [isCuratorMode, setIsCuratorMode] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [portfolioViewerOpen, setPortfolioViewerOpen] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;

    fetch(`/api/exhibitions/${id}`)
      .then((res) => res.json())
      .then((data: Exhibition & { works: Work[] }) => {
        setExhibition(data);
        setLocalWorks(data.works || []);
        dispatch({ type: 'UPDATE_EXHIBITION', payload: data });
      })
      .catch(console.error);
  }, [id, dispatch]);

  useEffect(() => {
    if (exhibition && state.currentUser) {
      setIsCuratorMode(exhibition.curatorId === state.currentUser?.id);
    }
  }, [exhibition, state.currentUser]);

  const curator = useMemo<Artist | undefined>(() => {
    if (!exhibition) return undefined;
    return state.artists.find((a) => a.id === exhibition.curatorId);
  }, [exhibition, state.artists]);

  const maxHeat = useMemo(() => {
    if (localWorks.length === 0) return 1;
    return Math.max(...localWorks.map((w) => w.heat), 1);
  }, [localWorks]);

  const handleLike = async (workId: string) => {
    setLocalWorks((prev) =>
      prev.map((w) =>
        w.id === workId ? { ...w, likes: w.likes + 1, heat: w.heat + 1 } : w
      )
    );

    try {
      const res = await fetch(`/api/works/${workId}/like`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const updated: Work = await res.json();
      setLocalWorks((prev) =>
        prev.map((w) => (w.id === workId ? updated : w))
      );
      dispatch({ type: 'UPDATE_WORK', payload: updated });
    } catch (err) {
      console.error(err);
      setLocalWorks((prev) =>
        prev.map((w) =>
          w.id === workId ? { ...w, likes: w.likes - 1, heat: w.heat - 1 } : w
        )
      );
    }
  };

  const handleComment = async (workId: string) => {
    const content = commentInputs[workId]?.trim();
    if (!content || !state.currentUser) return;

    setCommentInputs((prev) => ({ ...prev, [workId]: '' }));

    try {
      const res = await fetch(`/api/works/${workId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId: state.currentUser?.id, content }),
      });
      const updated: Work = await res.json();
      setLocalWorks((prev) =>
        prev.map((w) => (w.id === workId ? updated : w))
      );
      dispatch({ type: 'UPDATE_WORK', payload: updated });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDragStart = (index: number) => {
    if (!isCuratorMode) return;
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (!isCuratorMode || draggedIndex === null) return;
    if (draggedIndex !== index) {
      setDropTargetIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (!isCuratorMode || draggedIndex === null) return;

    const newWorks = [...localWorks];
    const [draggedItem] = newWorks.splice(draggedIndex, 1);
    newWorks.splice(dropIndex, 0, draggedItem);
    setLocalWorks(newWorks);
    setOrderChanged(true);
    setDraggedIndex(null);
    setDropTargetIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropTargetIndex(null);
  };

  const handleSaveOrder = async () => {
    if (!exhibition) return;
    const workIds = localWorks.map((w) => w.id);
    try {
      const res = await fetch(`/api/exhibitions/${exhibition.id}/order`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ workIds }),
      });
      const updated: Exhibition = await res.json();
      dispatch({ type: 'UPDATE_EXHIBITION', payload: updated });
      setExhibition({ ...updated, works: localWorks });
      setOrderChanged(false);
    } catch (err) {
      console.error(err);
    }
  };

  const openPortfolioViewer = (workId: string) => {
    setSelectedWorkId(workId);
    setPortfolioViewerOpen(true);
  };

  if (!exhibition) {
    return (
      <div className="min-h-screen bg-ivory flex items-center justify-center">
        <p className="text-charcoal/60">加载中...</p>
      </div>
    );
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <div className="min-h-screen bg-ivory">
      <div className="relative h-72 md:h-80 overflow-hidden">
        <img
          src={exhibition.coverImage}
          alt={exhibition.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-forest-900/90 via-forest-900/50 to-transparent" />

        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 z-10 flex items-center gap-2 px-4 py-2 rounded-lg bg-black/30 backdrop-blur-sm text-ivory hover:bg-black/50 transition-colors"
        >
          <ArrowLeft size={20} />
          <span>返回</span>
        </button>

        <button
          onClick={() => setIsCuratorMode(!isCuratorMode)}
          className="absolute top-4 right-4 z-10 px-4 py-2 rounded-lg bg-copper-500/90 text-ivory font-medium hover:bg-copper-400 transition-colors"
        >
          {isCuratorMode ? '退出策展人模式' : '策展人模式'}
        </button>

        <div className="absolute bottom-0 left-0 right-0 p-6 md:p-10 text-ivory">
          <h1 className="font-display text-3xl md:text-4xl font-bold mb-2">
            {exhibition.title}
          </h1>
          <p className="text-ivory/80 mb-4 max-w-2xl">{exhibition.description}</p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {curator && (
              <div className="flex items-center gap-2">
                <img
                  src={curator.avatar}
                  alt={curator.name}
                  className="w-6 h-6 rounded-full border border-copper-400"
                />
                <span>{curator.name}</span>
                <span className="text-ivory/50">· 策展人</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-ivory/70">
              <Calendar size={16} />
              <span>
                {exhibition.startDate} — {exhibition.endDate}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 md:py-8">
        {orderChanged && isCuratorMode && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-copper-100 border border-copper-300 rounded-lg flex items-center justify-between"
          >
            <span className="text-copper-800">作品顺序已调整，点击保存以更新展览</span>
            <button
              onClick={handleSaveOrder}
              className="btn-copper"
            >
              保存排序
            </button>
          </motion.div>
        )}

        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="relative pl-8 md:pl-12"
        >
          <div className="absolute left-3 md:left-5 top-0 bottom-0 w-0.5 bg-copper-400" />

          {localWorks.map((work, index) => (
            <motion.div
              key={work.id}
              variants={item}
              className="relative mb-8"
              draggable={isCuratorMode}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              style={{ opacity: draggedIndex === index ? 0.5 : 1 }}
            >
              <div className="absolute -left-8 md:-left-12 top-4 w-6 h-6 md:w-8 md:h-8 rounded-full bg-copper-400 text-ivory flex items-center justify-center text-sm font-bold font-display z-10">
                {index + 1}
              </div>

              <div
                className={`ml-4 md:ml-8 bg-white rounded-xl shadow-md overflow-hidden transition-all ${
                  isCuratorMode ? 'cursor-move' : ''
                } ${
                  dropTargetIndex === index
                    ? 'border-2 border-dashed border-copper-400'
                    : 'border border-transparent'
                }`}
              >
                <div className="flex">
                  {isCuratorMode && (
                    <div className="flex items-center px-2 text-copper-400 cursor-grab active:cursor-grabbing">
                      <GripVertical size={20} />
                    </div>
                  )}

                  <div className="flex-1">
                    <div
                      className="relative cursor-pointer overflow-hidden min-h-[224px] aspect-[16/10]"
                      onClick={() => openPortfolioViewer(work.id)}
                    >
                      <LazyLoad height={280} offset={200} once>
                        <motion.div
                          className="w-full h-full transition-transform duration-300"
                          whileHover={{ scale: 1.06 }}
                          transition={{ duration: 0.4 }}
                        >
                          <img
                            src={work.images[0]}
                            alt={work.title}
                            className="w-full h-48 md:h-56 object-cover transition-transform duration-300"
                          />
                        </motion.div>
                      </LazyLoad>
                    </div>

                    <div className="p-4 md:p-5">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-display text-xl font-bold text-charcoal">
                            {work.title}
                          </h3>
                          <span className="inline-block px-2 py-0.5 mt-1 text-xs bg-copper-100 text-copper-700 rounded">
                            {work.series}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-copper-500">
                          <Flame size={16} />
                          <span className="font-bold text-sm">{work.heat}</span>
                        </div>
                      </div>

                      <p className="text-sm text-charcoal/60 mb-3">
                        {work.scale} · {work.material}
                      </p>

                      <p className="text-sm text-charcoal/80 line-clamp-2 mb-4">
                        {work.story}
                      </p>

                      <div className="mb-4">
                        <div className="h-1.5 bg-forest-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full heat-bar"
                            style={{
                              width: `${(work.heat / maxHeat) * 100}%`,
                            }}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm">
                        <button
                          onClick={() => handleLike(work.id)}
                          className="flex items-center gap-1.5 text-charcoal/70 hover:text-copper-500 transition-colors"
                        >
                          <Heart size={18} />
                          <span>{work.likes}</span>
                        </button>
                        <div className="flex items-center gap-1.5 text-charcoal/70">
                          <MessageCircle size={18} />
                          <span>{work.comments.length}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={commentInputs[work.id] || ''}
                          onChange={(e) =>
                            setCommentInputs((prev) => ({
                              ...prev,
                              [work.id]: e.target.value,
                            }))
                          }
                          placeholder="写评论..."
                          className="flex-1 px-3 py-1.5 text-sm border border-forest-200 rounded-lg focus:outline-none focus:border-copper-400 bg-ivory/50"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleComment(work.id);
                            }
                          }}
                        />
                        <button
                          onClick={() => handleComment(work.id)}
                          className="px-3 py-1.5 text-sm bg-copper-500 text-ivory rounded-lg hover:bg-copper-400 transition-colors"
                        >
                          发送
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>

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