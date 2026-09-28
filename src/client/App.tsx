import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, ReactNode } from 'react';
import Sidebar from './components/Layout/Sidebar';
import NotificationCenter from './components/Layout/NotificationCenter';
import Home from './components/Home';
import PlayDetail from './components/PlayDetail';
import ScheduleView from './components/ScheduleView';
import Login from './components/Login';
import PlayEditor from './components/PlayEditor';
import MyPlays from './components/MyPlays';
import MyApplications from './components/MyApplications';
import NotificationsPage from './components/NotificationsPage';
import { useStore, initWSListeners } from './store/useStore';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

function RequireAuth({ children, role }: { children: ReactNode; role?: 'actor' | 'director' }) {
  const user = useStore((s) => s.user);
  const location = useLocation();
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (role && user.role !== role) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function RequireGuest({ children }: { children: ReactNode }) {
  const user = useStore((s) => s.user);
  if (user) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function Toast() {
  const toast = useStore((s) => s.toast);
  const clearToast = useStore((s) => s.clearToast);
  if (!toast) return null;

  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
    error: <AlertCircle className="w-5 h-5 text-red-400" />,
    info: <Info className="w-5 h-5 text-gold-400" />,
  };
  const colors = {
    success: 'border-emerald-500/30 bg-emerald-500/10',
    error: 'border-red-500/30 bg-red-500/10',
    info: 'border-gold-500/30 bg-gold-500/10',
  };

  return (
    <div className="fixed top-4 right-4 z-[100] slide-in-right">
      <div className={`card !p-3 flex items-center gap-3 min-w-[280px] max-w-sm border ${colors[toast.type]}`}>
        {icons[toast.type]}
        <p className="text-sm text-theater-text flex-1">{toast.message}</p>
        <button
          onClick={clearToast}
          className="text-theater-textMuted hover:text-theater-text transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const user = useStore((s) => s.user);
  return (
    <div className="min-h-screen bg-theater-bg text-theater-text flex">
      {user && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        {user && (
          <header className="h-16 border-b border-theater-border/60 bg-theater-card/80 backdrop-blur-sm sticky top-0 z-40 flex items-center justify-end px-4 md:px-6 gap-4">
            <div className="flex items-center gap-2 text-sm text-theater-textDim">
              <span className="hidden sm:inline">欢迎回来，</span>
              <span className="text-gold-400 font-medium">{user.name}</span>
            </div>
            <NotificationCenter />
          </header>
        )}
        <main className={`flex-1 ${user ? 'p-4 md:p-6 lg:p-8' : ''}`}>
          <div className={user ? 'max-w-7xl mx-auto' : ''}>{children}</div>
        </main>
      </div>
      <Toast />
    </div>
  );
}

export default function App() {
  const fetchMe = useStore((s) => s.fetchMe);
  const user = useStore((s) => s.user);

  useEffect(() => {
    let inited = false;
    if (!inited) {
      inited = true;
      initWSListeners();
      fetchMe();
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, [fetchMe]);

  return (
    <Router>
      <Layout>
        <Routes>
          <Route
            path="/login"
            element={
              <RequireGuest>
                <Login />
              </RequireGuest>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          <Route
            path="/plays/:id"
            element={
              <RequireAuth>
                <PlayDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/plays/new"
            element={
              <RequireAuth role="director">
                <PlayEditor />
              </RequireAuth>
            }
          />
          <Route
            path="/plays/:id/edit"
            element={
              <RequireAuth role="director">
                <PlayEditor />
              </RequireAuth>
            }
          />
          <Route
            path="/my/plays"
            element={
              <RequireAuth role="director">
                <MyPlays />
              </RequireAuth>
            }
          />
          <Route
            path="/my/applications"
            element={
              <RequireAuth role="actor">
                <MyApplications />
              </RequireAuth>
            }
          />
          <Route
            path="/schedule"
            element={
              <RequireAuth>
                <ScheduleView />
              </RequireAuth>
            }
          />
          <Route
            path="/notifications"
            element={
              <RequireAuth>
                <NotificationsPage />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
        </Routes>
      </Layout>
    </Router>
  );
}
