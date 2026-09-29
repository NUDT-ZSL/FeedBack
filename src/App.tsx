import { useState, useMemo, useCallback } from 'react';
import type { Room, Booking, PageType, RoomStatus, OrderStatus } from './types';
import { generateRooms, generateBookings } from './data';
import RoomManagement from './pages/RoomManagement';
import CalendarBooking from './pages/CalendarBooking';
import OrderManagement from './pages/OrderManagement';
import ReportChart from './components/ReportChart';

export default function App() {
  const [rooms, setRooms] = useState<Room[]>(() => generateRooms());
  const [bookings, setBookings] = useState<Booking[]>(() => generateBookings(rooms));
  const [currentPage, setCurrentPage] = useState<PageType>('rooms');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleRoomStatusChange = useCallback((roomId: string, status: RoomStatus) => {
    setRooms(prev => prev.map(room =>
      room.id === roomId ? { ...room, status } : room
    ));
  }, []);

  const handleAddBooking = useCallback((booking: Omit<Booking, 'id' | 'orderNo' | 'createdAt' | 'status' | 'totalPrice'>) => {
    const room = rooms.find(r => r.id === booking.roomId);
    if (!room) return;

    const totalPrice = room.basePrice * booking.days;
    const datePart = booking.checkInDate.replace(/-/g, '');
    const random = Math.floor(Math.random() * 900) + 100;
    const orderNo = `${datePart}-${random}`;

    const newBooking: Booking = {
      ...booking,
      id: `booking-${Date.now()}`,
      orderNo,
      totalPrice,
      status: '待入住' as OrderStatus,
      createdAt: new Date().toISOString().split('T')[0]
    };

    setBookings(prev => [newBooking, ...prev]);
    
    const checkIn = new Date(booking.checkInDate);
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + booking.days);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (checkIn <= today && today < checkOut) {
      handleRoomStatusChange(booking.roomId, '已预订');
    }
  }, [rooms, handleRoomStatusChange]);

  const handleOrderStatusChange = useCallback((orderId: string, status: OrderStatus) => {
    setBookings(prev => prev.map(booking =>
      booking.id === orderId ? { ...booking, status } : booking
    ));
  }, []);

  const navItems = useMemo(() => [
    { key: 'rooms' as PageType, label: '房源管理', icon: '🏠' },
    { key: 'calendar' as PageType, label: '日历预订', icon: '📅' },
    { key: 'orders' as PageType, label: '订单管理', icon: '📋' },
    { key: 'report' as PageType, label: '经营报表', icon: '📊' }
  ], []);

  const renderPage = () => {
    switch (currentPage) {
      case 'rooms':
        return <RoomManagement rooms={rooms} onStatusChange={handleRoomStatusChange} />;
      case 'calendar':
        return <CalendarBooking rooms={rooms} bookings={bookings} onAddBooking={handleAddBooking} />;
      case 'orders':
        return <OrderManagement bookings={bookings} rooms={rooms} onStatusChange={handleOrderStatusChange} />;
      case 'report':
        return <ReportChart bookings={bookings} rooms={rooms} />;
      default:
        return null;
    }
  };

  const currentYear = new Date().getFullYear();

  return (
    <div className="app-container">
      <header className="header">
        <div className="header-content">
          <div className="logo">🏨 温馨民宿管理系统</div>
          <button
            className="hamburger"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            ☰
          </button>
          <nav className={`nav ${mobileMenuOpen ? 'open' : ''}`}>
            {navItems.map(item => (
              <button
                key={item.key}
                className={`nav-item ${currentPage === item.key ? 'active' : ''}`}
                onClick={() => {
                  setCurrentPage(item.key);
                  setMobileMenuOpen(false);
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="main-content">
        {renderPage()}
      </main>

      <footer className="footer">
        © {currentYear} 温馨民宿 - 专业民宿管理系统
      </footer>
    </div>
  );
}
