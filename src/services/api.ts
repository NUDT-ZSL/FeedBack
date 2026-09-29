import type {
  Space,
  Booking,
  Activity,
  AdminAction,
  CreateBookingDTO,
  SpaceCategory,
  SpaceStatus,
  BookingStatus,
} from '@/types';

const CATEGORY_LIST: SpaceCategory[] = ['garden', 'fitness', 'reading', 'vacant'];
const STATUS_LIST: SpaceStatus[] = ['available', 'occupied', 'maintenance', 'available', 'available'];

const SPACES_DATA: Space[] = [
  { id: 's1', name: '阳光花园', category: 'garden', status: 'available', position: { x: 15, y: 20 }, recentUsers: 5 },
  { id: 's2', name: '绿茵花园', category: 'garden', status: 'occupied', position: { x: 70, y: 15 }, recentUsers: 3 },
  { id: 's3', name: '活力健身角', category: 'fitness', status: 'available', position: { x: 40, y: 35 }, recentUsers: 8 },
  { id: 's4', name: '晨练健身角', category: 'fitness', status: 'maintenance', position: { x: 80, y: 50 }, recentUsers: 0 },
  { id: 's5', name: '静心阅读亭', category: 'reading', status: 'available', position: { x: 25, y: 60 }, recentUsers: 2 },
  { id: 's6', name: '星空阅读亭', category: 'reading', status: 'occupied', position: { x: 60, y: 70 }, recentUsers: 4 },
  { id: 's7', name: '创意空房A', category: 'vacant', status: 'available', position: { x: 45, y: 80 }, recentUsers: 1 },
  { id: 's8', name: '创意空房B', category: 'vacant', status: 'available', position: { x: 85, y: 80 }, recentUsers: 0 },
];

const PURPOSES = ['阳台种菜分享会', '亲子阅读活动', '晨练太极', '社区会议', '手工制作坊', '瑜伽课程', '绘画沙龙', '英语角'];

function generateBookings(): Booking[] {
  const bookings: Booking[] = [];
  const now = new Date();
  const statuses: BookingStatus[] = ['pending', 'active', 'completed', 'completed', 'completed', 'completed', 'cancelled'];
  let idCounter = 1;

  for (let dayOffset = -7; dayOffset <= 1; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    const numBookings = dayOffset <= 0 ? Math.floor(Math.random() * 4) + 1 : Math.floor(Math.random() * 3) + 1;

    for (let b = 0; b < numBookings; b++) {
      const spaceIdx = Math.floor(Math.random() * SPACES_DATA.length);
      const space = SPACES_DATA[spaceIdx];
      const startHour = 8 + Math.floor(Math.random() * 10);
      const durationHours = Math.floor(Math.random() * 2) + 1;
      const start = new Date(day);
      start.setHours(startHour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(startHour + durationHours);

      const statusIdx = dayOffset < 0 ? 2 + Math.floor(Math.random() * 2) : Math.floor(Math.random() * statuses.length);
      const status = statuses[statusIdx];
      const userId = `user${Math.floor(Math.random() * 20) + 1}`;
      const purpose = PURPOSES[Math.floor(Math.random() * PURPOSES.length)];

      bookings.push({
        id: `b${idCounter++}`,
        userId,
        spaceId: space.id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        purpose,
        status,
        rating: status === 'completed' ? Math.floor(Math.random() * 3) + 3 : undefined,
        comment: status === 'completed' && Math.random() > 0.3 ? '体验不错' : undefined,
        createdAt: new Date(day.getTime() - 86400000).toISOString(),
      });
    }
  }

  return bookings;
}

const ACTIVITIES_DATA: Activity[] = [
  { id: 'a1', spaceId: 's1', spaceName: '阳光花园', title: '周五下午3点阳台种菜分享会', time: '周五 15:00', interestingCount: 23 },
  { id: 'a2', spaceId: 's3', spaceName: '活力健身角', title: '周六早晨7点社区太极晨练', time: '周六 07:00', interestingCount: 15 },
  { id: 'a3', spaceId: 's5', spaceName: '静心阅读亭', title: '周日下午2点亲子绘本共读', time: '周日 14:00', interestingCount: 31 },
  { id: 'a4', spaceId: 's7', spaceName: '创意空房A', title: '周三晚上7点手工编织教学', time: '周三 19:00', interestingCount: 9 },
];

let spaces: Space[] = [...SPACES_DATA];
let bookings: Booking[] = generateBookings();
let auditLog: AdminAction[] = [];

function delay<T>(data: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), 100));
}

export async function fetchSpaces(): Promise<Space[]> {
  return delay([...spaces]);
}

export async function fetchSpaceById(id: string): Promise<Space | undefined> {
  return delay(spaces.find((s) => s.id === id));
}

export async function fetchBookings(): Promise<Booking[]> {
  return delay([...bookings]);
}

export async function fetchBookingsByUser(userId: string): Promise<Booking[]> {
  return delay(bookings.filter((b) => b.userId === userId));
}

export async function fetchBookingsBySpace(spaceId: string): Promise<Booking[]> {
  return delay(bookings.filter((b) => b.spaceId === spaceId));
}

export async function createBooking(dto: CreateBookingDTO): Promise<Booking> {
  const start = new Date(dto.startTime);
  const end = new Date(dto.endTime);
  const diffMs = end.getTime() - start.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours > 2) {
    throw new Error('单次预定最多2小时');
  }
  if (dto.purpose.length > 50) {
    throw new Error('使用目的限50字');
  }

  const booking: Booking = {
    id: `b${Date.now()}`,
    userId: dto.userId,
    spaceId: dto.spaceId,
    startTime: dto.startTime,
    endTime: dto.endTime,
    purpose: dto.purpose,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  bookings.push(booking);

  const spaceIdx = spaces.findIndex((s) => s.id === dto.spaceId);
  if (spaceIdx !== -1) {
    spaces[spaceIdx] = { ...spaces[spaceIdx], status: 'occupied', recentUsers: spaces[spaceIdx].recentUsers + 1 };
  }

  return delay(booking);
}

export async function cancelBooking(bookingId: string): Promise<void> {
  const idx = bookings.findIndex((b) => b.id === bookingId);
  if (idx !== -1) {
    bookings[idx] = { ...bookings[idx], status: 'cancelled' };
  }
  return delay(undefined);
}

export async function forceCancelBooking(bookingId: string, adminId: string): Promise<AdminAction> {
  const idx = bookings.findIndex((b) => b.id === bookingId);
  if (idx !== -1) {
    bookings[idx] = { ...bookings[idx], status: 'cancelled' };
  }
  const action: AdminAction = {
    id: `act_${Date.now()}`,
    adminId,
    action: 'force_cancel',
    targetBookingId: bookingId,
    timestamp: new Date().toISOString(),
  };
  auditLog.push(action);
  return delay(action);
}

export async function rateBooking(bookingId: string, rating: number, comment: string): Promise<Booking> {
  const idx = bookings.findIndex((b) => b.id === bookingId);
  if (idx !== -1) {
    bookings[idx] = { ...bookings[idx], rating, comment };
    return delay({ ...bookings[idx] });
  }
  throw new Error('Booking not found');
}

export async function fetchInterestingActivities(): Promise<Activity[]> {
  return delay([...ACTIVITIES_DATA]);
}

export async function fetchAuditLog(): Promise<AdminAction[]> {
  return delay([...auditLog]);
}

export function resetData(): void {
  spaces = [...SPACES_DATA];
  bookings = generateBookings();
  auditLog = [];
}
