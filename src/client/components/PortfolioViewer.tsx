import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LazyLoad from 'react-lazyload';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  Flame,
  Send,
} from 'lucide-react';
import { useAppState, authHeaders } from '../App';
import { Work, Comment } from '../types';

interface PortfolioViewerProps {
  workId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function PortfolioViewer({
  workId,
  isOpen,
  onClose,
}: PortfolioViewerProps) {
  const { state, dispatch } = useAppState();
  const [work, setWork] = useState<Work | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [imageDirection, setImageDirection] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [showComments, setShowComments] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [storyExpanded, setStoryExpanded] = useState(false);
  const storyRef = useRef<HTMLParagraphElement>(null);
  const [storyOverflowing, setStoryOverflowing] = useState(false);

  useEffect(() => {
    if (!isOpen || !workId) return;

    const existing = state.works.find((w) => w.id === workId);
    if (existing) {
      setWork(existing);
      setCurrentImageIndex(0);
      setShowComments(false);
      setStoryExpanded(false);
    } else {
      fetch(`/api/works/${workId}`)
        .then((res) => res.json())
        .then((data: Work) => {
          setWork(data);
          dispatch({ type: 'UPDATE_WORK', payload: data });
          setCurrentImageIndex(0);
          setShowComments(false);
          setStoryExpanded(false);
        })
        .catch(console.error);
    }
  }, [workId, isOpen, state.works, dispatch]);

  useEffect(() => {
    if (storyRef.current) {
      setStoryOverflowing(
        storyRef.current.scrollHeight > storyRef.current.clientHeight
      );
    }
  }, [work, storyExpanded]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || !work) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') {
        setImageDirection(-1);
        prevImage();
      }
      if (e.key === 'ArrowRight') {
        setImageDirection(1);
        nextImage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, work]);

  const nextImage = () => {
    if (!work) return;
    setImageDirection(1);
    setCurrentImageIndex((prev) => (prev + 1) % work.images.length);
  };

  const prevImage = () => {
    if (!work) return;
    setImageDirection(-1);
    setCurrentImageIndex(
      (prev) => (prev - 1 + work.images.length) % work.images.length
    );
  };

  const handleLike = async () => {
    if (!work) return;

    const prevLikes = work.likes;
    const prevHeat = work.heat;
    const prevLiked = isLiked;

    setIsLiked(!isLiked);
    const delta = prevLiked ? -1 : 1;
    setWork({ ...work, likes: prevLikes + delta, heat: prevHeat + delta });

    try {
      const res = await fetch(`/api/works/${work.id}/like`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const updated: Work = await res.json();
      setWork(updated);
      dispatch({ type: 'UPDATE_WORK', payload: updated });
    } catch (err) {
      console.error(err);
      setWork({ ...work, likes: prevLikes, heat: prevHeat });
      setIsLiked(prevLiked);
    }
  };

  const handleComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!work || !commentText.trim() || !state.currentUser?.id) return;

    const newComment: Comment = {
      id: `temp-${Date.now()}`,
      userId: state.currentUser.id,
      content: commentText,
      createdAt: new Date().toISOString(),
    };

    const prevComments = work.comments;
    setWork({ ...work, comments: [...work.comments, newComment] });
    setCommentText('');

    try {
      const res = await fetch(`/api/works/${work.id}/comment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({
          userId: state.currentUser?.id,
          content: commentText,
        }),
      });
      const updated: Work = await res.json();
      setWork(updated);
      dispatch({ type: 'UPDATE_WORK', payload: updated });
    } catch (err) {
      console.error(err);
      setWork({ ...work, comments: prevComments });
    }
  };

  const getUserName = (userId: string): string => {
    const artist = state.artists.find((a) => a.id === userId);
    return artist?.name || '未知用户';
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const imageVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 100 : -100,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 100 : -100,
      opacity: 0,
    }),
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && work && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-forest-900/90 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onClick={handleBackdropClick}
        >
          <motion.div
            className="absolute inset-0 flex flex-col"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute top-6 right-6 z-20 p-3 rounded-full bg-forest-900/60 backdrop-blur-md text-ivory hover:bg-forest-900/80 transition-all border border-ivory/10"
            >
              <X size={24} />
            </button>

            <div className="flex-1 relative flex items-center justify-center overflow-hidden">
              <AnimatePresence initial={false} custom={imageDirection} mode="wait">
                <motion.div
                  key={currentImageIndex}
                  custom={imageDirection}
                  variants={imageVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <LazyLoad height={600} offset={200} once>
                    <img
                      src={work.images[currentImageIndex]}
                      alt={`${work.title} - ${currentImageIndex + 1}`}
                      className="w-full h-full object-contain select-none"
                      draggable={false}
                    />
                  </LazyLoad>
                </motion.div>
              </AnimatePresence>

              {work.images.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    className="absolute left-6 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-forest-900/60 backdrop-blur-md text-ivory hover:bg-forest-900/80 transition-all border border-ivory/10"
                  >
                    <ChevronLeft size={28} />
                  </button>
                  <button
                    onClick={nextImage}
                    className="absolute right-6 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-forest-900/60 backdrop-blur-md text-ivory hover:bg-forest-900/80 transition-all border border-ivory/10"
                  >
                    <ChevronRight size={28} />
                  </button>

                  <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-forest-900/60 backdrop-blur-md border border-ivory/10">
                    <span className="text-ivory font-medium text-sm">
                      {currentImageIndex + 1} / {work.images.length}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <div className="absolute inset-x-0 bottom-full h-32 bg-gradient-to-t from-forest-900 via-forest-900/80 to-transparent pointer-events-none" />

              <div className="relative bg-forest-900/95 backdrop-blur-xl border-t border-ivory/10">
                <div className="max-w-4xl mx-auto px-6 py-5">
                  <div className="flex items-start justify-between gap-6 mb-4">
                    <div className="flex-1 min-w-0">
                      <h2 className="font-display text-2xl text-ivory font-bold mb-2">
                        {work.title}
                      </h2>
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span className="px-3 py-1 rounded-full bg-copper-500/20 text-copper-400 text-sm font-medium border border-copper-500/30">
                          {work.series}
                        </span>
                        <span className="px-3 py-1 rounded-full bg-forest-800/60 text-ivory/70 text-sm border border-ivory/10">
                          {work.scale}
                        </span>
                        <span className="px-3 py-1 rounded-full bg-forest-800/60 text-ivory/70 text-sm border border-ivory/10">
                          {work.material}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-copper-500/15 border border-copper-500/20">
                        <Flame size={18} className="text-copper-400" />
                        <span className="text-copper-400 font-bold text-sm">
                          {work.heat}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="relative mb-4">
                    <p
                      ref={storyRef}
                      className={`text-ivory/70 leading-relaxed ${
                        !storyExpanded ? 'line-clamp-3' : ''
                      }`}
                    >
                      {work.story}
                    </p>
                    {storyOverflowing && (
                      <button
                        onClick={() => setStoryExpanded(!storyExpanded)}
                        className="text-copper-400 text-sm font-medium hover:text-copper-300 transition-colors mt-1"
                      >
                        {storyExpanded ? '收起' : '展开更多'}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleLike}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-forest-800/60 hover:bg-forest-800 transition-all border border-ivory/10 hover:border-copper-500/30"
                      >
                        <Heart
                          size={18}
                          className={`transition-colors ${
                            isLiked
                              ? 'text-copper-400 fill-copper-400'
                              : 'text-copper-400'
                          }`}
                        />
                        <span className="text-ivory font-medium text-sm">
                          {work.likes}
                        </span>
                      </button>

                      <button
                        onClick={() => setShowComments(!showComments)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all border ${
                          showComments
                            ? 'bg-copper-500/20 border-copper-500/30'
                            : 'bg-forest-800/60 hover:bg-forest-800 border-ivory/10 hover:border-copper-500/30'
                        }`}
                      >
                        <MessageCircle
                          size={18}
                          className="text-copper-400"
                        />
                        <span className="text-ivory font-medium text-sm">
                          {work.comments.length}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                <AnimatePresence>
                  {showComments && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="overflow-hidden border-t border-ivory/10"
                    >
                      <div className="max-w-4xl mx-auto px-6 py-5">
                        <div className="space-y-3 max-h-48 overflow-y-auto mb-4 pr-2">
                          {work.comments.length === 0 ? (
                            <p className="text-ivory/40 text-center py-4 text-sm">
                              暂无评论，来发表第一条评论吧
                            </p>
                          ) : (
                            work.comments.map((comment: Comment) => (
                              <div
                                key={comment.id}
                                className="flex gap-3"
                              >
                                <div className="w-8 h-8 rounded-full bg-forest-700 flex items-center justify-center flex-shrink-0">
                                  <span className="text-ivory/60 text-xs font-medium">
                                    {getUserName(comment.userId).charAt(0)}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-ivory/90 font-medium text-sm">
                                      {getUserName(comment.userId)}
                                    </span>
                                    <span className="text-ivory/40 text-xs">
                                      {new Date(
                                        comment.createdAt
                                      ).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <p className="text-ivory/70 text-sm leading-relaxed">
                                    {comment.content}
                                  </p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        <form
                          onSubmit={handleComment}
                          className="flex gap-2"
                        >
                          <input
                            type="text"
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            placeholder="写下你的评论..."
                            className="flex-1 px-4 py-2.5 rounded-lg bg-forest-800/60 border border-ivory/10 text-ivory placeholder-ivory/40 text-sm focus:outline-none focus:border-copper-500/50 transition-colors"
                          />
                          <button
                            type="submit"
                            disabled={!commentText.trim()}
                            className="px-4 py-2.5 rounded-lg bg-copper-500 text-ivory font-medium hover:bg-copper-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Send size={18} />
                          </button>
                        </form>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
