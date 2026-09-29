import { useState, useEffect, useMemo, memo } from 'react';
import type { Booking, Room, OrderStatus } from '../types';

interface OrderManagementProps {
  bookings: Booking[];
  rooms: Room[];
  onStatusChange: (orderId: string, status: OrderStatus) => void;
}

const statusOptions: OrderStatus[] = ['待入住', '已入住', '已退房'];

const getStatusClass = (status: string) => {
  switch (status) {
    case '待入住': return 'pending';
    case '已入住': return 'checked-in';
    case '已退房': return 'checked-out';
    default: return '';
  }
};

const OrderRow = memo(function OrderRow({
  booking,
  roomName,
  isExpanded,
  onToggle,
  onStatusChange
}: {
  booking: Booking;
  roomName: string;
  isExpanded: boolean;
  onToggle: () => void;
  onStatusChange: (status: OrderStatus) => void;
}) {
  const checkOutDate = useMemo(() => {
    const date = new Date(booking.checkInDate);
    date.setDate(date.getDate() + booking.days);
    return date.toISOString().split('T')[0];
  }, [booking.checkInDate, booking.days]);

  return (
    <>
      <tr
        className={isExpanded ? 'expanded' : ''}
        onClick={onToggle}
      >
        <td>{booking.orderNo}</td>
        <td>{booking.customerName}</td>
        <td>{booking.phone}</td>
        <td>{booking.roomType}</td>
        <td>{booking.checkInDate}</td>
        <td>{booking.days}天</td>
        <td>¥{booking.totalPrice}</td>
        <td>
          <span className={`order-status-tag ${getStatusClass(booking.status)}`}>
            {booking.status}
          </span>
        </td>
      </tr>
      <tr className="order-detail-row">
        <td colSpan={8} style={{ padding: 0 }}>
          <div className={`order-detail-content ${isExpanded ? 'expanded' : ''}`}>
            <div className="order-detail-inner">
              <div>
                <div className="detail-item">
                  <span className="detail-label">订单编号</span>
                  <span className="detail-value">{booking.orderNo}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">房源名称</span>
                  <span className="detail-value">{roomName}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">房型</span>
                  <span className="detail-value">{booking.roomType}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">客户姓名</span>
                  <span className="detail-value">{booking.customerName}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">联系电话</span>
                  <span className="detail-value">{booking.phone}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">入住日期</span>
                  <span className="detail-value">{booking.checkInDate}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">退房日期</span>
                  <span className="detail-value">{checkOutDate}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">入住天数</span>
                  <span className="detail-value">{booking.days}天</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">入住人数</span>
                  <span className="detail-value">{booking.guests}人</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">订单总价</span>
                  <span className="detail-value">¥{booking.totalPrice}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">创建时间</span>
                  <span className="detail-value">{booking.createdAt}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">订单状态</span>
                  <span className="detail-value">
                    <span className={`order-status-tag ${getStatusClass(booking.status)}`}>
                      {booking.status}
                    </span>
                  </span>
                </div>
                <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                  <span className="detail-label">更新状态</span>
                  <div className="status-selector" style={{ marginTop: '4px' }}>
                    {statusOptions.map(status => (
                      <button
                        key={status}
                        className={`status-btn ${booking.status === status ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onStatusChange(status);
                        }}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </td>
      </tr>
    </>
  );
});

function OrderManagement({ bookings, rooms, onStatusChange }: OrderManagementProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadStartTime] = useState(performance.now());

  useEffect(() => {
    const loadTime = performance.now() - loadStartTime;
    console.log(`订单表格加载时间: ${loadTime.toFixed(2)}ms (${bookings.length}条数据)`);
  }, [bookings.length, loadStartTime]);

  const getRoomName = (roomId: string) => {
    return rooms.find(r => r.id === roomId)?.name || '未知房源';
  };

  const handleToggle = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div>
      <h1 className="page-title">订单管理</h1>
      <div className="orders-table-container">
        <table className="orders-table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户姓名</th>
              <th>联系电话</th>
              <th>房型</th>
              <th>入住日期</th>
              <th>天数</th>
              <th>总价</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map(booking => (
              <OrderRow
                key={booking.id}
                booking={booking}
                roomName={getRoomName(booking.roomId)}
                isExpanded={expandedId === booking.id}
                onToggle={() => handleToggle(booking.id)}
                onStatusChange={(status) => onStatusChange(booking.id, status)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default memo(OrderManagement);
