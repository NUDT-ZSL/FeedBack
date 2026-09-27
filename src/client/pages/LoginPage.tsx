import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChefHat, User, Lock, Mail } from 'lucide-react';
import { useAuth } from '../store/AppContext';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, register, isAuthenticated } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (isAuthenticated) {
    navigate('/');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (isLogin) {
        await login(username, password);
      } else {
        await register(username, password, email);
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-forest-500 mb-4 shadow-lg shadow-forest-500/20">
            <ChefHat className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-brown-700 font-display mb-2">
            美味厨房
          </h1>
          <p className="text-brown-400">
            {isLogin ? '欢迎回来' : '创建新账号'}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-card p-8 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-brown-600 flex items-center gap-2">
                <User className="w-4 h-4" />
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className={cn(
                  'w-full px-4 py-3 rounded-xl border-2 bg-cream-50',
                  'text-brown-700 placeholder-brown-300',
                  'transition-all duration-200',
                  'focus:outline-none focus:ring-0 focus:border-forest-500',
                  'border-brown-200'
                )}
              />
            </div>

            {!isLogin && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-brown-600 flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  邮箱
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="请输入邮箱"
                  className={cn(
                    'w-full px-4 py-3 rounded-xl border-2 bg-cream-50',
                    'text-brown-700 placeholder-brown-300',
                    'transition-all duration-200',
                    'focus:outline-none focus:ring-0 focus:border-forest-500',
                    'border-brown-200'
                  )}
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-medium text-brown-600 flex items-center gap-2">
                <Lock className="w-4 h-4" />
                密码
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className={cn(
                  'w-full px-4 py-3 rounded-xl border-2 bg-cream-50',
                  'text-brown-700 placeholder-brown-300',
                  'transition-all duration-200',
                  'focus:outline-none focus:ring-0 focus:border-forest-500',
                  'border-brown-200'
                )}
              />
            </div>

            {error && (
              <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-3 text-accent-red text-sm text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                'w-full py-4 rounded-xl font-semibold text-lg',
                'transition-all duration-200',
                'bg-forest-500 text-white',
                'hover:bg-forest-600',
                'active:scale-[0.98]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'shadow-lg shadow-forest-500/20'
              )}
            >
              {isLoading ? '处理中...' : isLogin ? '登录' : '注册'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setIsLogin(!isLogin)}
              className="text-brown-500 hover:text-forest-500 transition-colors duration-200 text-sm"
            >
              {isLogin ? '没有账号？立即注册' : '已有账号？立即登录'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
