import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

interface LoginProps {
  onLogin: (user: any, token: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('token', data.token);
        onLogin(data.user, data.token);
        navigate('/');
      } else {
        setError(data.message || '登录失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    }

    setLoading(false);
  };

  return (
    <div className="auth-container">
      <h2>登录</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>用户名</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入用户名"
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
        {error && <p style={{ color: '#e74c3c', marginBottom: '16px', fontSize: '14px' }}>{error}</p>}
        <button type="submit" className="btn btn-block" disabled={loading}>
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
      <p className="auth-link">
        还没有账号？<Link to="/register">立即注册</Link>
      </p>
      <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '12px', color: '#999' }}>
        测试账号：admin / admin123 (管理员)<br/>
        测试账号：volunteer1 / 123456 (志愿者)
      </p>
    </div>
  );
};

export default Login;
