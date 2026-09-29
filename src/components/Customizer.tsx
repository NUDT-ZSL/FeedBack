import { useState, useMemo } from 'react';
import { CustomizerProps } from '../types';
import toast from 'react-hot-toast';

function QuantitySelector({
  value,
  onChange,
  disabled
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="quantity-selector">
      <button
        className="qty-btn minus"
        onClick={() => onChange(Math.max(1, value - 1))}
        disabled={disabled || value <= 1}
      >
        −
      </button>
      <span className="qty-value">{value}</span>
      <button
        className="qty-btn plus"
        onClick={() => onChange(Math.min(4, value + 1))}
        disabled={disabled || value >= 4}
      >
        +
      </button>
    </div>
  );
}

function EmptyBox() {
  return (
    <div className="empty-box-state">
      <div className="empty-box-illustration">
        <div className="box-visual">
          <div className="box-lid"></div>
          <div className="box-body">
            <div className="choco-spot s1">🍫</div>
            <div className="choco-spot s2">🍫</div>
            <div className="choco-spot s3">🍫</div>
          </div>
        </div>
      </div>
      <h3 className="empty-title">礼盒是空的</h3>
      <p className="empty-guide">从左侧目录选择心仪的巧克力<br/>最多可选 6 款，每款 1-4 块</p>
    </div>
  );
}

export default function Customizer({
  selectedProducts,
  onRemoveProduct,
  onUpdateQuantity,
  quantities,
  onConfirm,
  onBack
}: CustomizerProps) {
  const [greetingCard, setGreetingCard] = useState('');
  const [imgLoadedMap, setImgLoadedMap] = useState<Record<string, boolean>>({});

  const { totalPieces, avgPrice, estimatedPrice } = useMemo(() => {
    let pieces = 0;
    let totalPrice = 0;
    selectedProducts.forEach(p => {
      const q = quantities[p.id] || 1;
      pieces += q;
      totalPrice += p.price * q;
    });
    const avg = selectedProducts.length > 0 ? totalPrice / pieces : 0;
    return {
      totalPieces: pieces,
      avgPrice: avg,
      estimatedPrice: totalPrice
    };
  }, [selectedProducts, quantities]);

  const handleConfirm = () => {
    if (selectedProducts.length === 0) {
      toast.error('请先选择至少一款巧克力', { icon: '⚠️' });
      return;
    }
    onConfirm(greetingCard.trim());
  };

  const boxFull = selectedProducts.length >= 6;

  return (
    <div className="customizer-page fade-in">
      <button className="back-btn" onClick={onBack}>
        ← 返回目录
      </button>

      <div className="customizer-title-bar">
        <h1 className="customizer-title">定制您的专属礼盒</h1>
        <div className={`progress-badge ${boxFull ? 'full' : ''}`}>
          {selectedProducts.length}/6 款 · 共 {totalPieces} 块
        </div>
      </div>

      <div className="customizer-layout">
        <div className="selected-products-panel">
          {selectedProducts.length > 0 ? (
            <>
              <div className="panel-header">
                <h2 className="panel-title">🎁 已选清单</h2>
                {boxFull && <span className="full-hint">礼盒已满</span>}
              </div>
              <div className="selected-list">
                {selectedProducts.map((product, idx) => {
                  const qty = quantities[product.id] || 1;
                  return (
                    <div
                      key={product.id}
                      className="selected-item"
                      style={{ animationDelay: `${idx * 60}ms` }}
                    >
                      <div className="item-order">{idx + 1}</div>
                      <div className="item-image-wrap">
                        {!imgLoadedMap[product.id] && <div className="item-skeleton">🍫</div>}
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className={`item-image ${imgLoadedMap[product.id] ? 'loaded' : ''}`}
                          loading="lazy"
                          onLoad={() => setImgLoadedMap(m => ({ ...m, [product.id]: true }))}
                        />
                      </div>
                      <div className="item-info">
                        <h4 className="item-name">{product.name}</h4>
                        <p className="item-origin">📍 {product.origin} · {product.cocoaContent}%</p>
                        <p className="item-price">¥{product.price.toFixed(2)} × {qty}</p>
                      </div>
                      <div className="item-controls">
                        <QuantitySelector
                          value={qty}
                          onChange={v => onUpdateQuantity(product.id, v)}
                        />
                        <button
                          className="remove-btn"
                          onClick={() => onRemoveProduct(product.id)}
                          aria-label="删除"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="item-subtotal">
                        小计 ¥{(product.price * qty).toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyBox />
          )}
        </div>

        <div className="config-panel">
          <div className="card-section">
            <h3 className="section-title">💌 贺卡留言</h3>
            <p className="section-hint">请输入20字以内的祝福语</p>
            <div className="input-wrap">
              <input
                type="text"
                className="greeting-input"
                placeholder="写下您的祝福..."
                value={greetingCard}
                maxLength={20}
                onChange={e => setGreetingCard(e.target.value)}
              />
              <span className="char-count">{greetingCard.length}/20</span>
            </div>
            <div className="card-preview">
              <div className="card-paper">
                <div className="card-decoration top"></div>
                <div className="card-content-preview">
                  {greetingCard ? (
                    <p className="handwriting-text">{greetingCard}</p>
                  ) : (
                    <p className="card-placeholder">预览区域<br/>您的祝福将以优雅手写体呈现</p>
                  )}
                </div>
                <div className="card-decoration bottom"></div>
                <div className="card-signature">— CocoArt 精品巧克力</div>
              </div>
            </div>
          </div>

          <div className="card-section summary-section">
            <h3 className="section-title">📋 订单摘要</h3>
            <div className="summary-rows">
              <div className="summary-row">
                <span>款式数量</span>
                <span className="summary-value">{selectedProducts.length} 款</span>
              </div>
              <div className="summary-row">
                <span>总块数</span>
                <span className="summary-value">{totalPieces} 块</span>
              </div>
              <div className="summary-row">
                <span>平均单价</span>
                <span className="summary-value">¥{avgPrice.toFixed(2)}/块</span>
              </div>
              <div className="summary-row highlight">
                <span>礼盒盒身</span>
                <span className="summary-value">免费精美礼盒</span>
              </div>
              <div className="divider"></div>
              <div className="summary-row total">
                <span>预估总价</span>
                <span className="total-price">¥{estimatedPrice.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <button
            className={`confirm-btn ${selectedProducts.length === 0 ? 'disabled' : ''}`}
            onClick={handleConfirm}
            disabled={selectedProducts.length === 0}
          >
            <span className="btn-icon">✨</span>
            确认订单并生成
          </button>
        </div>
      </div>
    </div>
  );
}
