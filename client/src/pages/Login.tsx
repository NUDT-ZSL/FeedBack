import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, User, Lock, LogIn, UserPlus } from 'lucide-react';
import { withErrorBoundary } from '../components/withErrorBoundary';

type TabType = 'login' | 'register';

interface LoginFormData {
  username: string;
  password: string;
}

interface RegisterFormData {
  username: string;
  password: string;
  confirmPassword: string;
}

interface ValidationErrors {
  username?: string;
  password?: string;
  confirmPassword?: string;
}

interface ApiResponse {
  success: boolean;
  token?: string;
  user?: {
    id: string;
    username: string;
  };
  message?: string;
}

const Login: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('login');
  const [loginData, setLoginData] = useState<LoginFormData>({ username: '', password: '' });
  const [registerData, setRegisterData] = useState<RegisterFormData>({
    username: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [apiError, setApiError] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const validateLogin = (): boolean => {
    const newErrors: ValidationErrors = {};
    if (!loginData.username.trim()) {
      newErrors.username = '请输入用户名';
    }
    if (!loginData.password) {
      newErrors.password = '请输入密码';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateRegister = (): boolean => {
    const newErrors: ValidationErrors = {};
    if (!registerData.username.trim()) {
      newErrors.username = '请输入用户名';
    } else if (registerData.username.length < 3 || registerData.username.length > 20) {
      newErrors.username = '用户名长度需在3-20个字符之间';
    }
    if (!registerData.password) {
      newErrors.password = '请输入密码';
    } else if (registerData.password.length < 6) {
      newErrors.password = '密码长度至少6位';
    }
    if (!registerData.confirmPassword) {
      newErrors.confirmPassword = '请确认密码';
    } else if (registerData.password !== registerData.confirmPassword) {
      newErrors.confirmPassword = '两次输入的密码不一致';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');
    if (!validateLogin()) return;

    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginData),
      });
      const data: ApiResponse = await response.json();

      if (data.success && data.token && data.user) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        navigate('/workspace');
      } else {
        setApiError(data.message || '登录失败，请检查用户名和密码');
      }
    } catch {
      setApiError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError('');
    if (!validateRegister()) return;

    setLoading(true);
    try {
      const response = await fetch('http://localhost:3001/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: registerData.username,
          password: registerData.password,
        }),
      });
      const data: ApiResponse = await response.json();

      if (data.success && data.token && data.user) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        navigate('/workspace');
      } else {
        setApiError(data.message || '注册失败，请稍后重试');
      }
    } catch {
      setApiError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    setErrors({});
    setApiError('');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #3498db 0%, #1abc9c 100%)',
        padding: '20px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          padding: '40px 32px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            marginBottom: '32px',
            background: '#f0f4f8',
            borderRadius: '12px',
            padding: '4px',
          }}
        >
          <button
            type="button"
            onClick={() => switchTab('login')}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              background: activeTab === 'login' ? 'linear-gradient(135deg, #3498db 0%, #1abc9c 100%)' : 'transparent',
              color: activeTab === 'login' ? '#ffffff' : '#64748b',
            }}
          >
            <LogIn size={18} />
            登录
          </button>
          <button
            type="button"
            onClick={() => switchTab('register')}
            style={{
              flex: 1,
              padding: '12px 16px',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              background: activeTab === 'register' ? 'linear-gradient(135deg, #3498db 0%, #1abc9c 100%)' : 'transparent',
              color: activeTab === 'register' ? '#ffffff' : '#64748b',
            }}
          >
            <UserPlus size={18} />
            注册
          </button>
        </div>

        {apiError && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#dc2626',
              padding: '12px 16px',
              borderRadius: '10px',
              marginBottom: '20px',
              fontSize: '14px',
            }}
          >
            {apiError}
          </div>
        )}

        {activeTab === 'login' ? (
          <form onSubmit={handleLoginSubmit}>
            <div style={{ marginBottom: '20px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#334155',
                }}
              >
                用户名
              </label>
              <div style={{ position: 'relative' }}>
                <User
                  size={18}
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#94a3b8',
                  }}
                />
                <input
                  type="text"
                  value={loginData.username}
                  onChange={(e) => {
                    setLoginData({ ...loginData, username: e.target.value });
                    if (errors.username) setErrors({ ...errors, username: undefined });
                  }}
                  placeholder="请输入用户名"
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 44px',
                    border: `2px solid ${errors.username ? '#ef4444' : '#e2e8f0'}`,
                    borderRadius: '10px',
                    fontSize: '15px',
                    transition: 'all 0.2s ease',
                    boxSizing: 'border-box',
                    outline: 'none',
                    background: '#f8fafc',
                  }}
                  onFocus={(e) => {
                    if (!errors.username) {
                      e.target.style.borderColor = '#3498db';
                      e.target.style.background = '#ffffff';
                    }
                  }}
                  onBlur={(e) => {
                    if (!errors.username) {
                      e.target.style.borderColor = '#e2e8f0';
                      e.target.style.background = '#f8fafc';
                    }
                  }}
                />
              </div>
              {errors.username && (
                <p style={{ color: '#ef4444', fontSize: '13px', margin: '6px 0 0 0' }}>
                  {errors.username}
                </p>
              )}
            </div>

            <div style={{ marginBottom: '28px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#334155',
                }}
              >
                密码
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={18}
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#94a3b8',
                  }}
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={loginData.password}
                  onChange={(e) => {
                    setLoginData({ ...loginData, password: e.target.value });
                    if (errors.password) setErrors({ ...errors, password: undefined });
                  }}
                  placeholder="请输入密码"
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 44px',
                    border: `2px solid ${errors.password ? '#ef4444' : '#e2e8f0'}`,
                    borderRadius: '10px',
                    fontSize: '15px',
                    transition: 'all 0.2s ease',
                    boxSizing: 'border-box',
                    outline: 'none',
                    background: '#f8fafc',
                  }}
                  onFocus={(e) => {
                    if (!errors.password) {
                      e.target.style.borderColor = '#3498db';
                      e.target.style.background = '#ffffff';
                    }
                  }}
                  onBlur={(e) => {
                    if (!errors.password) {
                      e.target.style.borderColor = '#e2e8f0';
                      e.target.style.background = '#f8fafc';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: 0,
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p style={{ color: '#ef4444', fontSize: '13px', margin: '6px 0 0 0' }}>
                  {errors.password}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                border: 'none',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #3498db 0%, #1abc9c 100%)',
                color: '#ffffff',
                fontSize: '16px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                transform: loading ? 'none' : undefined,
                opacity: loading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {loading ? '登录中...' : '登 录'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegisterSubmit}>
            <div style={{ marginBottom: '18px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#334155',
                }}
              >
                用户名
              </label>
              <div style={{ position: 'relative' }}>
                <User
                  size={18}
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#94a3b8',
                  }}
                />
                <input
                  type="text"
                  value={registerData.username}
                  onChange={(e) => {
                    setRegisterData({ ...registerData, username: e.target.value });
                    if (errors.username) setErrors({ ...errors, username: undefined });
                  }}
                  placeholder="3-20个字符"
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 44px',
                    border: `2px solid ${errors.username ? '#ef4444' : '#e2e8f0'}`,
                    borderRadius: '10px',
                    fontSize: '15px',
                    transition: 'all 0.2s ease',
                    boxSizing: 'border-box',
                    outline: 'none',
                    background: '#f8fafc',
                  }}
                  onFocus={(e) => {
                    if (!errors.username) {
                      e.target.style.borderColor = '#3498db';
                      e.target.style.background = '#ffffff';
                    }
                  }}
                  onBlur={(e) => {
                    if (!errors.username) {
                      e.target.style.borderColor = '#e2e8f0';
                      e.target.style.background = '#f8fafc';
                    }
                  }}
                />
              </div>
              {errors.username && (
                <p style={{ color: '#ef4444', fontSize: '13px', margin: '6px 0 0 0' }}>
                  {errors.username}
                </p>
              )}
            </div>

            <div style={{ marginBottom: '18px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#334155',
                }}
              >
                密码
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={18}
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#94a3b8',
                  }}
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={registerData.password}
                  onChange={(e) => {
                    setRegisterData({ ...registerData, password: e.target.value });
                    if (errors.password) setErrors({ ...errors, password: undefined });
                  }}
                  placeholder="至少6位"
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 44px',
                    border: `2px solid ${errors.password ? '#ef4444' : '#e2e8f0'}`,
                    borderRadius: '10px',
                    fontSize: '15px',
                    transition: 'all 0.2s ease',
                    boxSizing: 'border-box',
                    outline: 'none',
                    background: '#f8fafc',
                  }}
                  onFocus={(e) => {
                    if (!errors.password) {
                      e.target.style.borderColor = '#3498db';
                      e.target.style.background = '#ffffff';
                    }
                  }}
                  onBlur={(e) => {
                    if (!errors.password) {
                      e.target.style.borderColor = '#e2e8f0';
                      e.target.style.background = '#f8fafc';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: 0,
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p style={{ color: '#ef4444', fontSize: '13px', margin: '6px 0 0 0' }}>
                  {errors.password}
                </p>
              )}
            </div>

            <div style={{ marginBottom: '28px' }}>
              <label
                style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: '#334155',
                }}
              >
                确认密码
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={18}
                  style={{
                    position: 'absolute',
                    left: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#94a3b8',
                  }}
                />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={registerData.confirmPassword}
                  onChange={(e) => {
                    setRegisterData({ ...registerData, confirmPassword: e.target.value });
                    if (errors.confirmPassword) setErrors({ ...errors, confirmPassword: undefined });
                  }}
                  placeholder="再次输入密码"
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 44px',
                    border: `2px solid ${errors.confirmPassword ? '#ef4444' : '#e2e8f0'}`,
                    borderRadius: '10px',
                    fontSize: '15px',
                    transition: 'all 0.2s ease',
                    boxSizing: 'border-box',
                    outline: 'none',
                    background: '#f8fafc',
                  }}
                  onFocus={(e) => {
                    if (!errors.confirmPassword) {
                      e.target.style.borderColor = '#3498db';
                      e.target.style.background = '#ffffff';
                    }
                  }}
                  onBlur={(e) => {
                    if (!errors.confirmPassword) {
                      e.target.style.borderColor = '#e2e8f0';
                      e.target.style.background = '#f8fafc';
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{
                    position: 'absolute',
                    right: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: 0,
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p style={{ color: '#ef4444', fontSize: '13px', margin: '6px 0 0 0' }}>
                  {errors.confirmPassword}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                border: 'none',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #3498db 0%, #1abc9c 100%)',
                color: '#ffffff',
                fontSize: '16px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                transform: loading ? 'none' : undefined,
                opacity: loading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.transform = 'scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {loading ? '注册中...' : '注 册'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default withErrorBoundary(Login);
