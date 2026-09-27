import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  User,
  Clock,
  Gavel,
  Star,
  AlertCircle,
  ArrowLeft,
  Crown,
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import Countdown from '../components/Countdown';

const API_BASE = '/api';

interface AuctionItem {
  id: string;
  sellerId: string;
  sellerName: string;
  title: string;
  description: string;
  images: string[];
  startingPrice: number;
  currentPrice: number;
  highestBidderId?: string;
  highestBidderName?: string;
  endTime: number;
  status: 'active' | 'ended' | 'sold';
  createdAt: number;
}

interface Bid {
  id: string;
  auctionId: string;
  bidderId: string;
  bidderName: string;
  amount: number;
  timestamp: number;
}

interface Review {
  id: string;
  orderId: string;
  auctionId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerRole: 'buyer' | 'seller';
  targetUserId: string;
  rating: number;
  content: string;
  createdAt: number;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) {
    return '刚刚';
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`;
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`;
  } else if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)}天前`;
  } else {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}

function renderStars(rating: number) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-4 h-4 ${
            star <= rating
              ? 'text-amber-500 fill-amber-500'
              : 'text-stone-300'
          }`}
        />
      ))}
    </div>
  );
}

export default function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const [auction, setAuction] = useState<AuctionItem | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [priceFlash, setPriceFlash] = useState(false);
  const [bidAmount, setBidAmount] = useState('');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bidLoading, setBidLoading] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);

  const fetchAuction = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/auctions/${id}`);
      const data = await res.json();
      if (data.success) {
        setAuction(data.auction);
        if (bidAmount === '') {
          setBidAmount(String(data.auction.currentPrice + 10));
        }
      } else {
        setError(data.error || '获取作品详情失败');
      }
    } catch (err) {
      console.error('Failed to fetch auction:', err);
    }
  }, [id, bidAmount]);

  const fetchBids = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/auctions/${id}/bids`);
      const data = await res.json();
      if (data.success) {
        setBids(data.bids);
      }
    } catch (err) {
      console.error('Failed to fetch bids:', err);
    }
  }, [id]);

  const fetchReviews = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/auctions/${id}/reviews`);
      const data = await res.json();
      if (data.success) {
        setReviews(data.reviews);
      }
    } catch (err) {
      console.error('Failed to fetch reviews:', err);
    }
  }, [id]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchAuction(), fetchBids(), fetchReviews()]);
    setLoading(false);
  }, [fetchAuction, fetchBids, fetchReviews]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchAuction();
      fetchBids();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchAuction, fetchBids]);

  const handleBid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !auction || !id) return;

    setBidError(null);
    setBidLoading(true);

    try {
      const amount = Number(bidAmount);
      if (amount <= auction.currentPrice) {
        setBidError('出价必须高于当前价格');
        setBidLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/auctions/${id}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bidderId: user.id,
          amount,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setPriceFlash(true);
        setTimeout(() => setPriceFlash(false), 2000);
        setBidAmount(String(amount + 10));
        fetchAuction();
        fetchBids();
      } else {
        setBidError(data.error || '出价失败');
      }
    } catch (err) {
      setBidError('网络错误，请稍后重试');
    } finally {
      setBidLoading(false);
    }
  };

  const prevImage = () => {
    if (!auction) return;
    setCurrentImageIndex((prev) =>
      prev === 0 ? auction.images.length - 1 : prev - 1
    );
  };

  const nextImage = () => {
    if (!auction) return;
    setCurrentImageIndex((prev) =>
      prev === auction.images.length - 1 ? 0 : prev + 1
    );
  };

  const goToImage = (index: number) => {
    setCurrentImageIndex(index);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-amber-700 text-lg">加载中...</div>
      </div>
    );
  }

  if (error || !auction) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-amber-400 mx-auto mb-4" />
          <p className="text-amber-700 text-lg mb-4">
            {error || '作品不存在'}
          </p>
          <button
            onClick={() => navigate('/')}
            className="btn-primary px-6 py-2 inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            返回首页
          </button>
        </div>
      </div>
    );
  }

  const isEnded = auction.status !== 'active';

  return (
    <div className="min-h-screen pb-8">
      <header className="bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 hover:text-amber-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>返回</span>
          </button>
          <h1 className="text-xl font-bold font-serif">作品详情</h1>
          <div className="w-16"></div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="relative bg-white rounded-2xl overflow-hidden shadow-lg">
              <div className="relative aspect-square">
                {auction.images.length > 0 && (
                  <img
                    src={auction.images[currentImageIndex]}
                    alt={auction.title}
                    className="w-full h-full object-cover"
                  />
                )}

                {auction.status === 'sold' && (
                  <div className="absolute top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-full font-medium">
                    已成交
                  </div>
                )}
                {auction.status === 'ended' && (
                  <div className="absolute top-4 right-4 bg-stone-500 text-white px-4 py-2 rounded-full font-medium">
                    已结束
                  </div>
                )}

                {auction.images.length > 1 && (
                  <>
                    <button
                      onClick={prevImage}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 hover:bg-white rounded-full flex items-center justify-center text-amber-700 shadow-md transition-all"
                    >
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button
                      onClick={nextImage}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 hover:bg-white rounded-full flex items-center justify-center text-amber-700 shadow-md transition-all"
                    >
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  </>
                )}
              </div>

              {auction.images.length > 1 && (
                <div className="flex justify-center gap-2 py-3 bg-stone-50">
                  {auction.images.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => goToImage(index)}
                      className={`w-2.5 h-2.5 rounded-full transition-all ${
                        index === currentImageIndex
                          ? 'bg-amber-500 w-6'
                          : 'bg-stone-300 hover:bg-stone-400'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h1 className="text-3xl font-bold font-serif text-amber-900 mb-3">
                {auction.title}
              </h1>

              <div className="flex items-center gap-2 text-stone-600 mb-4">
                <User className="w-5 h-5 text-amber-500" />
                <span className="font-medium">{auction.sellerName}</span>
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  卖家
                </span>
              </div>

              <p className="text-stone-600 leading-relaxed mb-6">
                {auction.description}
              </p>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-amber-50 rounded-xl p-4">
                  <div className="text-sm text-amber-700 mb-1">起拍价</div>
                  <div className="text-lg font-semibold text-amber-900">
                    ¥{auction.startingPrice}
                  </div>
                </div>
                <div className="bg-green-50 rounded-xl p-4">
                  <div className="text-sm text-green-700 mb-1">当前价格</div>
                  <div
                    className={`text-2xl font-bold text-green-600 ${
                      priceFlash ? 'price-flash' : ''
                    }`}
                  >
                    ¥{auction.currentPrice}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 p-4 bg-stone-50 rounded-xl">
                <Clock className="w-5 h-5 text-amber-600" />
                <span className="text-stone-600">剩余时间：</span>
                <Countdown
                  endTime={auction.endTime}
                  className="font-semibold text-amber-700"
                />
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold font-serif text-amber-900 mb-4 flex items-center gap-2">
                <Gavel className="w-5 h-5" />
                出价竞拍
              </h2>

              {!user && (
                <div className="p-4 bg-amber-50 rounded-xl text-center mb-4">
                  <p className="text-amber-700 mb-3">请先登录后再出价</p>
                  <button className="btn-primary px-6 py-2">
                    登录 / 注册
                  </button>
                </div>
              )}

              {user && !isEnded && (
                <form onSubmit={handleBid}>
                  {bidError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-600 text-sm">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      {bidError}
                    </div>
                  )}

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-amber-900 mb-2">
                      出价金额（元）
                    </label>
                    <input
                      type="number"
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      min={auction.currentPrice + 1}
                      step="1"
                      className="w-full px-4 py-3 text-xl font-bold border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                      placeholder="请输入出价金额"
                      required
                    />
                    <p className="mt-1 text-xs text-stone-500">
                      出价必须高于当前价格 ¥{auction.currentPrice}
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={bidLoading}
                    className="btn-primary w-full py-3 text-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {bidLoading ? '出价中...' : '确认出价'}
                  </button>
                </form>
              )}

              {isEnded && (
                <div className="text-center py-6 text-stone-500 bg-stone-50 rounded-xl">
                  <Gavel className="w-10 h-10 mx-auto mb-2 text-stone-400" />
                  <p>拍卖已结束</p>
                </div>
              )}

              {auction.highestBidderName && (
                <div className="mt-4 p-3 bg-amber-50 rounded-xl flex items-center gap-3">
                  <Crown className="w-6 h-6 text-amber-500" />
                  <div>
                    <div className="text-xs text-amber-700">最高出价者</div>
                    <div className="font-medium text-amber-900">
                      {auction.highestBidderName}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h2 className="text-xl font-bold font-serif text-amber-900 mb-4">
                出价记录
              </h2>

              {bids.length > 0 ? (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {bids.map((bid, index) => {
                    const isHighest = index === 0;
                    return (
                      <div
                        key={bid.id}
                        className={`flex items-center justify-between p-3 rounded-xl transition-all ${
                          isHighest
                            ? 'bg-amber-50 border border-amber-200'
                            : 'bg-stone-50 hover:bg-stone-100'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center ${
                              isHighest
                                ? 'bg-amber-500 text-white'
                                : 'bg-stone-200 text-stone-600'
                            }`}
                          >
                            {isHighest ? (
                              <Crown className="w-5 h-5" />
                            ) : (
                              <User className="w-5 h-5" />
                            )}
                          </div>
                          <div>
                            <div className="font-medium text-amber-900 flex items-center gap-2">
                              {bid.bidderName}
                              {isHighest && (
                                <span className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded-full">
                                  最高
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-stone-500">
                              {formatTime(bid.timestamp)}
                            </div>
                          </div>
                        </div>
                        <div
                          className={`font-bold ${
                            isHighest ? 'text-amber-600 text-lg' : 'text-stone-700'
                          }`}
                        >
                          ¥{bid.amount}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-stone-500">
                  <Gavel className="w-10 h-10 mx-auto mb-2 text-stone-300" />
                  <p>暂无出价记录</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-xl font-bold font-serif text-amber-900 mb-6">
            用户评价
          </h2>

          {reviews.length > 0 ? (
            <div className="space-y-4">
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className="p-4 bg-stone-50 rounded-xl"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center">
                        <User className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-medium text-amber-900 flex items-center gap-2">
                          {review.reviewerName}
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              review.reviewerRole === 'buyer'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {review.reviewerRole === 'buyer' ? '买家' : '卖家'}
                          </span>
                        </div>
                        <div className="text-xs text-stone-500">
                          {formatTime(review.createdAt)}
                        </div>
                      </div>
                    </div>
                    {renderStars(review.rating)}
                  </div>
                  <p className="text-stone-600 leading-relaxed">
                    {review.content}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-stone-500">
              <Star className="w-12 h-12 mx-auto mb-3 text-stone-300" />
              <p>暂无评价</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
