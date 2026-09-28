import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { orderApi } from './api';
import { Order, OrderStatus } from './types';
import { useToast } from './ToastContext';

const steps: { status: OrderStatus; label: string }[] = [
  { status: 'pending', label: '下单' },
  { status: 'paid', label: '付款' },
  { status: 'shipped', label: '发货' },
  { status: 'completed', label: '完成' },
];

const statusLabels: Record<OrderStatus, string> = {
  pending: '待付款',
  paid: '已付款',
  shipped: '已发货',
  completed: '已完成',
};

const OrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrder = async () => {
      if (!id) return;
      try {
        const response = await orderApi.getOrderById(id);
        if (response.code === 200 && response.data) {
          setOrder(response.data);
        } else {
          showToast(response.message);
        }
      } catch (error) {
        showToast('获取订单详情失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    };
    fetchOrder();
  }, [id, showToast]);

  const getCurrentStepIndex = (status: OrderStatus) => {
    return steps.findIndex((s) => s.status === status);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="error-container">
        <p>订单不存在</p>
        <button className="btn-primary" onClick={() => navigate('/orders')}>
          返回订单列表
        </button>
      </div>
    );
  }

  const currentStepIndex = getCurrentStepIndex(order.status);

  return (
    <div className="order-detail-page">
      <button className="back-btn" onClick={() => navigate('/orders')}>
        ← 返回订单列表
      </button>

      <div className="order-detail-container">
        <div className="detail-header">
          <h1>订单详情</h1>
          <span
            className="detail-status"
            style={{
              backgroundColor:
                order.status === 'pending'
                  ? '#fff3e0'
                  : order.status === 'paid'
                  ? '#e3f2fd'
                  : order.status === 'shipped'
                  ? '#f3e5f5'
                  : '#e8f5e9',
              color:
                order.status === 'pending'
                  ? '#ff9800'
                  : order.status === 'paid'
                  ? '#2196f3'
                  : order.status === 'shipped'
                  ? '#9c27b0'
                  : '#4caf50',
            }}
          >
            {statusLabels[order.status]}
          </span>
        </div>

        <div className="tracking-section">
          <div className="tracking-steps">
            {steps.map((step, index) => {
              const isCompleted = index <= currentStepIndex;
              const isCurrent = index === currentStepIndex;

              return (
                <React.Fragment key={step.status}>
                  <div className={`tracking-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}>
                    <div className="step-icon">
                      {isCompleted && !isCurrent ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </div>
                    <span className="step-label">{step.label}</span>
                    {isCurrent && <div className="step-arrow"></div>}
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`step-connector ${index < currentStepIndex ? 'completed' : ''}`}></div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="detail-sections">
          <div className="detail-section">
            <h3>订单信息</h3>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">订单号</span>
                <span className="info-value">{order.orderNumber}</span>
              </div>
              <div className="info-item">
                <span className="info-label">下单时间</span>
                <span className="info-value">{formatDate(order.createdAt)}</span>
              </div>
              <div className="info-item">
                <span className="info-label">更新时间</span>
                <span className="info-value">{formatDate(order.updatedAt)}</span>
              </div>
              {order.trackingNumber && (
                <div className="info-item">
                  <span className="info-label">物流单号</span>
                  <span className="info-value tracking-number">{order.trackingNumber}</span>
                </div>
              )}
            </div>
          </div>

          <div className="detail-section">
            <h3>商品信息</h3>
            <div className="product-info">
              <div className="product-details">
                <p className="product-title">{order.artworkTitle}</p>
                <p className="product-price">单价：¥{order.artworkPrice}</p>
                <p className="product-quantity">数量：{order.quantity} 件</p>
              </div>
              <div className="product-total">
                <span className="total-label">订单总价</span>
                <span className="total-amount">¥{order.totalPrice}</span>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h3>收货信息</h3>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">收货人</span>
                <span className="info-value">{order.buyerName}</span>
              </div>
              <div className="info-item">
                <span className="info-label">联系电话</span>
                <span className="info-value">{order.buyerPhone}</span>
              </div>
              <div className="info-item full-width">
                <span className="info-label">收货地址</span>
                <span className="info-value">{order.buyerAddress}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderDetail;
