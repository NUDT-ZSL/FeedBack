import { useState } from 'react';
import { User } from '../hooks/useAuth';

// 注册表单组件
// 数据流向：用户输入注册信息 -> fetch POST /api/auth/register -> bcrypt加密存储 -> 返回JWT
// 调用关系：Register -> fetch -> 后端routes/auth.ts -> 返回token和user
interface RegisterProps {
  onRegister: (token: string, user: User) => void;
  onSwitchToLogin: () => void;
}

export default function Register({ onRegister, onSwitchToLogin }: RegisterProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // 提交注册请求
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // 前端校验
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码至少需要6位');
      return;
    }

    setLoading(true);

    try {
      // 调用后端注册API
      // 数据流向：前端发送用户信息 -> 后端bcrypt加密密码 -> 存储用户（默认普通会员）
      // -> 签发JWT -> 返回token和user
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || '注册失败');
      }

      // 注册成功，自动登录
      onRegister(data.token, data.user);
    } catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 className="auth-logo">🏋️ GYM PRO</h1>
          <p className="auth-subtitle">创建新账户，开启健身之旅</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label>姓名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="请输入您的姓名"
              required
            />
          </div>

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
              placeholder="请输入密码（至少6位）"
              required
            />
          </div>

          <div className="form-group">
            <label>确认密码</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="请再次输入密码"
              required
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '注册中...' : '注 册'}
          </button>
        </form>

        <div className="auth-footer">
          <span>已有账户？</span>
          <button className="link-btn" onClick={onSwitchToLogin}>
            立即登录
          </button>
        </div>
      </div>
    </div>
  );
}
