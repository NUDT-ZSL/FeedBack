import { useState } from 'react';
import { User } from '../hooks/useAuth';

// 登录表单组件
// 数据流向：用户输入邮箱密码 -> fetch POST /api/auth/login -> 获取JWT和用户信息 -> 回调onLogin传给App
// 调用关系：Login -> fetch -> 后端routes/auth.ts -> 返回token和user
interface LoginProps {
  onLogin: (token: string, user: User) => void;
  onSwitchToRegister: () => void;
}

export default function Login({ onLogin, onSwitchToRegister }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 提交登录请求
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // 调用后端登录API
      // 数据流向：前端发送credentials -> 后端bcrypt校验密码 -> 签发JWT -> 返回token和user
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || '登录失败');
      }

      // 登录成功，将token和用户信息传给父组件
      onLogin(data.token, data.user);
    } catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">🏋️ GYM PRO</h1>
          <p className="auth-subtitle">欢迎回来，请登录您的账户</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label>邮箱地址</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱"
              required
            />
          </div>

          <div className="form-group">
            <label>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>

        <div className="auth-footer">
          <span>还没有账户？</span>
          <button className="link-btn" onClick={onSwitchToRegister}>
            立即注册
          </button>
        </div>
      </div>
    </div>
  );
}
