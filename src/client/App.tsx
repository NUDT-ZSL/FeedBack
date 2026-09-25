import { useState } from 'react';
import { useAuth, User } from './hooks/useAuth';
import Login from './components/Login';
import Register from './components/Register';
import Dashboard from './components/Dashboard';
import Courses from './components/Courses';
import Schedule from './components/Schedule';
import Checkin from './components/Checkin';

// 主应用组件
// 数据流向：根据路由渲染不同页面，从useAuth获取token传递给各子组件
// 调用关系：App -> useAuth -> [Login, Register, Dashboard, Courses, Schedule, Checkin] -> fetch -> 后端API
export default function App() {
  const { token, user, loading, login, logout, updateUser } = useAuth();
  const [currentRoute, setCurrentRoute] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // 加载状态
  if (loading) {
    return <div className="loading">加载中...</div>;
  }

  // 未登录时显示登录或注册页面
  if (!token) {
    if (currentRoute === 'register') {
      return (
        <Register
          onRegister={(token, user) => {
            login(token, user);
            setCurrentRoute('dashboard');
          }}
          onSwitchToLogin={() => setCurrentRoute('login')}
        />
      );
    }
    return (
      <Login
        onLogin={(token, user) => {
          login(token, user);
          setCurrentRoute('dashboard');
        }}
        onSwitchToRegister={() => setCurrentRoute('register')}
      />
    );
  }

  // 导航菜单配置
  // 数据流向：点击导航项 -> setCurrentRoute -> renderContent根据路由渲染对应组件
  const navItems = [
    { id: 'personal', label: '个人中心', icon: '👤' },
    { id: 'courses', label: '课程', icon: '📅' },
    { id: 'mybookings', label: '我的预约', icon: '📋' },
    { id: 'checkin', label: '签到', icon: '✅' },
    { id: 'schedule', label: '排班管理', icon: '⚙️' },
  ];

  // 路由渲染
  // 数据流向：currentRoute状态变化 -> switch匹配 -> 返回对应组件
  // 各组件从props接收token/user -> fetch调用后端API -> 展示数据
  const renderContent = () => {
    switch (currentRoute) {
      case 'login':
      case 'register':
        // 登录/注册后自动跳转到个人中心
        return <Dashboard user={user!} token={token} updateUser={updateUser} />;
      case 'personal':
        // 个人中心路由 - 导航栏"个人中心"链接映射到此
        // 数据流向：Dashboard -> fetch(/api/bookings) -> 获取预约列表 -> 展示
        //           -> 点击生成二维码 -> fetch(/api/qrcode) -> 返回Base64 -> 模态框展示
        return <Dashboard user={user!} token={token} updateUser={updateUser} />;
      case 'dashboard':
      case 'mybookings':
        // 仪表盘和我的预约都使用Dashboard组件展示
        return <Dashboard user={user!} token={token} updateUser={updateUser} />;
      case 'courses':
        // 课程列表路由 - 数据流向：Courses -> fetch(/api/courses) -> 展示课程卡片 -> 预约 -> fetch(POST /api/bookings)
        return <Courses token={token} user={user!} updateUser={updateUser} />;
      case 'schedule':
        // 排班管理路由 - 数据流向：Schedule -> fetch(/api/coaches, /api/courses/admin) -> 增删改操作
        return <Schedule token={token} />;
      case 'checkin':
        // 签到路由 - 数据流向：Checkin -> fetch(POST /api/checkin) -> 校验二维码 -> 更新状态
        return <Checkin token={token} />;
      default:
        return <Dashboard user={user!} token={token} updateUser={updateUser} />;
    }
  };

  return (
    <div className="app">
      {/* 顶部导航栏 */}
      <nav className="navbar">
        <div className="nav-container">
          <div className="logo">🏋️ GYM PRO</div>

          {/* 桌面端导航 */}
          <div className="nav-links">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`nav-link ${currentRoute === item.id ? 'active' : ''}`}
                onClick={() => {
                  setCurrentRoute(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>

          <div className="nav-right">
            <span className="user-info">
              {user?.level === 'vip' ? '⭐ VIP' : '👤'} {user?.name}
            </span>
            <button className="logout-btn" onClick={logout}>
              退出
            </button>

            {/* 移动端汉堡菜单 */}
            <button
              className="hamburger"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {/* 移动端下拉菜单 */}
        {mobileMenuOpen && (
          <div className="mobile-menu">
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`mobile-nav-link ${currentRoute === item.id ? 'active' : ''}`}
                onClick={() => {
                  setCurrentRoute(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* 主内容区域 */}
      <main className="main-content">{renderContent()}</main>
    </div>
  );
}
