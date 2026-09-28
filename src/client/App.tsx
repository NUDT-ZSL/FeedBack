import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Notification from './components/Notification';
import LineupPage from './pages/LineupPage';
import ApplyForm from './pages/ApplyForm';
import AdminPanel from './pages/AdminPanel';
import ScheduleManager from './pages/ScheduleManager';
import { useStore } from './store/useStore';
import { useEffect, useState } from 'react';

function App() {
  const { isAdmin, setIsAdmin } = useStore();
  const [showLogin, setShowLogin] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    const adminStatus = localStorage.getItem('festival_admin');
    if (adminStatus === 'true') {
      setIsAdmin(true);
    }
  }, [setIsAdmin]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginForm.username === 'admin' && loginForm.password === 'admin123') {
      setIsAdmin(true);
      localStorage.setItem('festival_admin', 'true');
      setShowLogin(false);
      setLoginError('');
    } else {
      setLoginError('用户名或密码错误');
    }
  };

  const handleLogout = () => {
    setIsAdmin(false);
    localStorage.removeItem('festival_admin');
  };

  return (
    <Router>
      <div className="app-container">
        <Navbar isAdmin={isAdmin} />
        <Notification />

        <Routes>
          <Route path="/" element={<LineupPage />} />
          <Route path="/apply" element={<ApplyForm />} />
          <Route
            path="/admin"
            element={
              isAdmin ? (
                <AdminPanel />
              ) : (
                <div className="login-page">
                  <div className="login-card fade-in">
                    <h2>管理员登录</h2>
                    <p className="login-subtitle">请输入管理员账号密码</p>
                    {loginError && <div className="login-error">{loginError}</div>}
                    <form onSubmit={handleLogin} className="login-form">
                      <div className="form-group">
                        <label>用户名</label>
                        <input
                          type="text"
                          value={loginForm.username}
                          onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                          className="form-input"
                          placeholder="admin"
                        />
                      </div>
                      <div className="form-group">
                        <label>密码</label>
                        <input
                          type="password"
                          value={loginForm.password}
                          onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                          className="form-input"
                          placeholder="admin123"
                        />
                      </div>
                      <button type="submit" className="btn-primary login-btn">
                        登录
                      </button>
                    </form>
                    <p className="login-hint">默认账号: admin / admin123</p>
                  </div>
                </div>
              )
            }
          />
          <Route
            path="/schedule"
            element={
              isAdmin ? (
                <ScheduleManager />
              ) : (
                <div className="login-page">
                  <div className="login-card fade-in">
                    <h2>管理员登录</h2>
                    <p className="login-subtitle">请先登录管理员账号</p>
                    {loginError && <div className="login-error">{loginError}</div>}
                    <form onSubmit={handleLogin} className="login-form">
                      <div className="form-group">
                        <label>用户名</label>
                        <input
                          type="text"
                          value={loginForm.username}
                          onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
                          className="form-input"
                          placeholder="admin"
                        />
                      </div>
                      <div className="form-group">
                        <label>密码</label>
                        <input
                          type="password"
                          value={loginForm.password}
                          onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                          className="form-input"
                          placeholder="admin123"
                        />
                      </div>
                      <button type="submit" className="btn-primary login-btn">
                        登录
                      </button>
                    </form>
                    <p className="login-hint">默认账号: admin / admin123</p>
                  </div>
                </div>
              )
            }
          />
        </Routes>

        {isAdmin && (
          <button className="logout-btn" onClick={handleLogout}>
            退出登录
          </button>
        )}

        <style>{`
          .app-container {
            min-height: 100vh;
          }

          .login-page {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
          }

          .login-card {
            width: 100%;
            max-width: 400px;
            background: var(--bg-card);
            border-radius: 20px;
            padding: 40px;
            border: 1px solid var(--border);
            backdrop-filter: blur(8px);
            box-shadow: var(--shadow-card);
          }

          .login-card h2 {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 8px;
            background: linear-gradient(135deg, var(--primary-light), var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
          }

          .login-subtitle {
            color: var(--text-secondary);
            font-size: 0.9rem;
            margin-bottom: 24px;
          }

          .login-error {
            padding: 12px;
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 8px;
            color: #f87171;
            font-size: 0.85rem;
            margin-bottom: 20px;
          }

          .login-form {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .login-form .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .login-form label {
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-secondary);
          }

          .login-form .form-input {
            padding: 12px 16px;
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-radius: 10px;
            color: var(--text-primary);
            font-size: 0.95rem;
            transition: all 0.2s ease;
          }

          .login-form .form-input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(108, 99, 255, 0.1);
          }

          .login-btn {
            margin-top: 8px;
            padding: 14px;
          }

          .login-hint {
            margin-top: 20px;
            text-align: center;
            font-size: 0.8rem;
            color: var(--text-muted);
          }

          .logout-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            padding: 10px 20px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            color: var(--text-secondary);
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s ease;
            z-index: 100;
            backdrop-filter: blur(8px);
          }

          .logout-btn:hover {
            color: var(--error);
            border-color: var(--error);
            background: rgba(239, 68, 68, 0.1);
          }

          @media (max-width: 768px) {
            .login-card {
              padding: 28px;
            }

            .logout-btn {
              bottom: 16px;
              right: 16px;
              padding: 8px 16px;
              font-size: 0.8rem;
            }
          }
        `}</style>
      </div>
    </Router>
  );
}

export default App;
