import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppProvider, useAuth } from './store/AppContext';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import KitchenPage from './pages/KitchenPage';
import RecipeDetail from './pages/RecipeDetail';
import CreateRecipePage from './pages/CreateRecipePage';
import FeedPage from './pages/FeedPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function AppContent() {
  const location = useLocation();
  const showNavbar = location.pathname !== '/login';

  return (
    <div className="min-h-screen bg-cream-50">
      {showNavbar && <Navbar />}
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <KitchenPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/recipe/:id"
          element={
            <ProtectedRoute>
              <RecipeDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/create"
          element={
            <ProtectedRoute>
              <CreateRecipePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/feed"
          element={
            <ProtectedRoute>
              <FeedPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </AppProvider>
  );
}
