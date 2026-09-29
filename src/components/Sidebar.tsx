import { NavLink } from 'react-router-dom'
import { Home, Upload, BarChart3, Music, User, Menu, X } from 'lucide-react'
import { useState } from 'react'

const navItems = [
  { path: '/', label: '发现音乐', icon: Home },
  { path: '/upload', label: '上传作品', icon: Upload },
  { path: '/dashboard', label: '数据中心', icon: BarChart3 },
]

export default function Sidebar() {
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  return (
    <>
      <button
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-lg bg-white/10 backdrop-blur-md"
        onClick={() => setIsMobileOpen(!isMobileOpen)}
      >
        {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <aside
        className={`fixed left-0 top-0 h-full w-60 bg-black/30 backdrop-blur-xl border-r border-white/10 z-40 transition-transform duration-300 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center">
                <Music size={20} />
              </div>
              <span className="text-lg font-bold bg-gradient-to-r from-pink-400 to-purple-400 bg-clip-text text-transparent">
                Melody Hub
              </span>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-2">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 ${
                    isActive
                      ? 'bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-white border border-pink-500/30'
                      : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                <item.icon size={18} />
                <span className="text-sm font-medium">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="p-4 border-t border-white/10">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
                <User size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">夜行者乐队</p>
                <p className="text-xs text-white/50">音乐人</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
    </>
  )
}
