import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { TrendingUp, Users, Play, Gift, Medal } from 'lucide-react'
import {
  getDailyStats,
  getFanRankings,
  getTotalPlayCount,
  getTotalGiftRevenue,
  getTotalFans,
  hashUsernameToColor,
  getInitials,
} from '../data/mockData'
import type { DailyStats, FanRanking } from '../data/mockData'

export default function AnalyticsDashboard() {
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([])
  const [fanRankings, setFanRankings] = useState<FanRanking[]>([])
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    setDailyStats(getDailyStats())
    setFanRankings(getFanRankings())
    setTimeout(() => setIsVisible(true), 100)
  }, [])

  const stats = [
    {
      label: '总播放量',
      value: getTotalPlayCount().toLocaleString(),
      icon: Play,
      gradient: 'from-blue-500 to-cyan-500',
      delay: 0,
    },
    {
      label: '礼物收入',
      value: `¥${getTotalGiftRevenue().toLocaleString()}`,
      icon: Gift,
      gradient: 'from-pink-500 to-rose-500',
      delay: 0.1,
    },
    {
      label: '粉丝总数',
      value: getTotalFans().toLocaleString(),
      icon: Users,
      gradient: 'from-green-500 to-emerald-500',
      delay: 0.2,
    },
    {
      label: '增长趋势',
      value: '+12.5%',
      icon: TrendingUp,
      gradient: 'from-purple-500 to-violet-500',
      delay: 0.3,
    },
  ]

  const getMedalColor = (rank: number) => {
    switch (rank) {
      case 1: return 'from-yellow-400 to-amber-500'
      case 2: return 'from-gray-300 to-gray-400'
      case 3: return 'from-amber-600 to-amber-700'
      default: return ''
    }
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-gray-900/95 backdrop-blur-sm border border-white/10 rounded-lg p-3 shadow-xl">
          <p className="text-sm text-white/60 mb-1">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.value.toLocaleString()}
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">数据仪表盘</h2>
        <p className="text-white/60">查看你的作品表现和粉丝数据</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="relative bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10 overflow-hidden transition-all duration-400 hover:border-white/20 hover:shadow-[0_0_30px_rgba(67,97,238,0.2)]"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(30px)',
              transition: `opacity 0.5s ease ${stat.delay}s, transform 0.5s ease ${stat.delay}s, box-shadow 0.4s ease, border-color 0.3s ease`,
            }}
          >
            <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${stat.gradient} opacity-10 rounded-full -translate-y-1/2 translate-x-1/2`} />
            <div className="relative">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.gradient} flex items-center justify-center mb-3`}>
                <stat.icon size={18} className="text-white" />
              </div>
              <p className="text-2xl font-bold text-white mb-1">{stat.value}</p>
              <p className="text-sm text-white/60">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div
          className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(30px)',
            transition: 'opacity 0.5s ease 0.4s, transform 0.5s ease 0.4s',
          }}
        >
          <h3 className="text-lg font-semibold mb-4">播放量与收入趋势</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyStats}>
                <defs>
                  <linearGradient id="playGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4361EE" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4361EE" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E94560" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#E94560" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={12} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="playCount"
                  name="播放量"
                  stroke="#4361EE"
                  strokeWidth={2}
                  dot={{ fill: '#4361EE', r: 4 }}
                  activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
                />
                <Line
                  type="monotone"
                  dataKey="giftRevenue"
                  name="礼物收入"
                  stroke="#E94560"
                  strokeWidth={2}
                  dot={{ fill: '#E94560', r: 4 }}
                  activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div
          className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(30px)',
            transition: 'opacity 0.5s ease 0.5s, transform 0.5s ease 0.5s',
          }}
        >
          <h3 className="text-lg font-semibold mb-4">粉丝增长趋势</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyStats}>
                <defs>
                  <linearGradient id="fansGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#06B6D4" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={12} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="newFans"
                  name="新增粉丝"
                  stroke="#10B981"
                  strokeWidth={2}
                  fill="url(#fansGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div
        className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? 'translateY(0)' : 'translateY(30px)',
          transition: 'opacity 0.5s ease 0.6s, transform 0.5s ease 0.6s',
        }}
      >
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Medal className="text-yellow-500" size={20} />
          粉丝礼物排行榜
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {fanRankings.slice(0, 10).map((fan) => (
            <div
              key={fan.userId}
              className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all duration-300"
            >
              <div className="relative">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                  style={{ backgroundColor: hashUsernameToColor(fan.username) }}
                >
                  {getInitials(fan.username)}
                </div>
                {fan.rank <= 3 && (
                  <div
                    className={`absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-br ${getMedalColor(fan.rank)} flex items-center justify-center text-[10px] font-bold text-white shadow-lg`}
                  >
                    {fan.rank}
                  </div>
                )}
                {fan.rank > 3 && (
                  <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[10px] font-bold text-white/70">
                    {fan.rank}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{fan.username}</p>
                <p className="text-xs text-white/50">¥{fan.totalGiftValue}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
