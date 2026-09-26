import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { orderApi } from './api';
import { Order, OrderStatus } from './types';
import { useToast } from './ToastContext';

const statusConfig: Record<OrderStatus, { label: string; color: string }> = {
  pending: { label: '待付款', color: '#ff9800' },
  paid: { label: '已付款', color: '#2196f3' },
  shipped: { label: '已发货', color: '#9c27b0' },
  completed: { label: '已完成', color: '#4caf50' },
};

const OrderManagement: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const navigate = useNavigate();
  const { showToast } = useToast();

  useEffect(() => {
    fetchOrders();
  }, [showToast]);

  const fetchOrders = async () => {
    try {
      const response = await orderApi.getOrders();
      if (response.code === 200 && response.data) {
        setOrders(response.data);
      } else {
        showToast(response.message);
      }
    } catch (error) {
      showToast('获取订单列表失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleShip = async (orderId: string) => {
    try {
      const response = await orderApi.updateOrderStatus(orderId, 'shipped');
      if (response.code === 200 && response.data) {
        showToast('发货成功！', 'success');
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? response.data! : o))
        );
      } else {
        showToast(response.message);
      }
    } catch (error) {
      showToast('发货失败，请稍后重试');
    }
  };

  const handlePay = async (orderId: string) => {
    try {
      const response = await orderApi.updateOrderStatus(orderId, 'paid');
      if (response.code === 200 && response.data) {
        showToast('支付确认成功！', 'success');
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? response.data! : o))
        );
      } else {
        showToast(response.message);
      }
    } catch (error) {
      showToast('操作失败，请稍后重试');
    }
  };

  const handleComplete = async (orderId: string) => {
    try {
      const response = await orderApi.updateOrderStatus(orderId, 'completed');
      if (response.code === 200 && response.data) {
        showToast('订单已完成！', 'success');
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? response.data! : o))
        );
      } else {
        showToast(response.message);
      }
    } catch (error) {
      showToast('操作失败，请稍后重试');
    }
  };

  const filteredOrders =
    filter === 'all' ? orders : orders.filter((o) => o.status === filter);

  const groupedOrders = {
    pending: filteredOrders.filter((o) => o.status === 'pending'),
    paid: filteredOrders.filter((o) => o.status === 'paid'),
    shipped: filteredOrders.filter((o) => o.status === 'shipped'),
    completed: filteredOrders.filter((o) => o.status === 'completed'),
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="orders-page">
      <div className="page-header">
        <h1>订单管理</h1>
        <p className="subtitle">管理所有艺术品订单</p>
      </div>

      <div className="filter-tabs">
        <button
          className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          全部 ({orders.length})
        </button>
        {(['pending', 'paid', 'shipped', 'completed'] as OrderStatus[]).map((status) => (
          <button
            key={status}
            className={`filter-tab ${filter === status ? 'active' : ''}`}
            onClick={() => setFilter(status)}
          >
            {statusConfig[status].label} ({orders.filter((o) => o.status === status).length})
          </button>
        ))}
      </div>

      <div className="order-groups">
        {filter === 'all' && (
          <>
            {(['pending', 'paid', 'shipped', 'completed'] as OrderStatus[]).map((status) => (
              <OrderGroup
                key={status}
                status={status}
                orders={groupedOrders[status]}
                onShip={handleShip}
                onPay={handlePay}
                onComplete={handleComplete}
                onViewDetail={(id) => navigate(`/orders/${id}`)}
              />
            ))}
          </>
        )}

        {filter !== 'all' && (
          <div className="orders-list">
            {filteredOrders.length === 0 ? (
              <div className="empty-state">
                <p>暂无{statusConfig[filter].label}的订单</p>
              </div>
            ) : (
              filteredOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onShip={handleShip}
                  onPay={handlePay}
                  onComplete={handleComplete}
                  onViewDetail={(id) => navigate(`/orders/${id}`)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

interface OrderGroupProps {
  status: OrderStatus;
  orders: Order[];
  onShip: (id: string) => void;
  onPay: (id: string) => void;
  onComplete: (id: string) => void;
  onViewDetail: (id: string) => void;
}

const OrderGroup: React.FC<OrderGroupProps> = ({
  status,
  orders,
  onShip,
  onPay,
  onComplete,
  onViewDetail,
}) => {
  if (orders.length === 0) return null;

  return (
    <div className="order-group">
      <h3 className="group-title" style={{ borderLeftColor: statusConfig[status].color }}>
        {statusConfig[status].label} ({orders.length})
      </h3>
      <div className="orders-list">
        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            onShip={onShip}
            onPay={onPay}
            onComplete={onComplete}
            onViewDetail={onViewDetail}
          />
        ))}
      </div>
    </div>
  );
};

interface OrderCardProps {
  order: Order;
  onShip: (id: string) => void;
  onPay: (id: string) => void;
  onComplete: (id: string) => void;
  onViewDetail: (id: string) => void;
}

const OrderCard: React.FC<OrderCardProps> = ({
  order,
  onShip,
  onPay,
  onComplete,
  onViewDetail,
}) => {
  return (
    <div className="order-card" onClick={() => onViewDetail(order.id)}>
      <div className="order-header">
        <span className="order-number">{order.orderNumber}</span>
        <span
          className="order-status"
          style={{ backgroundColor: statusConfig[order.status].color + '20', color: statusConfig[order.status].color }}
        >
          {statusConfig[order.status].label}
        </span>
      </div>
      <div className="order-body">
        <div className="order-info">
          <p className="order-artwork">{order.artworkTitle}</p>
          <p className="order-buyer">收货人：{order.buyerName}</p>
          <p className="order-quantity">数量：{order.quantity} 件</p>
        </div>
        <div className="order-total">
          <span className="total-label">总价</span>
          <span className="total-value">¥{order.totalPrice}</span>
        </div>
      </div>
      {order.trackingNumber && (
        <div className="order-tracking">
          <span>物流单号：{order.trackingNumber}</span>
        </div>
      )}
      <div className="order-actions" onClick={(e) => e.stopPropagation()}>
        {order.status === 'pending' && (
          <button className="btn-primary btn-small" onClick={() => onPay(order.id)}>
            确认付款
          </button>
        )}
        {order.status === 'paid' && (
          <button className="btn-primary btn-small" onClick={() => onShip(order.id)}>
            发货
          </button>
        )}
        {order.status === 'shipped' && (
          <button className="btn-primary btn-small" onClick={() => onComplete(order.id)}>
            确认完成
          </button>
        )}
        <button className="btn-secondary btn-small" onClick={() => onViewDetail(order.id)}>
          查看详情
        </button>
      </div>
    </div>
  );
};

export default OrderManagement;
