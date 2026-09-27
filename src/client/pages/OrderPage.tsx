import { useState, useEffect, useCallback } from 'react';
import { Gavel, User, LogOut, ShoppingBag, Star, Package, MapPin, Truck, CheckCircle, MessageSquare, X, AlertCircle, ChevronLeft } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import { useNavigate } from 'react-router-dom';

const API_BASE = '/api';

export interface Order {
  id: string;
  auctionId: string;
  auctionTitle: string;
  auctionImage: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  sellerName: string;
  amount: number;
  status: 'pending_payment' | 'paid' | 'pending_shipping' | 'shipped' | 'completed';
  address?: { name: string; phone: string; address: string };
  trackingNumber?: string;
  createdAt: number;
  paidAt?: number;
  shippedAt?: number;
  completedAt?: number;
}

type TabType = 'all' | 'buyer' | 'seller';

const statusTextMap: Record<Order['status'], string> = {
  pending_payment: '待付款',
  paid: '已付款',
  pending_shipping: '待发货',
  shipped: '已发货',
  completed: '已完成',
};

export default function OrderPage() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [addressName, setAddressName] = useState('');
  const [addressPhone, setAddressPhone] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  const [shippingModalOrder, setShippingModalOrder] = useState<Order | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [shippingLoading, setShippingLoading] = useState(false);

  const [reviewModal, setReviewModal] = useState<Order | null>(null);
  const [rating, setRating] = useState(5);
  const [reviewContent, setReviewContent] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/orders?userId=${user.id}`);
      const data = await res.json();

      if (data.success) {
        setOrders(data.orders || []);
      } else {
        setError(data.error || '获取订单列表失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchOrders();
    }
  }, [user, fetchOrders]);

  const filteredOrders = orders.filter((order) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'buyer') return order.buyerId === user?.id;
    if (activeTab === 'seller') return order.sellerId === user?.id;
    return true;
  });

  const isBuyer = (order: Order) => order.buyerId === user?.id;
  const isSeller = (order: Order) => order.sellerId === user?.id;

  const handlePayment = async (order: Order) => {
    if (!user) return;

    setActionLoading(order.id);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/orders/${order.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' }),
      });

      const data = await res.json();

      if (data.success) {
        fetchOrders();
      } else {
        setError(data.error || '付款失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setActionLoading(null);
    }
  };

  const handleConfirmReceive = async (order: Order) => {
    if (!user) return;

    setActionLoading(order.id);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/orders/${order.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });

      const data = await res.json();

      if (data.success) {
        fetchOrders();
      } else {
        setError(data.error || '确认收货失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEditAddress = (order: Order) => {
    setEditingOrder(order);
    setAddressName(order.address?.name || '');
    setAddressPhone(order.address?.phone || '');
    setAddressDetail(order.address?.address || '');
  };

  const handleSaveAddress = async () => {
    if (!editingOrder || !user) return;

    if (!addressName.trim() || !addressPhone.trim() || !addressDetail.trim()) {
      setError('请填写完整的收货地址信息');
      return;
    }

    setSavingAddress(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/orders/${editingOrder.id}/address`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addressName.trim(),
          phone: addressPhone.trim(),
          address: addressDetail.trim(),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setEditingOrder(null);
        fetchOrders();
      } else {
        setError(data.error || '保存地址失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setSavingAddress(false);
    }
  };

  const handleShipping = (order: Order) => {
    setShippingModalOrder(order);
    setTrackingNumber(order.trackingNumber || '');
  };

  const handleShippingSubmit = async () => {
    if (!shippingModalOrder || !user) return;

    if (!trackingNumber.trim()) {
      setError('请填写物流单号');
      return;
    }

    setShippingLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/orders/${shippingModalOrder.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'shipped',
          trackingNumber: trackingNumber.trim(),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setShippingModalOrder(null);
        setTrackingNumber('');
        fetchOrders();
      } else {
        setError(data.error || '发货失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setShippingLoading(false);
    }
  };

  const handleReview = (order: Order) => {
    setReviewModal(order);
    setRating(5);
    setReviewContent('');
  };

  const handleReviewSubmit = async () => {
    if (!reviewModal || !user) return;

    if (!reviewContent.trim()) {
      setError('请填写评价内容');
      return;
    }

    setReviewLoading(true);
    setError(null);

    try {
      const targetUserId = isBuyer(reviewModal) ? reviewModal.sellerId : reviewModal.buyerId;
      const reviewerRole = isBuyer(reviewModal) ? 'buyer' : 'seller';

      const res = await fetch(`${API_BASE}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: reviewModal.id,
          auctionId: reviewModal.auctionId,
          reviewerId: user.id,
          reviewerRole,
          targetUserId,
          rating,
          content: reviewContent.trim(),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setReviewModal(null);
        setReviewContent('');
        fetchOrders();
      } else {
        setError(data.error || '评价失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setReviewLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!user) {
    return (
      <div className="min-h-screen">
        <header className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white shadow-lg sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2 hover:opacity-90 transition-opacity"
            >
              <Gavel className="w-8 h-8" />
              <h1 className="text-xl font-bold font-serif">匠心拍卖</h1>
            </button>
            <button
              onClick={() => navigate('/')}
              className="bg-white text-amber-700 px-4 py-1.5 rounded-lg font-medium hover:bg-amber-50 transition-colors"
            >
              返回首页
            </button>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-16">
          <div className="text-center">
            <ShoppingBag className="w-20 h-20 text-amber-300 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-amber-900 mb-2">请先登录</h2>
            <p className="text-amber-700 mb-6">登录后即可查看您的订单信息</p>
            <button
              onClick={() => navigate('/')}
              className="btn-primary px-8 py-3 text-lg font-medium"
            >
              返回首页登录
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 hover:opacity-90 transition-opacity"
          >
            <Gavel className="w-8 h-8" />
            <h1 className="text-xl font-bold font-serif">匠心拍卖</h1>
          </button>

          <nav className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-amber-100">
              <User className="w-5 h-5" />
              <span className="hidden sm:inline">{user.nickname}</span>
              <span className="text-xs bg-amber-800 px-2 py-0.5 rounded-full">
                {user.role === 'seller' ? '卖家' : '买家'}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-amber-100 hover:text-white transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span className="hidden sm:inline">退出</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate('/')}
            className="p-2 text-amber-700 hover:bg-amber-100 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-2xl font-bold text-amber-900 font-serif">订单管理</h2>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-md mb-6 overflow-hidden">
          <div className="flex border-b border-amber-100">
            <button
              onClick={() => setActiveTab('all')}
              className={`flex-1 py-4 text-center font-medium transition-colors ${
                activeTab === 'all'
                  ? 'text-amber-700 border-b-2 border-amber-500 bg-amber-50'
                  : 'text-stone-600 hover:text-amber-700 hover:bg-amber-50/50'
              }`}
            >
              全部订单
            </button>
            <button
              onClick={() => setActiveTab('buyer')}
              className={`flex-1 py-4 text-center font-medium transition-colors ${
                activeTab === 'buyer'
                  ? 'text-amber-700 border-b-2 border-amber-500 bg-amber-50'
                  : 'text-stone-600 hover:text-amber-700 hover:bg-amber-50/50'
              }`}
            >
              作为买家
            </button>
            <button
              onClick={() => setActiveTab('seller')}
              className={`flex-1 py-4 text-center font-medium transition-colors ${
                activeTab === 'seller'
                  ? 'text-amber-700 border-b-2 border-amber-500 bg-amber-50'
                  : 'text-stone-600 hover:text-amber-700 hover:bg-amber-50/50'
              }`}
            >
              作为卖家
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div className="inline-block w-10 h-10 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin mb-4" />
            <p className="text-amber-700">加载中...</p>
          </div>
        ) : filteredOrders.length > 0 ? (
          <div className="space-y-4">
            {filteredOrders.map((order) => (
              <div
                key={order.id}
                className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow"
              >
                <div className="p-4 flex gap-4">
                  <div className="w-28 h-28 flex-shrink-0 rounded-lg overflow-hidden bg-amber-50">
                    {order.auctionImage ? (
                      <img
                        src={order.auctionImage}
                        alt={order.auctionTitle}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-10 h-10 text-amber-300" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-semibold text-amber-900 line-clamp-1">
                        {order.auctionTitle}
                      </h3>
                      <span
                        className={`flex-shrink-0 px-3 py-1 rounded-full text-sm font-medium status-${order.status}`}
                      >
                        {statusTextMap[order.status]}
                      </span>
                    </div>

                    <div className="text-sm text-stone-600 mb-2">
                      <span>{isBuyer(order) ? '卖家' : '买家'}：</span>
                      <span>{isBuyer(order) ? order.sellerName : order.buyerName}</span>
                    </div>

                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-sm text-stone-500">订单金额：</span>
                      <span className="text-xl font-bold text-amber-700">¥{order.amount}</span>
                    </div>

                    <div className="text-xs text-stone-400">
                      下单时间：{formatDate(order.createdAt)}
                    </div>
                  </div>
                </div>

                {order.trackingNumber && (order.status === 'shipped' || order.status === 'completed') && (
                  <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 flex items-center gap-2">
                    <Truck className="w-4 h-4 text-amber-600" />
                    <span className="text-sm text-amber-800">
                      物流单号：<span className="font-medium">{order.trackingNumber}</span>
                    </span>
                  </div>
                )}

                {isBuyer(order) && order.status === 'pending_payment' && (
                  <div className="px-4 py-3 border-t border-amber-100">
                    {editingOrder?.id === order.id ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-amber-700 font-medium">
                          <MapPin className="w-4 h-4" />
                          <span>收货地址</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm text-stone-600 mb-1">收货人</label>
                            <input
                              type="text"
                              value={addressName}
                              onChange={(e) => setAddressName(e.target.value)}
                              className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                              placeholder="请输入收货人姓名"
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-stone-600 mb-1">联系电话</label>
                            <input
                              type="tel"
                              value={addressPhone}
                              onChange={(e) => setAddressPhone(e.target.value)}
                              className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                              placeholder="请输入联系电话"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm text-stone-600 mb-1">详细地址</label>
                          <textarea
                            value={addressDetail}
                            onChange={(e) => setAddressDetail(e.target.value)}
                            className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
                            rows={2}
                            placeholder="请输入详细地址"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={handleSaveAddress}
                            disabled={savingAddress}
                            className="btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {savingAddress ? '保存中...' : '保存地址'}
                          </button>
                          <button
                            onClick={() => setEditingOrder(null)}
                            className="px-4 py-2 text-sm text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        {order.address ? (
                          <div className="flex items-center gap-2 text-sm text-stone-600">
                            <MapPin className="w-4 h-4 text-amber-500" />
                            <span>
                              {order.address.name} {order.address.phone} - {order.address.address}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-amber-600">
                            <MapPin className="w-4 h-4" />
                            <span>请填写收货地址</span>
                          </div>
                        )}
                        <button
                          onClick={() => handleEditAddress(order)}
                          className="text-sm text-amber-600 hover:text-amber-700 font-medium"
                        >
                          {order.address ? '修改地址' : '填写地址'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="px-4 py-3 bg-stone-50 border-t border-stone-100 flex items-center justify-end gap-2">
                  {isBuyer(order) && (
                    <>
                      {order.status === 'pending_payment' && (
                        <button
                          onClick={() => handlePayment(order)}
                          disabled={actionLoading === order.id}
                          className="btn-primary px-5 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actionLoading === order.id ? '处理中...' : '立即付款'}
                        </button>
                      )}
                      {(order.status === 'pending_shipping' || order.status === 'shipped') && order.trackingNumber && (
                        <div className="text-sm text-stone-600 flex items-center gap-1">
                          <Truck className="w-4 h-4" />
                          <span>物流信息</span>
                        </div>
                      )}
                      {order.status === 'shipped' && (
                        <button
                          onClick={() => handleConfirmReceive(order)}
                          disabled={actionLoading === order.id}
                          className="btn-primary px-5 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actionLoading === order.id ? '处理中...' : '确认收货'}
                        </button>
                      )}
                      {order.status === 'completed' && (
                        <button
                          onClick={() => handleReview(order)}
                          className="flex items-center gap-1 px-5 py-2 text-sm font-medium bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors"
                        >
                          <MessageSquare className="w-4 h-4" />
                          评价
                        </button>
                      )}
                    </>
                  )}

                  {isSeller(order) && (
                    <>
                      {(order.status === 'paid' || order.status === 'pending_shipping') && (
                        <button
                          onClick={() => handleShipping(order)}
                          disabled={actionLoading === order.id}
                          className="btn-primary px-5 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actionLoading === order.id ? '处理中...' : '发货'}
                        </button>
                      )}
                      {order.status === 'completed' && (
                        <button className="flex items-center gap-1 px-5 py-2 text-sm font-medium bg-stone-100 text-stone-600 rounded-lg hover:bg-stone-200 transition-colors">
                          <Star className="w-4 h-4" />
                          查看评价
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-xl shadow-md">
            <ShoppingBag className="w-16 h-16 text-amber-200 mx-auto mb-4" />
            <p className="text-amber-600 mb-2">暂无订单</p>
            <p className="text-sm text-stone-500">
              {activeTab === 'all'
                ? '您还没有任何订单记录'
                : activeTab === 'buyer'
                ? '您还没有作为买家的订单'
                : '您还没有作为卖家的订单'}
            </p>
            <button
              onClick={() => navigate('/')}
              className="mt-6 btn-primary px-6 py-2 text-sm font-medium"
            >
              去逛逛
            </button>
          </div>
        )}
      </main>

      {shippingModalOrder && (
        <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-6 text-white">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold font-serif">发货</h2>
                <button
                  onClick={() => {
                    setShippingModalOrder(null);
                    setError(null);
                  }}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="mb-4 p-4 bg-amber-50 rounded-lg">
                <h3 className="font-medium text-amber-900 mb-1 line-clamp-1">
                  {shippingModalOrder.auctionTitle}
                </h3>
                <p className="text-sm text-amber-700">
                  买家：{shippingModalOrder.buyerName}
                </p>
                {shippingModalOrder.address && (
                  <p className="text-sm text-amber-700 mt-1">
                    收货地址：{shippingModalOrder.address.name} {shippingModalOrder.address.phone}
                    <br />
                    {shippingModalOrder.address.address}
                  </p>
                )}
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-amber-900 mb-2">
                  物流单号
                </label>
                <input
                  type="text"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  className="w-full px-4 py-3 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="请输入物流单号"
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShippingModalOrder(null);
                    setError(null);
                  }}
                  className="flex-1 py-3 text-stone-600 border border-stone-200 rounded-lg font-medium hover:bg-stone-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleShippingSubmit}
                  disabled={shippingLoading}
                  className="flex-1 btn-primary py-3 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {shippingLoading ? '处理中...' : '确认发货'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reviewModal && (
        <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-6 text-white">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold font-serif">发表评价</h2>
                <button
                  onClick={() => {
                    setReviewModal(null);
                    setError(null);
                  }}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="mb-4 p-4 bg-amber-50 rounded-lg">
                <h3 className="font-medium text-amber-900 mb-1 line-clamp-1">
                  {reviewModal.auctionTitle}
                </h3>
                <p className="text-sm text-amber-700">
                  评价对象：{isBuyer(reviewModal) ? reviewModal.sellerName : reviewModal.buyerName}
                </p>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-amber-900 mb-2">
                  评分
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className="p-1 transition-transform hover:scale-110"
                    >
                      <Star
                        className={`w-8 h-8 ${
                          star <= rating
                            ? 'text-amber-400 fill-amber-400'
                            : 'text-stone-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-amber-900 mb-2">
                  评价内容
                </label>
                <textarea
                  value={reviewContent}
                  onChange={(e) => setReviewContent(e.target.value)}
                  className="w-full px-4 py-3 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
                  rows={4}
                  placeholder="分享您的交易体验..."
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setReviewModal(null);
                    setError(null);
                  }}
                  className="flex-1 py-3 text-stone-600 border border-stone-200 rounded-lg font-medium hover:bg-stone-50 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleReviewSubmit}
                  disabled={reviewLoading}
                  className="flex-1 btn-primary py-3 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reviewLoading ? '提交中...' : '提交评价'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
