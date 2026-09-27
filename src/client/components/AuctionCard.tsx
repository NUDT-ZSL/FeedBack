import { useState, useEffect } from 'react';
import { Clock, Gavel, User } from 'lucide-react';

export interface AuctionItem {
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

interface AuctionCardProps {
  item: AuctionItem;
  highlighted?: boolean;
  onBid?: (item: AuctionItem) => void;
}

function formatTimeLeft(endTime: number): { text: string; urgent: boolean } {
  const now = Date.now();
  const diff = endTime - now;

  if (diff <= 0) {
    return { text: '已结束', urgent: false };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  let text = '';
  if (days > 0) {
    text = `${days}天${hours}小时`;
  } else if (hours > 0) {
    text = `${hours}小时${minutes}分`;
  } else {
    text = `${minutes}分${seconds}秒`;
  }

  const urgent = diff < 1000 * 60 * 60;
  return { text, urgent };
}

export default function AuctionCard({ item, highlighted, onBid }: AuctionCardProps) {
  const [timeLeft, setTimeLeft] = useState(formatTimeLeft(item.endTime));
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (item.status !== 'active') return;

    const timer = setInterval(() => {
      setTimeLeft(formatTimeLeft(item.endTime));
    }, 1000);

    return () => clearInterval(timer);
  }, [item.endTime, item.status]);

  const isEnded = item.status !== 'active';
  const firstImage = item.images[0] || '';

  return (
    <div
      className={`auction-card bg-white rounded-xl overflow-hidden shadow-md ${
        highlighted ? 'ring-4 ring-green-400 ring-opacity-75' : ''
      }`}
    >
      <div className="relative">
        {!imageError && firstImage ? (
          <img
            src={firstImage}
            alt={item.title}
            className="w-full object-cover"
            onError={() => setImageError(true)}
            loading="lazy"
          />
        ) : (
          <div className="w-full bg-gradient-to-br from-amber-100 to-amber-200 flex items-center justify-center min-h-48">
            <Gavel className="w-12 h-12 text-amber-500" />
          </div>
        )}

        {item.status === 'sold' && (
          <div className="absolute top-2 right-2 bg-green-500 text-white px-3 py-1 rounded-full text-sm font-medium">
            已成交
          </div>
        )}
        {item.status === 'ended' && (
          <div className="absolute top-2 right-2 bg-stone-500 text-white px-3 py-1 rounded-full text-sm font-medium">
            已结束
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
          <div className="flex items-center text-white text-sm">
            <User className="w-4 h-4 mr-1" />
            <span className="truncate">{item.sellerName}</span>
          </div>
        </div>
      </div>

      <div className="p-4">
        <h3 className="font-semibold text-amber-900 text-lg mb-2 line-clamp-1">{item.title}</h3>
        <p className="text-stone-600 text-sm mb-4 line-clamp-2">{item.description}</p>

        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs text-stone-500 mb-1">当前出价</div>
            <div
              className={`text-xl font-bold text-amber-700 ${
                highlighted ? 'price-flash' : ''
              }`}
            >
              ¥{item.currentPrice}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-stone-500 mb-1">起拍价</div>
            <div className="text-sm text-stone-600">¥{item.startingPrice}</div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-4">
          <div className={`flex items-center text-sm ${timeLeft.urgent ? 'countdown-urgent' : 'text-amber-600'}`}>
            <Clock className="w-4 h-4 mr-1" />
            <span>{timeLeft.text}</span>
          </div>
          {item.highestBidderName && (
            <div className="text-xs text-stone-500">
              最高出价者：{item.highestBidderName}
            </div>
          )}
        </div>

        {!isEnded && onBid && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onBid(item);
            }}
            className="btn-primary w-full py-2.5 text-center"
          >
            立即出价
          </button>
        )}
        {isEnded && (
          <div className="text-center py-2.5 text-stone-500 bg-stone-50 rounded-lg">
            拍卖已结束
          </div>
        )}
      </div>
    </div>
  );
}
