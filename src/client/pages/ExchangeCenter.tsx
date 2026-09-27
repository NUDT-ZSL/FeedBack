import React, { useState, useEffect, useCallback } from 'react';
import { Exchange, Book } from '../types';
import { getExchanges, updateExchange, getBooks } from '../utils/api';
import { useAuth } from '../context/AuthContext';

const STATUS_CONFIG: Record<
  string,
  { label: string; bgColor: string; textColor: string; badgeColor: string }
> = {
  pending: {
    label: '待处理',
    bgColor: 'rgba(251, 191, 36, 0.1)',
    textColor: '#d97706',
    badgeColor: '#fbbf24',
  },
  approved: {
    label: '已接受',
    bgColor: 'rgba(34, 197, 94, 0.1)',
    textColor: '#15803d',
    badgeColor: '#22c55e',
  },
  rejected: {
    label: '已拒绝',
    bgColor: 'rgba(239, 68, 68, 0.1)',
    textColor: '#b91c1c',
    badgeColor: '#ef4444',
  },
  completed: {
    label: '已完成',
    bgColor: 'rgba(59, 130, 246, 0.1)',
    textColor: '#1d4ed8',
    badgeColor: '#3b82f6',
  },
  cancelled: {
    label: '已取消',
    bgColor: 'rgba(107, 114, 128, 0.1)',
    textColor: '#374151',
    badgeColor: '#6b7280',
  },
};

interface ExchangeWithBook extends Exchange {
  book?: Book;
}

const ExchangeCenter: React.FC = () => {
  const [exchanges, setExchanges] = useState<ExchangeWithBook[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'received' | 'sent'>('received');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [animatingIds, setAnimatingIds] = useState<Set<string>>(new Set());

  const { user } = useAuth();

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [exchangesData, booksData] = await Promise.all([
        getExchanges(),
        getBooks(),
      ]);
      setBooks(booksData);

      const exchangesWithBooks = exchangesData.map((exchange) => ({
        ...exchange,
        book: booksData.find((b) => b.id === exchange.bookId),
      }));
      setExchanges(exchangesWithBooks);
    } catch (error) {
      console.error('Failed to fetch exchanges:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleStatusUpdate = async (exchangeId: string, newStatus: 'approved' | 'rejected') => {
    setUpdatingId(exchangeId);
    setAnimatingIds((prev) => new Set([...prev, exchangeId]));

    try {
      await updateExchange(exchangeId, { status: newStatus });

      setExchanges((prev) =>
        prev.map((exchange) =>
          exchange.id === exchangeId
            ? { ...exchange, status: newStatus, updatedAt: new Date().toISOString() }
            : exchange
        )
      );

      setTimeout(() => {
        setAnimatingIds((prev) => {
          const next = new Set(prev);
          next.delete(exchangeId);
          return next;
        });
      }, 500);
    } catch (error) {
      console.error('Failed to update exchange:', error);
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredExchanges = exchanges.filter((exchange) => {
    if (activeTab === 'received') {
      return exchange.ownerId === user?.id;
    }
    return exchange.requesterId === user?.id;
  });

  const sortedExchanges = [...filteredExchanges].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="min-h-screen py-8 px-4 md:px-8" style={{ backgroundColor: '#F9F5F0' }}>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-6" style={{ color: '#2D2D2D' }}>
          交换中心
        </h1>

        <div className="flex gap-2 mb-8">
          <button
            onClick={() => setActiveTab('received')}
            className={`px-6 py-2.5 rounded-full font-medium transition-all ${
              activeTab === 'received'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
            style={activeTab === 'received' ? { backgroundColor: '#FF6B35' } : {}}
          >
            收到的请求
            {filteredExchanges.length > 0 && activeTab === 'received' && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                {filteredExchanges.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('sent')}
            className={`px-6 py-2.5 rounded-full font-medium transition-all ${
              activeTab === 'sent'
                ? 'text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
            style={activeTab === 'sent' ? { backgroundColor: '#FF6B35' } : {}}
          >
            发出的请求
            {filteredExchanges.length > 0 && activeTab === 'sent' && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
                {filteredExchanges.length}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-500">加载中...</div>
        ) : sortedExchanges.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <div className="text-6xl mb-4">📭</div>
            <p className="text-gray-500 text-lg">
              {activeTab === 'received' ? '暂无收到的交换请求' : '暂无发出的交换请求'}
            </p>
            <p className="text-gray-400 text-sm mt-2">
              {activeTab === 'received' ? '有人请求交换您的书籍时会在这里显示' : '您发起的交换请求会在这里显示'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedExchanges.map((exchange) => {
              const statusConfig = STATUS_CONFIG[exchange.status] || STATUS_CONFIG.pending;
              const isAnimating = animatingIds.has(exchange.id);
              const isUpdating = updatingId === exchange.id;
              const isReceived = activeTab === 'received';
              const canAction = isReceived && exchange.status === 'pending';

              return (
                <div
                  key={exchange.id}
                  className="bg-white rounded-2xl overflow-hidden"
                  style={{
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    backgroundColor: isAnimating ? statusConfig.bgColor : 'white',
                    transition: 'background-color 0.3s ease, transform 0.3s ease, box-shadow 0.3s ease',
                    animation: !isAnimating ? 'slideIn 0.3s ease-out' : undefined,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.12)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div className="p-5 md:p-6">
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-shrink-0">
                        <img
                          src={exchange.book?.coverImage || 'https://picsum.photos/seed/book/120/180'}
                          alt={exchange.book?.title || '书籍'}
                          className="w-24 h-36 object-cover rounded-lg"
                          style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                          <div>
                            <h3 className="font-bold text-lg truncate" style={{ color: '#2D2D2D' }}>
                              {exchange.book?.title || '未知书籍'}
                            </h3>
                            <p className="text-gray-500 text-sm">
                              {exchange.book?.author || '未知作者'}
                            </p>
                          </div>

                          <span
                            className="px-3 py-1 rounded-full text-xs font-medium text-white flex-shrink-0"
                            style={{ backgroundColor: statusConfig.badgeColor }}
                          >
                            {statusConfig.label}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mb-4">
                          <div className="flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                            <span>
                              {isReceived
                                ? `请求者: 用户${exchange.requesterId.slice(-4)}`
                                : `所有者: 用户${exchange.ownerId.slice(-4)}`}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>{formatDate(exchange.createdAt)}</span>
                          </div>
                        </div>

                        {exchange.message && (
                          <p className="text-gray-600 text-sm mb-4 italic">
                            "{exchange.message}"
                          </p>
                        )}

                        {canAction && (
                          <div className="flex gap-3">
                            <button
                              onClick={() => handleStatusUpdate(exchange.id, 'approved')}
                              disabled={isUpdating}
                              className="px-6 py-2 rounded-lg font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
                              style={{ backgroundColor: '#22c55e' }}
                            >
                              {isUpdating && updatingId === exchange.id ? '处理中...' : '接受'}
                            </button>
                            <button
                              onClick={() => handleStatusUpdate(exchange.id, 'rejected')}
                              disabled={isUpdating}
                              className="px-6 py-2 rounded-lg font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
                              style={{ backgroundColor: '#ef4444' }}
                            >
                              拒绝
                            </button>
                          </div>
                        )}

                        {!canAction && (
                          <div className="text-sm" style={{ color: statusConfig.textColor }}>
                            {isReceived && exchange.status === 'approved' && '✓ 您已接受此交换请求'}
                            {isReceived && exchange.status === 'rejected' && '✗ 您已拒绝此交换请求'}
                            {isReceived && exchange.status === 'completed' && '✓ 交换已完成'}
                            {isReceived && exchange.status === 'cancelled' && '✗ 交换已取消'}
                            {!isReceived && exchange.status === 'pending' && '⏳ 等待对方回应'}
                            {!isReceived && exchange.status === 'approved' && '✓ 对方已接受您的交换请求'}
                            {!isReceived && exchange.status === 'rejected' && '✗ 对方已拒绝您的交换请求'}
                            {!isReceived && exchange.status === 'completed' && '✓ 交换已完成'}
                            {!isReceived && exchange.status === 'cancelled' && '✗ 交换已取消'}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
};

export default ExchangeCenter;
