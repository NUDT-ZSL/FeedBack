export type SpaceCategory = 'garden' | 'fitness' | 'reading' | 'vacant';

export type SpaceStatus = 'available' | 'occupied' | 'maintenance';

export type BookingStatus = 'pending' | 'active' | 'completed' | 'cancelled';

export interface Space {
  id: string;
  name: string;
  category: SpaceCategory;
  status: SpaceStatus;
  position: { x: number; y: number };
  recentUsers: number;
}

export interface Booking {
  id: string;
  userId: string;
  spaceId: string;
  startTime: string;
  endTime: string;
  purpose: string;
  status: BookingStatus;
  rating?: number;
  comment?: string;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
}

export interface AdminAction {
  id: string;
  adminId: string;
  action: string;
  targetBookingId: string;
  timestamp: string;
}

export interface Activity {
  id: string;
  spaceId: string;
  spaceName: string;
  title: string;
  time: string;
  interestingCount: number;
}

export interface CreateBookingDTO {
  userId: string;
  spaceId: string;
  startTime: string;
  endTime: string;
  purpose: string;
}

export const CATEGORY_COLORS: Record<SpaceCategory, string> = {
  garden: '#A8E6CF',
  fitness: '#FFD3B6',
  reading: '#D4A5A5',
  vacant: '#B0B0B0',
};

export const CATEGORY_LABELS: Record<SpaceCategory, string> = {
  garden: '社区花园',
  fitness: '健身角',
  reading: '阅读亭',
  vacant: '闲置空房',
};

export const STATUS_LABELS: Record<SpaceStatus, string> = {
  available: '空闲',
  occupied: '占用',
  maintenance: '维护中',
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: '待使用',
  active: '使用中',
  completed: '已完成',
  cancelled: '已取消',
};
