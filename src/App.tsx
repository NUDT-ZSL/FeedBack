import { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate, NavLink } from 'react-router-dom'
import type { Teacher, UserRole } from './types'
import { api } from './services/api'
import ScheduleView from './components/ScheduleView'
import TeacherDashboard from './components/TeacherDashboard'
import PracticeFeedback from './components/PracticeFeedback'
import {
  CalendarClock,
  LayoutDashboard,
  MessageSquareHeart,
  Music,
  Home
} from 'lucide-react'

const STUDENT_NAV = [
  { path: '/', label: '课程预约', icon: CalendarClock },
  { path: '/feedback', label: '练习反馈', icon: MessageSquareHeart }
]

const TEACHER_NAV = [
  { path: '/teacher', label: '今日课表', icon: LayoutDashboard }
]

const MOBILE_TABS = [
  { path: '/', label: '排期', icon: CalendarClock, role: 'student' as UserRole },
  { path: '/feedback', label: '反馈', icon: MessageSquareHeart, role: 'student' as UserRole },
  { path: '/teacher', label: '课表', icon: LayoutDashboard, role: 'teacher' as UserRole },
  { path: '/', label: '首页', icon: Home, role: 'student' as UserRole, fallback: true },
  { path: '/feedback', label: '反馈', icon: Music, role: 'student' as UserRole, fallback2: true }
]

export default function App() {
  const [role, setRole] = useState<UserRole>('student')
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    api.getTeachers().then((t) => {
      setTeachers(t)
    })
  }, [])

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole)
    setSelectedTeacherId(null)
    if (newRole === 'teacher') {
      const firstTeacher = teachers[0]
      if (firstTeacher) setSelectedTeacherId(firstTeacher.id)
      navigate('/teacher')
    } else {
      navigate('/')
    }
  }

  const navItems = role === 'student' ? STUDENT_NAV : TEACHER_NAV

  const getMobileActiveTab = () => {
    if (location.pathname === '/') return 0
    if (location.pathname === '/feedback') return 1
    if (location.pathname === '/teacher') return 2
    return 0
  }

  const handleMobileNav = (idx: number) => {
    const tab = MOBILE_TABS[idx]
    if (tab.role === 'teacher' && role !== 'teacher') {
      handleRoleChange('teacher')
    } else if (tab.role === 'student' && role !== 'student') {
      setRole('student')
    }
    navigate(tab.path)
  }

  return (
    <div className="layout">
      {/* 顶部导航栏 */}
      <header className="top-nav">
        <div className="nav-logo">
          <div className="nav-logo-icon">🎵</div>
          <div className="nav-logo-text">乐课通</div>
        </div>
        <div className="role-toggle">
          <button
            className={`role-btn ${role === 'student' ? 'active-student' : ''}`}
            onClick={() => handleRoleChange('student')}
          >
            学生端
          </button>
          <button
            className={`role-btn ${role === 'teacher' ? 'active-teacher' : ''}`}
            onClick={() => handleRoleChange('teacher')}
          >
            老师端
          </button>
        </div>
      </header>

      {/* 左侧侧边栏 */}
      <aside className="sidebar">
        <div className="sidebar-title">功能导航</div>
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            {(() => {
              const Icon = item.icon
              return <Icon size={18} strokeWidth={2} />
            })()}
            {item.label}
          </NavLink>
        ))}

        {role === 'student' && (
          <>
            <div className="sidebar-title">授课老师</div>
            <div
              className={`teacher-card ${selectedTeacherId === null ? 'selected' : ''}`}
              onClick={() => setSelectedTeacherId(null)}
              style={{ border: selectedTeacherId === null ? '2px solid var(--primary-purple)' : '2px solid transparent', background: selectedTeacherId === null ? 'rgba(255,255,255,0.9)' : undefined }}
            >
              <div className="teacher-avatar">👥</div>
              <div className="teacher-info">
                <div className="teacher-info-name">全部老师</div>
                <div className="teacher-info-ins">查看所有老师排期</div>
              </div>
            </div>
            {teachers.map((t) => (
              <div
                key={t.id}
                className={`teacher-card ${selectedTeacherId === t.id ? 'selected' : ''}`}
                onClick={() => setSelectedTeacherId(t.id)}
              >
                <div className="teacher-avatar">{t.avatar}</div>
                <div className="teacher-info">
                  <div className="teacher-info-name">{t.name}老师</div>
                  <div className="teacher-info-ins">{t.instruments.join(' / ')}</div>
                </div>
              </div>
            ))}
          </>
        )}

        {role === 'teacher' && (
          <>
            <div className="sidebar-title">切换老师</div>
            {teachers.map((t) => (
              <div
                key={t.id}
                className={`teacher-card ${selectedTeacherId === t.id ? 'selected' : ''}`}
                onClick={() => setSelectedTeacherId(t.id)}
              >
                <div className="teacher-avatar">{t.avatar}</div>
                <div className="teacher-info">
                  <div className="teacher-info-name">{t.name}老师</div>
                  <div className="teacher-info-ins">{t.instruments.join(' / ')}</div>
                </div>
              </div>
            ))}
          </>
        )}
      </aside>

      {/* 主内容区 */}
      <main className="main-content">
        <Routes>
          <Route
            path="/"
            element={
              role === 'student' ? (
                <ScheduleView
                  selectedTeacherId={selectedTeacherId}
                  teachers={teachers}
                />
              ) : (
                <Navigate to="/teacher" replace />
              )
            }
          />
          <Route
            path="/teacher"
            element={
              selectedTeacherId ? (
                <TeacherDashboard
                  currentTeacherId={selectedTeacherId}
                  teachers={teachers}
                />
              ) : (
                <div className="schedule-wrapper">
                  <div className="empty-state">
                    <div className="empty-state-icon">👨‍🏫</div>
                    <div className="empty-state-text">请在左侧选择一位老师查看课表</div>
                  </div>
                </div>
              )
            }
          />
          <Route path="/feedback" element={<PracticeFeedback />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* 移动端底部 Tab 栏 */}
      <nav className="mobile-tabbar">
        <div className="mobile-tabbar-inner">
          {MOBILE_TABS.slice(0, 5).map((tab, idx) => {
            const Icon = tab.icon
            const active = getMobileActiveTab() === idx
            return (
              <div
                key={idx}
                className={`mobile-tab-item ${active ? 'active' : ''}`}
                onClick={() => handleMobileNav(idx)}
              >
                <div className="mobile-tab-item-icon">
                  <Icon size={22} strokeWidth={2} />
                </div>
                <div>{tab.label}</div>
              </div>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
