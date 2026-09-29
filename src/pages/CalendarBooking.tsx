import { useState, useMemo, useCallback, memo } from 'react';
import type { Room, Booking, RoomType } from '../types';

interface CalendarBookingProps {
  rooms: Room[];
  bookings: Booking[];
  onAddBooking: (booking: Omit<Booking, 'id' | 'orderNo' | 'createdAt' | 'status' | 'totalPrice'>) => void;
}

interface BookingFormData {
  customerName: string;
  phone: string;
  roomId: string;
  days: number;
  guests: number;
}

const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

function CalendarBooking({ rooms, bookings, onAddBooking }: CalendarBookingProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<BookingFormData>({
    customerName: '',
    phone: '',
    roomId: rooms[0]?.id || '',
    days: 1,
    guests: 1
  });
  const [errors, setErrors] = useState<Partial<BookingFormData>>({});

  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  const bookedDates = useMemo(() => {
    const dates = new Set<string>();
    bookings.forEach(booking => {
      if (booking.status !== '已退房') {
        const checkIn = new Date(booking.checkInDate);
        for (let i = 0; i < booking.days; i++) {
          const d = new Date(checkIn);
          d.setDate(d.getDate() + i);
          dates.add(d.toISOString().split('T')[0]);
        }
      }
    });
    return dates;
  }, [bookings]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    const days: Array<{ day: number | null; date: string | null; isToday: boolean; isBooked: boolean }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ day: null, date: null, isToday: false, isBooked: false });
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day);
      const dateStr = date.toISOString().split('T')[0];
      const isToday = date.getTime() === today.getTime();
      const isBooked = bookedDates.has(dateStr);
      days.push({ day, date: dateStr, isToday, isBooked });
    }

    return days;
  }, [currentYear, currentMonth, bookedDates]);

  const handlePrevMonth = useCallback(() => {
    const t0 = performance.now();
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() - 1);
      return newDate;
    });
    const t1 = performance.now();
    console.log(`月份切换渲染时间: ${(t1 - t0).toFixed(2)}ms`);
  }, []);

  const handleNextMonth = useCallback(() => {
    const t0 = performance.now();
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + 1);
      return newDate;
    });
    const t1 = performance.now();
    console.log(`月份切换渲染时间: ${(t1 - t0).toFixed(2)}ms`);
  }, []);

  const handleDateClick = useCallback((date: string | null, isBooked: boolean) => {
    if (!date || isBooked) return;
    setSelectedDate(date);
    setFormData(prev => ({ ...prev, roomId: rooms[0]?.id || '' }));
    setShowModal(true);
    setErrors({});
  }, [rooms]);

  const validateForm = (): boolean => {
    const newErrors: Partial<BookingFormData> = {};
    if (!formData.customerName.trim()) {
      newErrors.customerName = '';
    }
    if (!/^1[3-9]\d{9}$/.test(formData.phone)) {
      newErrors.phone = '';
    }
    if (formData.days < 1 || formData.days > 7) {
      newErrors.days = 0;
    }
    const selectedRoom = rooms.find(r => r.id === formData.roomId);
    if (formData.guests < 1 || formData.guests > (selectedRoom?.maxGuests || 1)) {
      newErrors.guests = 0;
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = useCallback(() => {
    if (!selectedDate || !validateForm()) return;

    const selectedRoom = rooms.find(r => r.id === formData.roomId);
    if (!selectedRoom) return;

    onAddBooking({
      customerName: formData.customerName,
      phone: formData.phone,
      roomId: formData.roomId,
      roomType: selectedRoom.type as RoomType,
      checkInDate: selectedDate,
      days: formData.days,
      guests: formData.guests
    });

    setShowModal(false);
    setFormData({
      customerName: '',
      phone: '',
      roomId: rooms[0]?.id || '',
      days: 1,
      guests: 1
    });
  }, [selectedDate, formData, rooms, onAddBooking]);

  const selectedRoom = rooms.find(r => r.id === formData.roomId);

  return (
    <div>
      <h1 className="page-title">日历预订</h1>
      <div className="calendar-container">
        <div className="calendar-header">
          <button className="calendar-nav-btn" onClick={handlePrevMonth}>
            ← 上月
          </button>
          <h2 className="calendar-title">
            {currentYear}年{currentMonth + 1}月
          </h2>
          <button className="calendar-nav-btn" onClick={handleNextMonth}>
            下月 →
          </button>
        </div>

        <div className="calendar-weekdays">
          {weekdays.map(day => (
            <div key={day} className="calendar-weekday">{day}</div>
          ))}
        </div>

        <div className="calendar-grid">
          {calendarDays.map((item, index) => (
            <div
              key={index}
              className={`calendar-day ${
                item.day === null ? 'empty' :
                item.isBooked ? 'booked' : 'available'
              } ${item.isToday ? 'today' : ''}`}
              onClick={() => handleDateClick(item.date, item.isBooked)}
            >
              {item.day}
            </div>
          ))}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">预订房间 - {selectedDate}</h2>
            
            <div className="form-group">
              <label className="form-label">客户姓名</label>
              <input
                type="text"
                className="form-input"
                value={formData.customerName}
                onChange={e => setFormData(prev => ({ ...prev, customerName: e.target.value }))}
                placeholder="请输入客户姓名"
                style={errors.customerName !== undefined ? { borderColor: '#f44336' } : {}}
              />
            </div>

            <div className="form-group">
              <label className="form-label">联系电话</label>
              <input
                type="tel"
                className="form-input"
                value={formData.phone}
                onChange={e => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="请输入11位手机号码"
                style={errors.phone !== undefined ? { borderColor: '#f44336' } : {}}
              />
            </div>

            <div className="form-group">
              <label className="form-label">选择房源</label>
              <select
                className="form-select"
                value={formData.roomId}
                onChange={e => setFormData(prev => ({ ...prev, roomId: e.target.value }))}
              >
                {rooms.filter(r => r.status === '空闲').map(room => (
                  <option key={room.id} value={room.id}>
                    {room.name} - ¥{room.basePrice}/晚
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">入住天数 (1-7天)</label>
              <input
                type="number"
                min="1"
                max="7"
                className="form-input"
                value={formData.days}
                onChange={e => setFormData(prev => ({ ...prev, days: Math.min(7, Math.max(1, parseInt(e.target.value) || 1)) }))}
                style={errors.days !== undefined ? { borderColor: '#f44336' } : {}}
              />
            </div>

            <div className="form-group">
              <label className="form-label">入住人数 (最多{selectedRoom?.maxGuests || 1}人)</label>
              <input
                type="number"
                min="1"
                max={selectedRoom?.maxGuests || 1}
                className="form-input"
                value={formData.guests}
                onChange={e => setFormData(prev => ({ ...prev, guests: Math.min(selectedRoom?.maxGuests || 1, Math.max(1, parseInt(e.target.value) || 1)) }))}
                style={errors.guests !== undefined ? { borderColor: '#f44336' } : {}}
              />
            </div>

            {selectedRoom && (
              <div className="form-group">
                <label className="form-label">总价</label>
                <div className="room-price" style={{ margin: 0 }}>
                  ¥{selectedRoom.basePrice * formData.days}
                  <span> ({selectedRoom.basePrice} × {formData.days}天)</span>
                </div>
              </div>
            )}

            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleSubmit}>
                确认预订
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(CalendarBooking);
