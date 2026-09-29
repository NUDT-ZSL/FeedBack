import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Order,
  OrderStage,
  ORDER_STAGE_INFO,
  OrderTrackerProps,
  Product
} from '../types';
import { getProductsByIds } from '../data/products';
import toast from 'react-hot-toast';

const STAGES = [
  OrderStage.INGREDIENT_PREP,
  OrderStage.TEMPERING,
  OrderStage.DECORATION,
  OrderStage.PACKING_SHIPPING
];

function generateMockOrder(box: {
  items: { productId: string; quantity: number }[];
  greetingCard: string;
  totalPieces: number;
  estimatedPrice: number;
}): Order {
  const products = getProductsByIds(box.items.map(i => i.productId));
  return {
    id: 'CHOCO-' + Date.now().toString(36).toUpperCase(),
    box: {
      id: 'BOX-' + Math.random().toString(36).slice(2, 10),
      items: box.items,
      greetingCard: box.greetingCard,
      totalPieces: box.totalPieces,
      estimatedPrice: box.estimatedPrice,
      createdAt: new Date()
    },
    currentStage: OrderStage.INGREDIENT_PREP,
    stageProgress: 15,
    estimatedCompletionTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
    createdAt: new Date(),
    products
  };
}

function ProgressBar({
  currentStage,
  stageProgress,
  shakeStage
}: {
  currentStage: OrderStage;
  stageProgress: number;
  shakeStage: OrderStage | null;
}) {
  const currentOrder = ORDER_STAGE_INFO[currentStage].order;
  const totalPercentage = (currentOrder * 25) + (stageProgress * 0.25);

  return (
    <div className="progress-container">
      <div className="progress-track">
        <div
          className="progress-fill"
          style={{ width: `${Math.min(100, totalPercentage)}%` }}
        ></div>
        {STAGES.map((stage, idx) => {
          const info = ORDER_STAGE_INFO[stage];
          const isCompleted = info.order < currentOrder;
          const isCurrent = info.order === currentOrder;
          const isShaking = shakeStage === stage;

          return (
            <div
              key={stage}
              className={`stage-marker ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${isShaking ? 'shake' : ''}`}
              style={{ left: `${idx * 33.33}%` }}
            >
              <div className="marker-dot">
                {isCompleted ? '✓' : (idx + 1)}
              </div>
              <div className="stage-label">{info.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CountdownTimer({ targetTime }: { targetTime: Date }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = targetTime.getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('即将完成');
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(
        `${h > 0 ? h + '小时' : ''}${m}分${String(s).padStart(2, '0')}秒`
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [targetTime]);

  return <span className="countdown">{remaining}</span>;
}

export default function OrderTracker({ orderId, onBack }: OrderTrackerProps) {
  const [order, setOrder] = useState<Order | null>(null);
  const [inputId, setInputId] = useState('');
  const [shakeStage, setShakeStage] = useState<OrderStage | null>(null);
  const [imgLoaded, setImgLoaded] = useState<Record<string, boolean>>({});
  const mountedRef = useRef(true);
  const advanceRef = useRef<OrderStage | null>(null);
  const searchIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const simulateProgress = useCallback(() => {
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      setOrder(prev => {
        if (!prev) return prev;
        let nextStage = prev.currentStage;
        let nextProgress = prev.stageProgress + 4;

        if (nextProgress >= 100) {
          const currentOrder = ORDER_STAGE_INFO[prev.currentStage].order;
          if (currentOrder < STAGES.length - 1) {
            nextStage = STAGES[currentOrder + 1];
            nextProgress = 0;
            advanceRef.current = nextStage;
            setTimeout(() => {
              setShakeStage(nextStage);
              setTimeout(() => setShakeStage(null), 400);
            }, 100);
          } else {
            nextProgress = 100;
          }
        }

        return {
          ...prev,
          currentStage: nextStage,
          stageProgress: nextProgress
        };
      });
    }, 800);
    return interval;
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (searchIntervalRef.current !== undefined) {
        clearInterval(searchIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    if (orderId) {
      const existingRaw = sessionStorage.getItem('pending_order');
      if (existingRaw) {
        try {
          const data = JSON.parse(existingRaw);
          const loaded: Order = {
            ...data,
            createdAt: new Date(data.createdAt),
            estimatedCompletionTime: new Date(data.estimatedCompletionTime),
            box: {
              ...data.box,
              createdAt: new Date(data.box.createdAt)
            }
          };
          setOrder(loaded);
          intervalId = simulateProgress();
          return () => {
            if (intervalId !== undefined) clearInterval(intervalId);
          };
        } catch {
          // ignore
        }
      }
      const mock = generateMockOrder({
        items: [
          { productId: 'prod_000001', quantity: 2 },
          { productId: 'prod_000002', quantity: 1 },
          { productId: 'prod_000003', quantity: 3 }
        ],
        greetingCard: orderId.includes('T') ? '感谢您的信任与支持' : '愿每一口都是甜蜜时光',
        totalPieces: 6,
        estimatedPrice: 198.00
      });
      setOrder(mock);
      intervalId = simulateProgress();
    }
    return () => {
      if (intervalId !== undefined) clearInterval(intervalId);
    };
  }, [orderId, simulateProgress]);

  const handleSearch = () => {
    if (!inputId.trim()) {
      toast.error('请输入订单号', { icon: '📝' });
      return;
    }
    const existingRaw = sessionStorage.getItem('pending_order');
    if (existingRaw) {
      try {
        const data = JSON.parse(existingRaw);
        if (data.id && inputId.trim().toUpperCase().includes(data.id.slice(-6))) {
          const loaded: Order = {
            ...data,
            createdAt: new Date(data.createdAt),
            estimatedCompletionTime: new Date(data.estimatedCompletionTime),
            box: {
              ...data.box,
              createdAt: new Date(data.box.createdAt)
            }
          };
          setOrder(loaded);
          if (searchIntervalRef.current !== undefined) {
            clearInterval(searchIntervalRef.current);
          }
          searchIntervalRef.current = simulateProgress();
          toast.success('订单查询成功！', { icon: '✅' });
          return;
        }
      } catch {
        // ignore
      }
    }
    toast.error('未找到该订单，请检查订单号', { icon: '❌' });
  };

  if (!order) {
    return (
      <div className="tracker-page fade-in">
        {onBack && (
          <button className="back-btn" onClick={onBack}>
            ← 返回首页
          </button>
        )}
        <div className="lookup-container">
          <div className="lookup-hero">
            <div className="lookup-icon">📦</div>
            <h1 className="lookup-title">订单追踪</h1>
            <p className="lookup-subtitle">输入您的订单号，实时查看巧克力制作进度</p>
          </div>
          <div className="lookup-form">
            <input
              type="text"
              className="lookup-input"
              placeholder="请输入订单号，如 CHOCO-XXXXXX"
              value={inputId}
              onChange={e => setInputId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <button className="lookup-btn" onClick={handleSearch}>
              🔍 查询订单
            </button>
          </div>
          <div className="lookup-hints">
            <p>💡 小提示：订单号已在下单成功时发送给您</p>
          </div>
        </div>
      </div>
    );
  }

  void advanceRef;

  return (
    <div className="tracker-page fade-in">
      {onBack && (
        <button className="back-btn" onClick={onBack}>
          ← 返回首页
        </button>
      )}

      <div className="order-status-header">
        <div className="status-icon-wrap">
          <div className="status-icon">🍫</div>
        </div>
        <div className="status-info">
          <h1 className="order-id-display">订单号：{order.id}</h1>
          <p className="order-date">
            下单时间：{order.createdAt.toLocaleString('zh-CN')}
          </p>
          <div className="eta-display">
            ⏰ 预计完成：<CountdownTimer targetTime={order.estimatedCompletionTime} />
          </div>
        </div>
        <div className="status-badge current-badge">
          {ORDER_STAGE_INFO[order.currentStage].label} 中...
        </div>
      </div>

      <div className="progress-section">
        <ProgressBar
          currentStage={order.currentStage}
          stageProgress={order.stageProgress}
          shakeStage={shakeStage}
        />
        <div className="stage-descriptions">
          {STAGES.map(stage => {
            const info = ORDER_STAGE_INFO[stage];
            const isCompleted = info.order < ORDER_STAGE_INFO[order.currentStage].order;
            const isCurrent = info.order === ORDER_STAGE_INFO[order.currentStage].order;
            return (
              <div
                key={stage}
                className={`stage-desc ${isCompleted ? 'done' : ''} ${isCurrent ? 'active' : ''}`}
              >
                <div className={`status-dot ${isCompleted ? 'done' : ''} ${isCurrent ? 'active' : ''}`}></div>
                <div className="stage-text">
                  <strong>{info.label}</strong>
                  <span className="stage-sub">
                    {isCompleted
                      ? '已完成 ✓'
                      : isCurrent
                      ? `进度 ${order.stageProgress}%`
                      : '等待中...'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="order-details-grid">
        <div className="details-card products-card">
          <h3 className="details-title">🎁 礼盒内容</h3>
          <div className="order-products">
            {order.products.map((prod: Product, idx: number) => {
              const item = order.box.items.find(i => i.productId === prod.id);
              const qty = item?.quantity || 1;
              return (
                <div key={prod.id} className="order-product" style={{ animationDelay: `${idx * 50}ms` }}>
                  <div className="op-image-wrap">
                    {!imgLoaded[prod.id] && <div className="op-skeleton">🍫</div>}
                    <img
                      src={prod.imageUrl}
                      alt={prod.name}
                      className={`op-image ${imgLoaded[prod.id] ? 'loaded' : ''}`}
                      loading="lazy"
                      onLoad={() => setImgLoaded(m => ({ ...m, [prod.id]: true }))}
                    />
                  </div>
                  <div className="op-info">
                    <h4 className="op-name">{prod.name}</h4>
                    <p className="op-origin">📍 {prod.origin} · {prod.cocoaContent}%</p>
                  </div>
                  <div className="op-qty">×{qty}</div>
                  <div className="op-price">¥{(prod.price * qty).toFixed(2)}</div>
                </div>
              );
            })}
          </div>
          <div className="order-total-row">
            <span>共 {order.box.totalPieces} 块</span>
            <span className="order-total">合计：¥{order.box.estimatedPrice.toFixed(2)}</span>
          </div>
        </div>

        <div className="details-card card-message-card">
          <h3 className="details-title">💌 贺卡内容</h3>
          <div className="message-preview">
            {order.box.greetingCard ? (
              <>
                <p className="handwriting-message">{order.box.greetingCard}</p>
                <div className="message-sign">— 您的心意已送达</div>
              </>
            ) : (
              <p className="no-message">（未填写贺卡留言）</p>
            )}
          </div>
          <div className="order-meta">
            <div className="meta-item">
              <span className="meta-label">礼盒编号</span>
              <span className="meta-value">{order.box.id.toUpperCase()}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">款式数量</span>
              <span className="meta-value">{order.products.length} 款</span>
            </div>
          </div>
        </div>
      </div>

      <div className="share-tips">
        <span className="tip-icon">💡</span>
        <p>您可以复制订单号分享给亲友，让他们也能见证这份甜蜜的诞生过程 ✨</p>
        <button
          className="copy-btn"
          onClick={() => {
            navigator.clipboard?.writeText(order.id).then(() => {
              toast.success('订单号已复制', { icon: '📋' });
            }).catch(() => {
              toast.success(order.id, { icon: '📋 订单号：' });
            });
          }}
        >
          📋 复制订单号
        </button>
      </div>
    </div>
  );
}

export { generateMockOrder };
