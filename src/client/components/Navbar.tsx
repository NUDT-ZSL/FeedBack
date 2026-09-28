import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

interface NavbarProps {
  user: any;
  onLogout: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ user, onLogout, isOpen, onToggle }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    onLogout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <>
      <button className="hamburger-btn" onClick={onToggle}>
        ☰
      </button>
      <nav className={`navbar ${isOpen ? 'open' : ''}`}>
        <div className="navbar-header">
          <h1>志愿服务平台</h1>
        </div>
        <ul className="navbar-links">
          <li>
            <Link to="/" className={isActive('/') ? 'active' : ''} onClick={onToggle}>
              🏠 首页
            </Link>
          </li>
          <li>
            <Link to="/projects" className={isActive('/projects') ? 'active' : ''} onClick={onToggle}>
              📋 项目浏览
            </Link>
          </li>
          {user && (
            <li>
              <Link to="/dashboard" className={isActive('/dashboard') ? 'active' : ''} onClick={onToggle}>
                👤 个人中心
              </Link>
            </li>
          )}
          {user?.role === 'admin' && (
            <li>
              <Link to="/admin" className={isActive('/admin') ? 'active' : ''} onClick={onToggle}>
                ⚙️ 后台管理
              </Link>
            </li>
          )}
        </ul>
        <div className="navbar-user">
          {user ? (
            <>
              <div className="navbar-user-info">
                <div className="navbar-user-avatar">
                  {user.nickname?.charAt(0) || 'U'}
                  {user.totalHours >= 50 && <span className="badge-icon">⭐</span>}
                </div>
                <span className="navbar-user-name">{user.nickname}</span>
              </div>
              <button className="logout-btn" onClick={handleLogout}>
                退出登录
              </button>
            </>
          ) : (
            <div>
              <Link to="/login" style={{ color: 'white', textDecoration: 'none' }}>登录</Link>
              {' / '}
              <Link to="/register" style={{ color: 'white', textDecoration: 'none' }}>注册</Link>
            </div>
          )}
        </div>
      </nav>
    </>
  );
};

export default Navbar;
