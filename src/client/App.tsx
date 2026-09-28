import { createContext, useContext, useEffect, useReducer, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Home from './pages/Home';
import ExhibitionDetail from './pages/ExhibitionDetail';
import ArtistWorkshop from './pages/ArtistWorkshop';
import CreateWork from './pages/CreateWork';
import { AppState, AppAction, Artist, Exhibition } from './types';

const TOKEN_KEY = 'miniature_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...(options.headers || {}),
    ...authHeaders(),
  };
  return fetch(url, { ...options, headers });
}

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppState must be used within AppProvider');
  }
  return context;
}

const initialState: AppState = {
  exhibitions: [],
  works: [],
  artists: [],
  currentUser: null,
  loading: true,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_EXHIBITIONS':
      return { ...state, exhibitions: action.payload };
    case 'SET_WORKS':
      return { ...state, works: action.payload };
    case 'SET_ARTISTS':
      return { ...state, artists: action.payload };
    case 'SET_USER':
      return { ...state, currentUser: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'UPDATE_WORK':
      return {
        ...state,
        works: state.works.map((w) =>
          w.id === action.payload.id ? action.payload : w
        ),
      };
    case 'ADD_WORK':
      return { ...state, works: [...state.works, action.payload] };
    case 'UPDATE_EXHIBITION':
      return {
        ...state,
        exhibitions: state.exhibitions.map((ex) =>
          ex.id === action.payload.id ? action.payload : ex
        ),
      };
    default:
      return state;
  }
}

function Navbar() {
  const { state } = useAppState();
  const user = state.currentUser;

  return (
    <nav className="bg-forest-800 text-ivory px-6 py-4 flex items-center justify-between shadow-lg">
      <Link to="/home" className="flex items-center gap-2">
        <span className="font-display text-2xl font-bold tracking-wide">
          微缩策展
        </span>
      </Link>
      <div className="flex items-center gap-8">
        <Link
          to="/home"
          className="text-ivory/90 hover:text-ivory transition-colors font-medium"
        >
          首页
        </Link>
        {user && (
          <Link
            to={`/artist/${user?.id}`}
            className="text-ivory/90 hover:text-ivory transition-colors font-medium"
          >
            工作室
          </Link>
        )}
        <Link
          to="/create"
          className="text-ivory/90 hover:text-ivory transition-colors font-medium"
        >
          发布作品
        </Link>
      </div>
      {user && (
        <div className="flex items-center gap-3">
          <img
            src={user?.avatar}
            alt={user?.name}
            className="w-9 h-9 rounded-full object-cover border-2 border-copper-400"
          />
          <span className="font-medium">{user?.name}</span>
        </div>
      )}
    </nav>
  );
}

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <Routes location={location}>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<Home />} />
          <Route path="/exhibition/:id" element={<ExhibitionDetail />} />
          <Route path="/artist/:id" element={<ArtistWorkshop />} />
          <Route path="/create" element={<CreateWork />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  useEffect(() => {
    const fetchData = async () => {
      try {
        let token = getToken();

        if (!token) {
          const loginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'a1' }),
          });
          const loginData = await loginRes.json();
          if (loginData.token) {
            setToken(loginData.token);
            token = loginData.token;
          }
        }

        const meRes = await authFetch('/api/auth/me');
        if (meRes.ok) {
          const userData: Artist = await meRes.json();
          dispatch({ type: 'SET_USER', payload: userData });
        }

        const [exhibitionsRes, artistsRes] = await Promise.all([
          authFetch('/api/exhibitions'),
          authFetch('/api/artists'),
        ]);
        const exhibitions: Exhibition[] = await exhibitionsRes.json();
        const artists: Artist[] = await artistsRes.json();

        dispatch({ type: 'SET_EXHIBITIONS', payload: exhibitions });
        dispatch({ type: 'SET_ARTISTS', payload: artists });
      } catch (err) {
        console.error('Failed to fetch initial data:', err);
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    fetchData();
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <div className="min-h-screen bg-ivory flex flex-col">
          <Navbar />
          <main className="flex-1">
            <AnimatedRoutes />
          </main>
        </div>
      </AppProvider>
    </BrowserRouter>
  );
}
