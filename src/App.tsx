import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import MapView from '@/components/MapView';
import SpaceDetail from '@/components/SpaceDetail';
import UserProfile from '@/components/UserProfile';
import AdminPanel from '@/components/AdminPanel';
import { Toaster } from 'react-hot-toast';

function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    setTransitioning(true);
    const timer = setTimeout(() => {
      setDisplayChildren(children);
      setTransitioning(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [location]);

  return (
    <div style={{
      opacity: transitioning ? 0 : 1,
      transition: 'opacity 0.3s ease',
    }}>
      {displayChildren}
    </div>
  );
}

function Navigation() {
  const location = useLocation();

  return (
    <nav style={{
      background: '#F5E6CC',
      borderBottom: '2px solid #D4A574',
      padding: '0 24px',
      display: 'flex',
      alignItems: 'center',
      height: 56,
      position: 'sticky',
      top: 0,
      zIndex: 100,
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <div style={{
        fontWeight: 700,
        fontSize: 18,
        color: '#2E8B57',
        marginRight: 32,
        letterSpacing: 1,
      }}>
        🏘 社区空间
      </div>
      {[
        { path: '/', label: '社区地图' },
        { path: '/profile', label: '个人中心' },
        { path: '/admin', label: '管理面板' },
      ].map((item) => (
        <a
          key={item.path}
          href={item.path}
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState(null, '', item.path);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: location.pathname === item.path ? 600 : 400,
            color: location.pathname === item.path ? '#2E8B57' : '#666',
            background: location.pathname === item.path ? 'rgba(46,139,87,0.1)' : 'transparent',
            textDecoration: 'none',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => {
            if (location.pathname !== item.path) {
              e.currentTarget.style.background = 'rgba(46,139,87,0.06)';
            }
          }}
          onMouseLeave={(e) => {
            if (location.pathname !== item.path) {
              e.currentTarget.style.background = 'transparent';
            }
          }}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export default function App() {
  return (
    <Router>
      <Toaster
        position="bottom_center"
        toastOptions={{
          duration: 3000,
          style: {
            background: '#2E8B57',
            color: '#fff',
            borderRadius: 12,
            padding: '12px 24px',
            fontWeight: 600,
          },
        }}
      />
      <Navigation />
      <PageTransition>
        <Routes>
          <Route path="/" element={<MapView />} />
          <Route path="/space/:id" element={<SpaceDetail />} />
          <Route path="/profile" element={<UserProfile />} />
          <Route path="/admin" element={<AdminPanel />} />
        </Routes>
      </PageTransition>
    </Router>
  );
}
