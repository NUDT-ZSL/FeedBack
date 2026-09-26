import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Bell, Menu, X, LogOut } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from './store'
import LoginPage from './pages/LoginPage'
import UserProfile from './pages/UserProfile'
import DetailPage from './pages/DetailPage'
import NotificationCenter from './pages/NotificationCenter'

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const colors = ['#FF9A5C', '#7BC47F', '#5C9DFF', '#FF5C8A', '#B47CFF', '#FFD25C', '#5CD1FF', '#FF7C5C']
  return colors[Math.abs(hash) % colors.length]
}

export { getAvatarColor }

function Navbar() {
  const { currentUser, logout, notifications } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  const unreadCount = notifications.filter((n) => !n.read).length

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  if (!currentUser) return null

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 glass-card !rounded-none !border-t-0 !border-x-0">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div
            className="font-display font-bold text-xl cursor-pointer select-none"
            onClick={() => navigate(`/profile/${currentUser.id}`)}
          >
            🐾 宠物共享
          </div>

          <div className="hidden md:flex items-center gap-4">
            <button
              className="relative p-2 rounded-lg hover:bg-white/40 transition"
              onClick={() => navigate('/notifications')}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center badge-pulse">
                  {unreadCount}
                </span>
              )}
            </button>
            <div
              className="avatar-circle w-8 h-8 text-sm cursor-pointer"
              style={{ backgroundColor: getAvatarColor(currentUser.username) }}
              onClick={() => navigate(`/profile/${currentUser.id}`)}
            >
              {currentUser.username[0].toUpperCase()}
            </div>
            <button
              className="p-2 rounded-lg hover:bg-white/40 transition text-gray-600"
              onClick={() => { logout(); navigate('/login') }}
            >
              <LogOut size={18} />
            </button>
          </div>

          <button
            className="md:hidden p-2 rounded-lg hover:bg-white/40 transition"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={22} />
          </button>
        </div>
      </nav>

      <div
        className={clsx('hamburger-overlay fixed inset-0 z-50 bg-black/30', menuOpen && 'open')}
        onClick={() => setMenuOpen(false)}
      />

      <div
        className={clsx(
          'hamburger-menu fixed top-0 left-0 bottom-0 w-64 z-50 bg-white shadow-xl p-6',
          menuOpen && 'open'
        )}
      >
        <div className="flex items-center justify-between mb-8">
          <span className="font-display font-bold text-lg">🐾 宠物共享</span>
          <button onClick={() => setMenuOpen(false)}>
            <X size={22} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <button
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-cream transition text-left"
            onClick={() => navigate(`/profile/${currentUser.id}`)}
          >
            <div
              className="avatar-circle w-10 h-10 text-base"
              style={{ backgroundColor: getAvatarColor(currentUser.username) }}
            >
              {currentUser.username[0].toUpperCase()}
            </div>
            <span className="font-medium">{currentUser.username}</span>
          </button>
          <button
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-cream transition text-left relative"
            onClick={() => navigate('/notifications')}
          >
            <Bell size={20} />
            <span>通知中心</span>
            {unreadCount > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center badge-pulse">
                {unreadCount}
              </span>
            )}
          </button>
          <button
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-red-50 text-red-500 transition text-left"
            onClick={() => { logout(); navigate('/login') }}
          >
            <LogOut size={20} />
            <span>退出登录</span>
          </button>
        </div>
      </div>
    </>
  )
}

export default function App() {
  const { currentUser } = useStore()

  return (
    <BrowserRouter>
      <Navbar />
      <div className={clsx(currentUser && 'pt-14')}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/profile/:userId" element={<UserProfile />} />
          <Route path="/detail/:type/:id" element={<DetailPage />} />
          <Route path="/notifications" element={<NotificationCenter />} />
          <Route
            path="/"
            element={
              currentUser
                ? <Navigate to={`/profile/${currentUser.id}`} replace />
                : <Navigate to="/login" replace />
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
