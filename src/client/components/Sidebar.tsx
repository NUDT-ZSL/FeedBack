import {
  Briefcase,
  BookOpen,
  Home,
  ListTodo,
  Trophy,
  Download,
  Upload,
  Menu,
  X
} from 'lucide-react'
import type { Category } from '../types'
import { CATEGORY_LABELS } from '../types'

interface SidebarProps {
  selectedCategory: Category | 'all'
  onCategoryChange: (category: Category | 'all') => void
  todayTaskCount: number
  streakDays: number
  onExport: () => void
  onImport: () => void
  isMobileOpen: boolean
  onMobileClose: () => void
}

const categoryIcons = {
  all: ListTodo,
  work: Briefcase,
  study: BookOpen,
  life: Home
}

export default function Sidebar({
  selectedCategory,
  onCategoryChange,
  todayTaskCount,
  streakDays,
  onExport,
  onImport,
  isMobileOpen,
  onMobileClose
}: SidebarProps) {
  const categories: (Category | 'all')[] = ['all', 'work', 'study', 'life']

  return (
    <>
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 w-64 bg-slate-800 text-white 
          flex flex-col transition-transform duration-300 ease-in-out
          md:translate-x-0 ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-6 flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
              <ListTodo size={22} />
            </div>
            <h1 className="text-xl font-bold">Tracker</h1>
          </div>
          <button
            onClick={onMobileClose}
            className="md:hidden p-1 hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="bg-slate-700/50 rounded-xl p-4">
            <div className="text-slate-400 text-sm mb-1">今日待办</div>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold text-white">{todayTaskCount}</span>
              <span className="text-slate-400 text-sm mb-1">项任务</span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Trophy size={18} className="text-yellow-200" />
              <span className="text-amber-100 text-sm">连续打卡</span>
            </div>
            <div className="flex items-end gap-2">
              <span className="text-3xl font-bold text-white">{streakDays}</span>
              <span className="text-amber-100 text-sm mb-1">天</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-3 px-3">
            任务分类
          </p>
          <ul className="space-y-1">
            {categories.map(cat => {
              const Icon = categoryIcons[cat]
              return (
                <li key={cat}>
                  <button
                    onClick={() => {
                      onCategoryChange(cat)
                      onMobileClose()
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg 
                      transition-all duration-300
                      ${selectedCategory === cat
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30'
                        : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
                      }`}
                  >
                    <Icon size={18} />
                    <span className="font-medium">
                      {cat === 'all' ? '全部任务' : CATEGORY_LABELS[cat as Category]}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-slate-700">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-3 px-3">
            数据管理
          </p>
          <div className="space-y-1">
            <button
              onClick={onExport}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg 
                text-slate-300 hover:bg-slate-700/50 hover:text-white 
                transition-all duration-300"
            >
              <Download size={18} />
              <span className="font-medium">导出数据</span>
            </button>
            <button
              onClick={onImport}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg 
                text-slate-300 hover:bg-slate-700/50 hover:text-white 
                transition-all duration-300"
            >
              <Upload size={18} />
              <span className="font-medium">导入数据</span>
            </button>
          </div>
        </div>
      </aside>

    </>
  )
}
