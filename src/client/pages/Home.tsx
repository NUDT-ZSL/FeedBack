import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import LazyLoad from 'react-lazyload';
import { Calendar, Sparkles } from 'lucide-react';
import { useAppState } from '../App';
import { Exhibition, Artist } from '../types';

export default function Home() {
  const { state } = useAppState();

  return (
    <div className="min-h-screen bg-ivory">
      <header className="bg-forest-800 text-ivory py-6 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">微缩景观策展平台</h1>
          <nav className="flex gap-4">
            <Link to="/home" className="hover:text-copper-400 transition-colors">
              首页
            </Link>
            <Link to="/create" className="hover:text-copper-400 transition-colors">
              发布作品
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <section className="mb-10">
          <h2 className="font-display text-xl font-bold mb-4 text-charcoal">策展人</h2>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {state.artists
              .filter((a: Artist) => a.role === 'curator')
              .map((curator: Artist) => (
                <Link
                  key={curator.id}
                  to={`/artist/${curator.id}`}
                  className="flex flex-col items-center min-w-[80px]"
                >
                  <img
                    src={curator.avatar}
                    alt={curator.name}
                    className="w-16 h-16 rounded-full border-2 border-copper-400"
                  />
                  <span className="text-sm mt-2 text-charcoal">{curator.name}</span>
                </Link>
              ))}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-copper-500" />
            <h2 className="font-display text-xl font-bold text-charcoal">展览</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {state.exhibitions.map((ex: Exhibition, index: number) => (
              <motion.div
                key={ex.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Link to={`/exhibition/${ex.id}`} className="block">
                  <div className="bg-white rounded-xl overflow-hidden shadow-md card-hover">
                    <div className="overflow-hidden">
                      <LazyLoad height={200} once>
                        <motion.div
                          whileHover={{ scale: 1.08 }}
                          transition={{ duration: 0.4 }}
                        >
                          <img
                            src={ex.coverImage}
                            alt={ex.title}
                            className="w-full h-48 object-cover"
                          />
                        </motion.div>
                      </LazyLoad>
                    </div>
                    <div className="p-4">
                      <h3 className="font-display text-lg font-bold text-charcoal mb-1">
                        {ex.title}
                      </h3>
                      <div className="flex items-center gap-2 text-sm text-charcoal/60">
                        <Calendar size={14} />
                        <span>{ex.workCount || ex.workIds?.length || 0} 件作品</span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
