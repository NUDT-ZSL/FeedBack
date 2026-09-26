import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { PawPrint, BookOpen, Users, X } from 'lucide-react';
import PetProfile from './pages/PetProfile';
import DiaryList from './pages/DiaryList';
import Community from './pages/Community';
import PetDetail from './pages/PetDetail';
import { useApp } from './context/AppContext';

function App() {
  const location = useLocation();
  const { state, clearError } = useApp();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

  const tabs = [
    { path: '/', label: '我的宠物', icon: PawPrint },
    { path: '/diary', label: '寄养日记', icon: BookOpen },
    { path: '/community', label: '社区广场', icon: Users }
  ];

  useEffect(() => {
    const activeIndex = tabs.findIndex(tab => {
      if (tab.path === '/') {
        return location.pathname === '/' || location.pathname.startsWith('/pets/');
      }
      return location.pathname === tab.path;
    });

    if (activeIndex >= 0 && tabRefs.current[activeIndex]) {
      const activeTab = tabRefs.current[activeIndex]!;
      setIndicatorStyle({
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth
      });
    }
  }, [location.pathname]);

  const isDetailPage = location.pathname.startsWith('/pets/') && location.pathname !== '/';

  return (
    <div style={styles.appContainer}>
      <header style={styles.header}>
        {!isDetailPage && (
          <div style={styles.logoSection}>
            <PawPrint size={28} color="#6B4226" style={{ marginRight: 10 }} />
            <h1 style={styles.logoText}>宠物寄养日记</h1>
          </div>
        )}
        
        {!isDetailPage && (
          <nav style={styles.nav}>
            <div style={styles.tabsContainer}>
              {tabs.map((tab, index) => {
                const Icon = tab.icon;
                const isActive = tab.path === '/' 
                  ? location.pathname === '/' || location.pathname.startsWith('/pets/')
                  : location.pathname === tab.path;
                return (
                  <NavLink
                    key={tab.path}
                    to={tab.path}
                    style={{ textDecoration: 'none' }}
                  >
                    <button
                      ref={el => tabRefs.current[index] = el}
                      style={{
                        ...styles.tabButton,
                        color: isActive ? '#E67E22' : '#8D8D8D'
                      }}
                    >
                      <Icon size={18} style={{ marginRight: 6 }} />
                      {tab.label}
                    </button>
                  </NavLink>
                );
              })}
              <div style={{
                ...styles.tabIndicator,
                ...indicatorStyle,
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
              }} />
            </div>
          </nav>
        )}
      </header>

      <main style={styles.main}>
        <Routes>
          <Route path="/" element={<PetProfile />} />
          <Route path="/pets/:id" element={<PetDetail />} />
          <Route path="/diary" element={<DiaryList />} />
          <Route path="/community" element={<Community />} />
        </Routes>
      </main>

      {state.error && (
        <div style={styles.errorToast} className="animate-slide-up">
          <span style={styles.errorText}>{state.error}</span>
          <button onClick={clearError} style={styles.errorClose}>
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  appContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    backgroundColor: 'rgba(255, 252, 247, 0.95)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(107, 66, 38, 0.1)',
    padding: '0 32px',
    position: 'sticky',
    top: 0,
    zIndex: 100
  },
  logoSection: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px 0'
  },
  logoText: {
    fontSize: 24,
    fontWeight: 600,
    color: '#6B4226',
    margin: 0
  },
  nav: {
    display: 'flex',
    justifyContent: 'center',
    paddingBottom: 8
  },
  tabsContainer: {
    display: 'flex',
    position: 'relative',
    gap: 8
  },
  tabButton: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 28px',
    fontSize: 16,
    fontWeight: 500,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    transition: 'color 0.2s ease',
    fontFamily: 'Georgia, serif'
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    backgroundColor: '#E67E22',
    borderRadius: '3px 3px 0 0'
  },
  main: {
    flex: 1,
    padding: '32px',
    maxWidth: '1400px',
    width: '100%',
    margin: '0 auto'
  },
  errorToast: {
    position: 'fixed',
    bottom: 32,
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#E74C3C',
    color: 'white',
    padding: '14px 24px',
    borderRadius: 12,
    boxShadow: '0 8px 24px rgba(231, 76, 60, 0.3)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    zIndex: 1000
  },
  errorText: {
    fontSize: 15
  },
  errorClose: {
    background: 'none',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    padding: 4,
    borderRadius: 6,
    transition: 'background-color 0.2s ease'
  }
};

export default App;
