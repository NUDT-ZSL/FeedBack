import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { artworkApi, orderApi } from './api';
import { Artwork } from './types';
import { useToast } from './ToastContext';
import { useCart } from './CartContext';

const ArtDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { addToCart } = useCart();
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [orderForm, setOrderForm] = useState({
    buyerName: '',
    buyerPhone: '',
    buyerAddress: '',
  });
  const [showOrderForm, setShowOrderForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchArtwork = async () => {
      if (!id) return;
      try {
        const response = await artworkApi.getArtworkById(id);
        if (response.code === 200 && response.data) {
          setArtwork(response.data);
        } else {
          showToast(response.message);
        }
      } catch (error) {
        showToast('获取艺术品详情失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    };
    fetchArtwork();
  }, [id, showToast]);

  const handleAddToCart = () => {
    if (!artwork) return;
    addToCart({
      artworkId: artwork.id,
      artworkTitle: artwork.title,
      artworkPrice: artwork.price,
      quantity,
      thumbnail: artwork.thumbnail,
    });
    showToast(`已添加 ${quantity} 件 "${artwork.title}" 到购物车`, 'success');
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artwork || !id) return;
    setSubmitting(true);
    try {
      const response = await orderApi.createOrder({
        artworkId: id,
        quantity,
        ...orderForm,
      });
      if (response.code === 201 && response.data) {
        showToast('订单提交成功！', 'success');
        navigate(`/orders/${response.data.id}`);
      } else {
        showToast(response.message);
      }
    } catch (error: any) {
      showToast(error.response?.data?.message || '订单提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  if (!artwork) {
    return (
      <div className="error-container">
        <p>艺术品不存在</p>
        <button className="btn-primary" onClick={() => navigate('/')}>
          返回列表
        </button>
      </div>
    );
  }

  const stockPercentage = (artwork.stock / artwork.limitedEdition) * 100;
  const isSoldOut = artwork.stock === 0;
  const soldCount = artwork.limitedEdition - artwork.stock;

  return (
    <div className="detail-page">
      <button className="back-btn" onClick={() => navigate('/')}>
        ← 返回列表
      </button>

      <div className="detail-container">
        <div className="detail-image">
          <img src={artwork.image} alt={artwork.title} />
        </div>

        <div className="detail-info">
          <div className="artist-badge">艺术家：{artwork.artistName}</div>
          <h1 className="detail-title">{artwork.title}</h1>
          <p className="detail-description">{artwork.description}</p>

          <div className="edition-info">
            <div className="edition-range">
              <span>限量编号</span>
              <strong>
                {soldCount + 1}/{artwork.limitedEdition} - {artwork.limitedEdition}/{artwork.limitedEdition}
              </strong>
            </div>

            <div className="stock-bar-container">
              <div className="stock-bar-label">
                <span>库存进度</span>
                <span>
                  {artwork.stock} / {artwork.limitedEdition}
                </span>
              </div>
              <div className="stock-bar-bg">
                <div
                  className="stock-bar-fill"
                  style={{
                    width: `${stockPercentage}%`,
                    background: `linear-gradient(to right, #4caf50, #ff9800 ${50}%, #f44336)`,
                  }}
                ></div>
              </div>
            </div>
          </div>

          <div className="purchase-section">
            <div className="price-section">
              <span className="price-label">价格</span>
              <span className="price-value">¥{artwork.price}</span>
            </div>

            <div className="quantity-section">
              <label>数量</label>
              <div className="quantity-selector">
                <button
                  className="qty-btn"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  disabled={isSoldOut}
                >
                  -
                </button>
                <span className="qty-value">{quantity}</span>
                <button
                  className="qty-btn"
                  onClick={() => setQuantity(Math.min(artwork.stock, quantity + 1))}
                  disabled={isSoldOut || quantity >= artwork.stock}
                >
                  +
                </button>
              </div>
            </div>

            <div className="action-buttons">
              <button
                className="btn-secondary"
                onClick={handleAddToCart}
                disabled={isSoldOut}
              >
                加入购物车
              </button>
              <button
                className="btn-primary"
                onClick={() => setShowOrderForm(true)}
                disabled={isSoldOut}
              >
                {isSoldOut ? '已售罄' : '立即下单'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showOrderForm && (
        <div className="modal-overlay" onClick={() => setShowOrderForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>确认订单</h2>
            <div className="order-summary">
              <p>
                <strong>商品：</strong>
                {artwork.title}
              </p>
              <p>
                <strong>数量：</strong>
                {quantity} 件
              </p>
              <p>
                <strong>总价：</strong>¥{artwork.price * quantity}
              </p>
            </div>

            <form onSubmit={handleSubmitOrder}>
              <div className="form-group">
                <label>收货人姓名</label>
                <input
                  type="text"
                  required
                  value={orderForm.buyerName}
                  onChange={(e) =>
                    setOrderForm({ ...orderForm, buyerName: e.target.value })
                  }
                  placeholder="请输入收货人姓名"
                />
              </div>
              <div className="form-group">
                <label>联系电话</label>
                <input
                  type="tel"
                  required
                  value={orderForm.buyerPhone}
                  onChange={(e) =>
                    setOrderForm({ ...orderForm, buyerPhone: e.target.value })
                  }
                  placeholder="请输入联系电话"
                />
              </div>
              <div className="form-group">
                <label>收货地址</label>
                <textarea
                  required
                  value={orderForm.buyerAddress}
                  onChange={(e) =>
                    setOrderForm({ ...orderForm, buyerAddress: e.target.value })
                  }
                  placeholder="请输入详细收货地址"
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowOrderForm(false)}
                >
                  取消
                </button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? '提交中...' : '确认下单'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArtDetail;
