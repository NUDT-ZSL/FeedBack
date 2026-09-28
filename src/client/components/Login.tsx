import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { UserPlus, LogIn, Theater, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react';
import { useStore } from '../store/useStore';

type Tab = 'login' | 'register';

export default function Login() {
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'actor' | 'director'>('actor');
  const [showPwd, setShowPwd] = useState(false);
  const [err, setErr] = useState('');

  const login = useStore((s) => s.login);
  const register = useStore((s) => s.register);
  const isLoading = useStore((s) => s.isLoading);
  const showToast = useStore((s) => s.showToast);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname || '/';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    try {
      if (tab === 'login') {
        await login(email.trim(), password);
      } else {
        if (!name.trim()) throw new Error('请输入您的姓名');
        if (password.length < 6) throw new Error('密码至少6位');
        await register({ email: email.trim(), password, name: name.trim(), role });
      }
      navigate(from, { replace: true });
    } catch (error) {
      const msg = (error as Error).message;
      setErr(msg);
      showToast(msg, 'error');
    }
  };

  const fillDemo = (account: { email: string; pwd: string }) => {
    setEmail(account.email);
    setPassword(account.pwd);
    setTab('login');
    setErr('');
  };

  const demoAccounts = [
    { label: '导演账号', email: 'director@theater.com', pwd: '123456', role: 'director' as const },
    { label: '演员账号', email: 'actor1@theater.com', pwd: '123456', role: 'actor' as const },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(ellipse at 20% 20%, rgba(114, 47, 55, 0.35) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(212, 175, 55, 0.15) 0%, transparent 50%)',
          }}
        />
      </div>

      <div className="relative w-full max-w-md fade-in-up">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-wine-700 to-wine-900 flex items-center justify-center mb-4 shadow-lg shadow-wine-900/40 border border-gold-500/30">
            <Theater className="w-8 h-8 text-gold-400" />
          </div>
          <h1 className="font-display text-3xl font-bold text-theater-text">
            <span className="gold-gradient-text">戏剧社招募平台</span>
          </h1>
          <p className="text-theater-textDim text-sm mt-2">业余戏剧社 · 演员招募与角色匹配</p>
        </div>

        <div className="card !p-0 overflow-hidden">
          <div className="flex border-b border-theater-border/60">
            {(['login', 'register'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t);
                  setErr('');
                }}
                className={`flex-1 py-4 text-sm font-medium transition-all relative ${
                  tab === t ? 'text-gold-400' : 'text-theater-textMuted hover:text-theater-textDim'
                }`}
              >
                {t === 'login' ? '登录' : '注册账号'}
                {tab === t && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-gold-400 rounded-full" />
                )}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="p-6 space-y-5">
            {err && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{err}</span>
              </div>
            )}

            {tab === 'register' && (
              <div className="space-y-3">
                <label className="block text-sm font-medium text-theater-textDim">您的姓名</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="请输入姓名或艺名"
                  className="input"
                  disabled={isLoading}
                />
              </div>
            )}

            <div