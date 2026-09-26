import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { PawPrint } from 'lucide-react'
import { useStore } from '../store'

export default function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, register } = useStore()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = tab === 'login'
        ? await login(username, password)
        : await register(username, password)
      navigate(`/profile/${user.id}`)
    } catch (err: any) {
      setError(err.message || '操作失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass-card w-full max-w-md p-8">
        <div className="flex items-center justify-center gap-2 mb-6">
          <PawPrint size={28} className="text-warm-orange" />
          <h1 className="font-display font-bold text-2xl">宠物共享社群</h1>
        </div>

        <div className="flex mb-6 bg-white/40 rounded-lg p-1">
          <button
            className={clsx(
              'flex-1 py-2 rounded-md text-sm font-medium transition',
              tab === 'login' ? 'bg-warm-orange text-white shadow' : 'text-gray-500 hover:text-gray-700'
            )}
            onClick={() => { setTab('login'); setError('') }}
          >
            登录
          </button>
          <button
            className={clsx(
              'flex-1 py-2 rounded-md text-sm font-medium transition',
              tab === 'register' ? 'bg-warm-orange text-white shadow' : 'text-gray-500 hover:text-gray-700'
            )}
            onClick={() => { setTab('register'); setError('') }}
          >
            注册
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white/60 border border-white/40 focus:outline-none focus:ring-2 focus:ring-warm-orange/50 transition text-sm"
              placeholder="请输入用户名"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white/60 border border-white/40 focus:outline-none focus:ring-2 focus:ring-warm-orange/50 transition text-sm"
              placeholder="请输入密码"
              required
            />
          </div>

          {error && (
            <div className="text-red-500 text-sm text-center">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={clsx(
              'w-full py-2.5 bg-warm-orange text-white rounded-lg font-medium transition',
              loading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-warm-orange-light active:scale-[0.98]'
            )}
          >
            {loading ? '处理中...' : tab === 'login' ? '登录' : '注册'}
          </button>
        </form>
      </div>
    </div>
  )
}
