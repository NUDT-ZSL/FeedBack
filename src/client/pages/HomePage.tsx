import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gavel, Plus, User, LogOut, ShoppingBag, X, Image as ImageIcon, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import AuctionCard, { type AuctionItem } from '../components/AuctionCard';

const API_BASE = '/api';

export default function HomePage() {
  const navigate = useNavigate();
  const { user, login, logout } = useAuthStore();
  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<'seller' | 'buyer'>('buyer');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>(['']);
  const [startingPrice, setStartingPrice] = useState('');
  const [endTime, setEndTime] = useState('');
  const [bidAmount, setBidAmount] = useState<string>('');
  const [selectedAuction, setSelectedAuction] = useState<AuctionItem | null>(null);
  const [showBidModal, setShowBidModal] = useState(false);

  const fetchAuctions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auctions`);
      const data = await res.json();
      if (data.success) {
        setAuctions(data.auctions);
      }
    } catch (err) {
      console.error('Failed to fetch auctions:', err);
    }
  }, []);

  useEffect(() => {
    fetchAuctions();
    const interval = setInterval(fetchAuctions, 5000);
    return () => clearInterval(interval);
  }, [fetchAuctions]);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = authMode === 'login' ? '/users/login' : '/users/register';
      const body = authMode === 'login'
        ? { username, password }
        : { username, password, nickname, role };

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        login(data.user);
        setShowAuthModal(false);
        setUsername('');
        setPassword('');
        setNickname('');
        setRole('buyer');
      } else {
        setError(data.error || '操作失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || user.role !== 'seller') return;

    setError(null);
    setLoading(true);

    try {
      const validImages = images.filter((img) => img.trim() !== '');
      if (validImages.length === 0) {
        setError('请至少添加一张图片');
        setLoading(false);
        return;
      }

      const endTimeMs = new Date(endTime).getTime();
      if (endTimeMs <= Date.now()) {
        setError('拍卖截止时间必须晚于当前时间');
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/auctions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId: user.id,
          title,
          description,
          images: validImages,
          startingPrice: Number(startingPrice),
          endTime: endTimeMs,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setShowPublishModal(false);
        setTitle('');
        setDescription('');
        setImages(['']);
        setStartingPrice('');
        setEndTime('');
        fetchAuctions();
      } else {
        setError(data.error || '发布失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleBidClick = (item: AuctionItem) => {
    navigate(`/auction/${item.id}`);
  };

  const handleCardClick = (item: AuctionItem) => {
    navigate(`/auction/${item.id}`);
  };

  const handleBidSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedAuction) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/auctions/${selectedAuction.id}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidderId: user.id,
          amount: Number(bidAmount),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setHighlightedId(selectedAuction.id);
        setTimeout(() => setHighlightedId(null), 2000);
        setShowBidModal(false);
        setSelectedAuction(null);
        setBidAmount('');
        fetchAuctions();
      } else {
        setError(data.error || '出价失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const addImageInput = () => {
    setImages([...images, '']);
  };

  const removeImageInput = (index: number) => {
    if (images.length > 1) {
      setImages(images.filter((_, i) => i !== index));
    }
  };

  const updateImage = (index: number, value: string) => {
    const newImages = [...images];
    newImages[index] = value;
    setImages(newImages);
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="min-h-screen">
      <header className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gavel className="w-8 h-8" />
            <h1 className="text-xl font-bold font-serif">匠心拍卖</h1>
          </div>

          <nav className="flex items-center gap-3">
            {user ? (
              <>
                <div className="flex items-center gap-2 text-amber-100">
                  <User className="w-5 h-5" />
                  <span className="hidden sm:inline">{user.nickname}</span>
                  <span className="text-xs bg-amber-800 px-2 py-0.5 rounded-full">
                    {user.role === 'seller' ? '卖家' : '买家'}
                  </span>
                </div>
                {user.role === 'seller' && (
                  <button
                    onClick={() => setShowPublishModal(true)}
                    className="flex items-center gap-1 bg-white text-amber-700 px-3 py-1.5 rounded-lg font-medium hover:bg-amber-50 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">发布作品</span>
                  </button>
                )}
                <button
                  onClick={() => navigate('/orders')}
                  className="flex items-center gap-1 text-amber-100 hover:text-white transition-colors"
                  title="订单管理"
                >
                  <ShoppingBag className="w-5 h-5" />
                  <span className="hidden sm:inline">订单</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1 text-amber-100 hover:text-white transition-colors"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="hidden sm:inline">退出</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowAuthModal(true)}
                className="bg-white text-amber-700 px-4 py-1.5 rounded-lg font-medium hover:bg-amber-50 transition-colors"
              >
                登录 / 注册
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-amber-900 font-serif mb-2">探索匠心之作</h2>
          <p className="text-amber-700">发现传统工艺的独特魅力，参与竞拍收藏心仪之物</p>
        </div>

        {auctions.length > 0 ? (
          <div className="masonry-grid">
            {auctions.map((item) => (
              <div
                key={item.id}
                className="masonry-item cursor-pointer"
                onClick={() => handleCardClick(item)}
              >
                <AuctionCard
                  item={item}
                  highlighted={highlightedId === item.id}
                  onBid={handleBidClick}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Gavel className="w-16 h-16 text-amber-300 mx-auto mb-4" />
            <p className="text-amber-600">暂无拍卖作品</p>
          </div>
        )}
      </main>

      {showAuthModal && (
        <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-6 text-white">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold font-serif">
                  {authMode === 'login' ? '欢迎回来' : '加入匠心'}
                </h2>
                <button
                  onClick={() => {
                    setShowAuthModal(false);
                    setError(null);
                  }}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-amber-100 mt-1">
                {authMode === 'login' ? '登录您的账户' : '创建新账户'}
              </p>
            </div>

            <form onSubmit={handleAuthSubmit} className="p-6">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              {authMode === 'register' && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-amber-900 mb-1">
                      昵称
                    </label>
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="w-full px-4 py-2.5 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      placeholder="请输入昵称"
                      required
                    />
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-amber-900 mb-1">
                      角色
                    </label>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setRole('buyer')}
                        className={`flex-1 py-2.5 rounded-lg border-2 transition-all ${
                          role === 'buyer'
                            ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-stone-200 text-stone-600 hover:border-amber-300'
                        }`}
                      >
                        买家
                      </button>
                      <button
                        type="button"
                        onClick={() => setRole('seller')}
                        className={`flex-1 py-2.5 rounded-lg border-2 transition-all ${
                          role === 'seller'
                            ? 'border-amber-500 bg-amber-50 text-amber-700'
                            : 'border-stone-200 text-stone-600 hover:border-amber-300'
                        }`}
                      >
                        卖家
                      </button>
                    </div>
                  </div>
                </>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-amber-900 mb-1">
                  用户名
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-2.5 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="请输入用户名"
                  required
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-amber-900 mb-1">
                  密码
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="请输入密码"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '处理中...' : authMode === 'login' ? '登录' : '注册'}
              </button>

              <div className="mt-4 text-center text-sm text-stone-600">
                {authMode === 'login' ? (
                  <span>
                    还没有账户？{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('register');
                        setError(null);
                      }}
                      className="text-amber-600 hover:text-amber-700 font-medium"
                    >
                      立即注册
                    </button>
                  </span>
                ) : (
                  <span>
                    已有账户？{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode('login');
                        setError(null);
                      }}
                      className="text-amber-600 hover:text-amber-700 font-medium"
                    >
                      去登录
                    </button>
                  </span>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {showPublishModal && (
        <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-6 text-white sticky top-0">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold font-serif">发布拍卖作品</h2>
                <button
                  onClick={() => {
                    setShowPublishModal(false);
                    setError(null);
                  }}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <form onSubmit={handlePublish} className="p-6">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-amber-900 mb-1">
                  作品名称
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  placeholder="请输入作品名称"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-amber-900 mb-1">
                  作品描述
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-4 py-2.5 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
                  rows={4}
                  placeholder="请详细描述作品的工艺、材质、尺寸等信息"
                  required
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-amber-900 mb-2">
                  作品图片
                </label>
                {images.map((img, index) => (
                  <div key={index} className="flex gap-2 mb-2">
                    <div className="flex-1 relative">
                      <ImageIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-amber-400" />
                      <input
                        type="url"
                        value={img}
                        onChange={(e) => updateImage(index, e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                        placeholder="图片URL"
                      />
                    </div>
                    {images.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeImageInput(index)}
                        className="px-3 py-2 text-stone-400 hover:text-red-500 transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addImageInput}
                  className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  添加更多图片
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-amber-900 mb-1">
                    起拍价（元）
                  </label>
                  <input
                    type="number"
                    value={startingPrice}
                    onChange={(e) => setStartingPrice(e.target.value)}
                    min="1"
                    step="1"
                    className="w-full px-4 py-2.5 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-amber-900 mb-1">
                    截止时间
                  </label>
                  <input
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-4 py-2.5 border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '发布中...' : '发布拍卖'}
              </button>
            </form>
          </div>
        </div>
      )}

      {showBidModal && selectedAuction && (
        <div className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-6 text-white">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold font-serif">出价竞拍</h2>
                <button
                  onClick={() => {
                    setShowBidModal(false);
                    setError(null);
                  }}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <form onSubmit={handleBidSubmit} className="p-6">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}

              <div className="mb-4 p-4 bg-amber-50 rounded-lg">
                <h3 className="font-medium text-amber-900 mb-1">{selectedAuction.title}</h3>
                <p className="text-sm text-amber-700">
                  当前价格：<span className="font-bold text-xl">¥{selectedAuction.currentPrice}</span>
                </p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-amber-900 mb-1">
                  出价金额（元）
                </label>
                <input
                  type="number"
                  value={bidAmount}
                  onChange={(e) => setBidAmount(e.target.value)}
                  min={selectedAuction.currentPrice + 1}
                  step="1"
                  className="w-full px-4 py-3 text-xl font-bold border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  required
                />
                <p className="mt-1 text-xs text-stone-500">
                  出价必须高于当前价格 ¥{selectedAuction.currentPrice}
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '出价中...' : '确认出价'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
