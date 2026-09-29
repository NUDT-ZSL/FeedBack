export type RoomType = '大床' | '双床' | '套房';

export type RoomStatus = '空闲' | '已预订' | '打扫中';

export type OrderStatus = '待入住' | '已入住' | '已退房';

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  basePrice: number;
  maxGuests: number;
  description: string;
  status: RoomStatus;
}

export interface Booking {
  id: string;
  orderNo: string;
  customerName: string;
  phone: string;
  roomId: string;
  roomType: RoomType;
  checkInDate: string;
  days: number;
  guests: number;
  totalPrice: number;
  status: OrderStatus;
  createdAt: string;
}

export interface MonthlyReport {
  year: number;
  month: number;
  totalRevenue: number;
  totalOrders: number;
  avgPrice: number;
  occupancyRate: number;
  dailyRevenue: Array<{ date: string; revenue: number }>;
}

export type PageType = 'rooms' | 'calendar' | 'orders' | 'report';
