import React from 'react';
import { Order, OrderStatus } from '../modules/order/OrderManager';

interface OrderListProps {
  orders: Order[];
  onStatusChange?: (orderId: string, status: OrderStatus) => void;
}

const statusColors: Record<OrderStatus, string> = {
  待处理: '#f0ad4e',
  已发货: '#5bc0de',
  已完成: '#5cb85c',
};

const statusFlow: Record<OrderStatus, OrderStatus | null> = {
  待处理: '已发货',
  已发货: '已完成',
  已完成: null,
};

export const OrderList: React.FC<OrderListProps> = ({ orders, onStatusChange }) => {
  return (
    <div className="order-list-container">
      <table className="order-table">
        <thead>
          <tr>
            <th>订单编号</th>
            <th>客户姓名</th>
            <th>联系电话</th>
            <th>书籍详情</th>
            <th>总价</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const nextStatus = statusFlow[order.status];
            return (
              <tr key={order.id} className="order-row">
                <td className="order-id">{order.id}</td>
                <td>{order.customerName}</td>
                <td>{order.customerPhone}</td>
                <td>
                  <ul className="order-items">
                    {order.items.map((item, idx) => (
                      <li key={idx}>
                        {item.bookTitle} × {item.quantity}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="order-price">¥{order.totalPrice.toFixed(2)}</td>
                <td>
                  <span
                    className="status-badge"
                    style={{ backgroundColor: statusColors[order.status] }}
                  >
                    {order.status}
                  </span>
                </td>
                <td>
                  {nextStatus && (
                    <button
                      className="btn btn-small btn-primary"
                      onClick={() => onStatusChange?.(order.id, nextStatus)}
                    >
                      {nextStatus}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {orders.length === 0 && (
        <div className="empty-state">暂无订单数据</div>
      )}
    </div>
  );
};
