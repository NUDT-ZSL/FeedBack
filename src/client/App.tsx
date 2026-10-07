import React, { Component, Suspense, lazy, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const Gallery = lazy(() => import('./pages/Gallery'));
const CreateMaze = lazy(() => import('./pages/CreateMaze'));
const MazeDetail = lazy(() => import('./pages/MazeDetail'));
const PlayMaze = lazy(() => import('./pages/PlayMaze'));

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1a2e] to-[#16213e] text-white">
          <div className="text-center p-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="text-6xl mb-4"
            >
              ⚠️
            </motion.div>
            <h1 className="text-3xl font-bold mb-2">出错了</h1>
            <p className="text-gray-400 mb-6">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:opacity-90 transition-opacity"
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const LoadingSpinner: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1a1a2e] to-[#16213e]">
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full"
    />
  </div>
);

const useAuth = () => {
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  
  React.useEffect(() => {
    const token = localStorage.getItem('auth_token');
    setIsAuthenticated(!!token);
  }, []);

  return { isAuthenticated };
};

const ProtectedRoute: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  
  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const Logo: React.FC = () => (
  <motion.svg
    width="40"
    height="40"
    viewBox="0 0 100 100"
    animate={{ rotate: 360 }}
    transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
    style={{ filter: 'drop-shadow(0 0 10px rgba(147, 51, 234, 0.8))' }}
  >
    <defs>
      <radialGradient id="compassGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#a855f7" />
        <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="48" fill="none" stroke="#9333ea" strokeWidth="2" />
    <circle cx="50" cy="50" r="40" fill="url(#compassGlow)" opacity="0.3" />
    <polygon points="50,15 55,50 50,55 45,50" fill="#ef4444" />
    <polygon points="50,85 55,50 50,45 45,50" fill="#6b7280" />
    <polygon points="15,50 50,45 55,50 50,55" fill="#6b7280" />
    <polygon points="85,50 50,45 45,50 50,55" fill="#6b7280" />
    <circle cx="50" cy="50" r="8" fill="#1a1a2e" stroke="#9333ea" strokeWidth="2" />
  </motion.svg>
);

const Navbar: React.FC = () => {
  const { isAuthenticated } = useAuth();

  return (
    <motion.nav
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md"
      style={{ backgroundColor: 'rgba(26, 26, 46, 0.8)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-3">
            <Logo />
            <span className="text-xl font-bold text-white">迷宫探险</span>
          </Link>
          
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="text-gray-300 hover:text-white transition-colors px-3 py-2"
            >
              画廊
            </Link>
            {isAuthenticated ? (
              <Link
                to="/create"
                className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                创建迷宫
              </Link>
            ) : (
              <div className="flex items-center gap-2">
                <button className="px-4 py-2 text-gray-300 hover:text-white transition-colors">
                  登录
                </button>
                <button className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:opacity-90 transition-opacity">
                  注册
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.nav>
  );
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="min-h-screen bg-gradient-to-br from-[#1a1a2e] to-[#16213e]">
          <Navbar />
          <main className="pt-16">
            <Suspense fallback={<LoadingSpinner />}>
              <AnimatePresence mode="wait">
                <Routes>
                  <Route path="/" element={<Gallery />} />
                  <Route
                    path="/create"
                    element={
                      <ProtectedRoute>
                        <CreateMaze />
                      </ProtectedRoute>
                    }
                  />
                  <Route path="/maze/:id" element={<MazeDetail />} />
                  <Route path="/maze/:id/play" element={<PlayMaze />} />
                </Routes>
              </AnimatePresence>
            </Suspense>
          </main>
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
