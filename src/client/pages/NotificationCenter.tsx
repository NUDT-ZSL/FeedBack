import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCircle, XCircle, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '../store'
import { getAvatarColor } from '../App'

export default function NotificationCenter() {
  const { currentUser, notifications, applications, fetchNotifications, fetchApplications, handleApplication, markAllNotificationsRead, markNotificationRead } = useStore()
  const navigate = useNavigate()
  const [processing, setProcessing] = useState<string | null>(null)

  useEffect(() => {
    if (currentUser) {
      fetchNotifications()
      fetchApplications()
    }
  }, [currentUser])

  if (!currentUser) {
    navigate('/login')
    return null
  }

  const sorted = [...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  const unreadCount = notifications.filter((n) => !n.read).length

  const getTypeIcon = (type: string) => {
    if (type === 'application_received') return <Clock size={18} className="text-warm-orange" />
    if (type === 'application_approved') return <CheckCircle size={18} className="text-warm-green" />
    return <XCircle size={18} className="text-red-400" />
  }

  const getStatusLabel = (type: string) => {
    if (type === 'application_received') return '发来了一条申请'
    if (type === 'application_approved') return '通过了你的申请'
    return '拒绝了你的申请'
  }

  const extractApplicantName = (message: string) => {
    const match = message.match(/^(.+?)(?:对|发来|通过|拒绝)/)
    return match ? match[1] : '用户'
  }

  const isApplicationPending = (n: typeof notifications[0]) => {
    if (n.type !== 'application_received') return false
    const app = applications.find(a => a.id === n.applicationId)
    return app ? app.status === 'pending' : true
  }

  const getApplicationStatus = (n: typeof notifications[0]) => {
    const app = applications.find(a => a.id === n.applicationId)
    return app?.status
  }

  const onHandleApplication = async (appId: string, status: 'approved' | 'rejected') => {
    setProcessing(appId + status)
    try {
      await handleApplication(appId, status)
    } finally {
      setProcessing(null)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-xl">通知中心</h1>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs rounded-full px-2 py-0.5 badge-pulse">
              {unreadCount} 未读
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            className="text-sm text-warm-orange hover:underline"
            onClick={markAllNotificationsRead}
          >
            全部已读
          </button>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          <Bell size={56} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg">暂无通知</p>
          <p className="text-sm mt-1">当有人申请借出或领养时，你会在这里收到通知</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((n) => {
            const applicantName = extractApplicantName(n.message)
            const isPending = isApplicationPending(n)
            const appStatus = getApplicationStatus(n)

            return (
              <div
                key={n.id}
                className={clsx(
                  'glass-card notification-card type-' + n.type,
                  'p-4 pl-6 flex items-start gap-3 cursor-pointer',
                  !n.read && 'ring-1 ring-warm-orange/30'
                )}
                onClick={() => { if (!n.read) markNotificationRead(n.id) }}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {getTypeIcon(n.type)}
                </div>
                <div
                  className="avatar-circle w-9 h-9 text-sm flex-shrink-0"
                  style={{ backgroundColor: getAvatarColor(applicantName) }}
                >
                  {applicantName[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{applicantName}</span>{' '}
                    {getStatusLabel(n.type)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(n.createdAt).toLocaleString('zh-CN')}
                  </p>
                  {isPending && n.type === 'application_received' && (
                    <div className="flex gap-2 mt-2">
                      <button
                        className="px-3 py-1.5 bg-warm-green text-white rounded-lg text-xs font-medium hover:bg-warm-green-light transition active:scale-95 disabled:opacity-50"
                        disabled={processing !== null}
                        onClick={(e) => { e.stopPropagation(); onHandleApplication(n.applicationId, 'approved') }}
                      >
                        {processing === n.applicationId + 'approved' ? '处理中...' : '同意'}
                      </button>
                      <button
                        className="px-3 py-1.5 bg-red-400 text-white rounded-lg text-xs font-medium hover:bg-red-500 transition active:scale-95 disabled:opacity-50"
                        disabled={processing !== null}
                        onClick={(e) => { e.stopPropagation(); onHandleApplication(n.applicationId, 'rejected') }}
                      >
                        {processing === n.applicationId + 'rejected' ? '处理中...' : '拒绝'}
                      </button>
                    </div>
                  )}
                  {!isPending && n.type === 'application_received' && (
                    <span className={clsx(
                      'text-xs font-medium mt-1 inline-block',
                      appStatus === 'approved' ? 'text-warm-green' : 'text-red-400'
                    )}>
                      {appStatus === 'approved' ? '已同意' : '已拒绝'}
                    </span>
                  )}
                  {n.type === 'application_approved' && (
                    <span className="text-xs font-medium text-warm-green mt-1 inline-block">已通过</span>
                  )}
                  {n.type === 'application_rejected' && (
                    <span className="text-xs font-medium text-red-400 mt-1 inline-block">已拒绝</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
