import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

interface Maze {
  id: string;
  name: string;
  author: string;
  theme: string;
  challenges: number;
  thumbnail: string;
  themeColor: string;
}

const themeColors: Record<string, string> = {
  dungeon: '#3a2a1a',
  forest: '#2d4a2d',
  ice: '#a8d8ea',
  lava: '#8b2500',
};

const themeNames: Record<string, string> = {
  dungeon: '地牢',
  forest: '森林',
  ice: '冰窟',
  lava: '熔岩',
};

const CACHE_KEY = 'mazes_cache';
const CACHE_EXPIRY = 5 * 60 * 1000;

const Gallery: React.FC = () => {
  const [mazes, setMazes] = useState<Maze[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const fetchMazes = useCallback(async (pageNum: number) => {
    if (loading) return;
    setLoading(true);

    try {
      if (pageNum === 1) {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, timestamp } = JSON.parse(cached);
          if (Date.now() - timestamp < CACHE_EXPIRY) {
            setMazes(data);
            setHasMore(data.length >= 12);
            setLoading(false);
            return;
          }
        }
      }

      const response = await fetch(`/api/mazes?page=${pageNum}&limit=12`);
      const data = await response.json();

      if (pageNum === 1) {
        setMazes(data);
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
      } else {
        setMazes(prev => [...prev, ...data]);
      }
      setHasMore(data.length >= 12);
    } catch (error) {
      console.error('Failed to fetch mazes:', error);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    fetchMazes(1);
  }, []);

  useEffect(() => {
    if (page > 1) {
      fetchMazes(page);
    }
  }, [page, fetchMazes]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          setPage(prev => prev + 1);
        }
      },
      { threshold: 0.1 }
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [hasMore, loading]);

  const handleCardClick = (id: string) => {
    navigate(`/maze/${id}`);
  };

  const cardVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
        delay: i * 0.1,
        ease: 'easeOut',
      },
    }),
  };

  return (
    <div className="min-h-screen py-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <h1 className="text-4xl font-bold text-white mb-4">迷宫画廊</h1>
        <p className="text-gray-400">探索世界各地创作者设计的精彩迷宫</p>
      </motion.div>

      <div className="columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6">
        {mazes.map((maze, index) => (
          <motion.div
            key={maze.id}
            custom={index}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-50px' }}
            variants={cardVariants}
            onClick={() => handleCardClick(maze.id)}
            className="break-inside-avoid cursor-pointer group"
          >
            <div
              className="bg-white/5 backdrop-blur-sm rounded-xl overflow-hidden border-2 transition-all duration-300 hover:scale-105 hover:shadow-2xl"
              style={{ borderColor: themeColors[maze.theme] || '#6b7280' }}
            >
              <div className="relative aspect-[4/3] overflow-hidden">
                <img
                  src={maze.thumbnail}
                  alt={maze.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <div
                  className="absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: themeColors[maze.theme] || '#6b7280' }}
                >
                  {themeNames[maze.theme] || maze.theme}
                </div>
              </div>
              <div className="p-4">
                <h3 className="text-lg font-semibold text-white mb-2 truncate">
                  {maze.name}
                </h3>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">作者: {maze.author}</span>
                  <span className="text-purple-400 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                    </svg>
                    {maze.challenges}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div ref={sentinelRef} className="h-20 flex items-center justify-center mt-8">
        {loading && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full"
          />
        )}
        {!hasMore && mazes.length > 0 && (
          <p className="text-gray-500">已加载全部迷宫</p>
        )}
      </div>
    </div>
  );
};

export default Gallery;
