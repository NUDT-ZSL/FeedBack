import React, { useState, useRef } from 'react';
import { Message } from '../types';
import { useNotification } from '../context/NotificationContext';

const Messages: React.FC = () => {
  const { messages, unreadCount, markAllRead, markRead } = useNotification();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const touchStartX = useRef<number>(0);
  const [swipedId, setSwipedId] = useState<string | null>(null);

  const handleTouchStart = (e: React.TouchEvent, id: string) => {
    touchStartX.current = e.touches[0].clientX;
    setSwipedId(null);
  };

  const handleTouchMove = (e: React.TouchEvent, id: string) => {
    const diff = touchStartX.current - e.touches[0].clientX;
    if (diff > 50) {
      setSwipedId(id);
    } else if (diff < -30) {
      setSwipedId(null);
    }
  };

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setTimeout(() => {
      setDeletingId(null);
      setSwipedId(null);
    }, 300);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'exchange_request':
        return '📨';
      case 'exchange_update':
        return '📋';
      case 'system':
        return '🔔';
      default:
        return '💬';
    }
  };

  const sortedMessages = [...messages].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="min-h-screen py-8 px-4 md:px-8" style={{ backgroundColor: '#F9F5F0' }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold" style={{ color: '#2D2D2D' }}>
              消息中心
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              查看所有通知和交换更新
            </p>
          </div>

          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 bg-orange-100 rounded-full">
                <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                <span className="text-orange-600 font-medium text-sm">
                  {unreadCount} 条未读
                </span>
              </div>
            )}

            <button
              onClick={markAllRead}
              disabled={unreadCount === 0}
              className={`px-5 py-2.5 rounded-full font-medium transition-all ${
                unreadCount === 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'text-white hover:opacity-90'
              }`}
              style={unreadCount > 0 ? { backgroundColor: '#FF6B35' } : {}}
            >
              全部标记已读
            </button>
          </div>
        </div>

        {sortedMessages.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📭</div>
            <p className="text-gray-500 text-lg">暂无消息</p>
            <p className="text-gray-400 text-sm mt-2">有新消息时会在这里显示</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedMessages.map((message) => {
              const isSwiped = swipedId === message.id;
              const isDeleting = deletingId === message.id;

              return (
                <div
                  key={message.id}
                  className="relative overflow-hidden"
                  style={{
                    transform: isDeleting ? 'translateX(-100%)' : 'translateX(0)',
                    opacity: isDeleting ? 0 : 1,
                    transition: 'transform 0.3s ease, opacity 0.3s ease',
                  }}
                >
                  <div
                    className="absolute right-0 top-0 h-full flex items-center px-4"
                    style={{ backgroundColor: '#ef4444' }}
                  >
                    <button
                      onClick={() => handleDelete(message.id)}
                      className="text-white font-medium"
                    >
                      删除
                    </button>
                  </div>

                  <div
                    className={`relative bg-white rounded-xl p-5 cursor-pointer ${
                      !message.isRead ? 'border-l-4' : ''
                    }`}
                    style={{
                      borderLeftColor: !message.isRead ? '#FF6B35' : undefined,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                      transform: isSwiped ? 'translateX(-80px)' : 'translateX(0)',
                      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                    }}
                    onClick={() => !message.isRead && markRead(message.id)}
                    onTouchStart={(e) => handleTouchStart(e, message.id)}
                    onTouchMove={(e) => handleTouchMove(e, message.id)}
                    onMouseEnter={(e) => {
                      if (!isSwiped) {
                        e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.12)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSwiped) {
                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                      }
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div className="text-2xl flex-shrink-0">
                        {getTypeIcon(message.type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start gap-2 mb-1">
                          <p
                            className={`font-medium ${
                              !message.isRead ? 'text-gray-900' : 'text-gray-600'
                            }`}
                          >
                            {message.content}
                          </p>
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {formatDate(message.createdAt)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {!message.isRead && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                              未读
                            </span>
                          )}
                          {message.relatedExchangeId && (
                            <span className="text-xs text-gray-400">
                              交换 #{message.relatedExchangeId.slice(-6)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Messages;
