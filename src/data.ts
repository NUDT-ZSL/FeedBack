import type { Room, Booking, RoomType, RoomStatus, OrderStatus } from './types';

const roomNames = [
  '山景大床房', '海景双床房', '豪华套房', '园景大床房', '家庭双床房',
  '蜜月套房', '露台大床房', '标准双床房', '行政套房', '温馨大床房'
];

const roomTypes: RoomType[] = ['大床', '双床', '套房', '大床', '双床', '套房', '大床', '双床', '套房', '大床'];

const roomStatuses: RoomStatus[] = ['空闲', '已预订', '打扫中', '空闲', '空闲', '已预订', '空闲', '打扫中', '空闲', '空闲'];

const descriptions = [
  '落地窗欣赏山景，配备1.8米大床',
  '独立阳台观海景，两张1.2米单人床',
  '80平米超大空间，客厅卧室分离',
  '花园景观，1.8米舒适大床',
  '适合家庭入住，两张1.5米床',
  '浪漫蜜月首选，圆形浴缸',
  '私人露台，1.8米大床',
  '经济实惠，两张1.2米床',
  '商务出行首选，会客区域',
  '温馨舒适，1.5米大床'
];

const customerNames = ['张三', '李四', '王五', '赵六', '陈七', '刘八', '周九', '吴十', '郑十一', '孙十二'];

function generateOrderNo(date: string): string {
  const random = Math.floor(Math.random() * 900) + 100;
  return `${date.replace(/-/g, '')}-${random}`;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function generateRooms(): Room[] {
  const rooms: Room[] = [];
  for (let i = 0; i < 10; i++) {
    const basePrice = Math.floor(Math.random() * 1801) + 200;
    rooms.push({
      id: `room-${i + 1}`,
      name: roomNames[i],
      type: roomTypes[i],
      basePrice,
      maxGuests: roomTypes[i] === '套房' ? 4 : roomTypes[i] === '双床' ? 3 : 2,
      description: descriptions[i],
      status: roomStatuses[i]
    });
  }
  return rooms;
}

export function generateBookings(rooms: Room[]): Booking[] {
  const bookings: Booking[] = [];
  const today = new Date();
  
  for (let i = 0; i < 30; i++) {
    const roomIndex = i % rooms.length;
    const room = rooms[roomIndex];
    const daysAgo = Math.floor(Math.random() * 60);
    const checkInDate = new Date(today);
    checkInDate.setDate(checkInDate.getDate() - daysAgo);
    
    const days = Math.floor(Math.random() * 7) + 1;
    const guests = Math.floor(Math.random() * (room.maxGuests - 1)) + 1;
    const totalPrice = room.basePrice * days;
    
    let status: OrderStatus;
    if (daysAgo > days) {
      status = '已退房';
    } else if (daysAgo >= 0) {
      status = '已入住';
    } else {
      status = '待入住';
    }
    
    const createdAt = new Date(checkInDate);
    createdAt.setDate(createdAt.getDate() - Math.floor(Math.random() * 7) - 1);
    
    bookings.push({
      id: `booking-${i + 1}`,
      orderNo: generateOrderNo(formatDate(checkInDate)),
      customerName: customerNames[i % customerNames.length],
      phone: `1${Math.floor(Math.random() * 900000000) + 100000000}`,
      roomId: room.id,
      roomType: room.type,
      checkInDate: formatDate(checkInDate),
      days,
      guests,
      totalPrice,
      status,
      createdAt: formatDate(createdAt)
    });
  }
  
  return bookings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
