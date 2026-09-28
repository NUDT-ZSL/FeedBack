import { v4 as uuidv4 } from 'uuid';

export interface StallOwner {
  id: string;
  username: string;
  password: string;
  displayName: string;
}

export interface Stall {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  photoUrl: string;
  category: string;
  businessHoursStart: number;
  businessHoursEnd: number;
  maxReservations: number;
}

export interface Reservation {
  id: string;
  stallId: string;
  customerName: string;
  customerPhone: string;
  timeSlot: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: string;
}

export const owners: StallOwner[] = [
  { id: 'owner-1', username: 'artwang', password: '123456', displayName: '王匠人' },
  { id: 'owner-2', username: 'clayli', password: '123456', displayName: '李陶艺' },
  { id: 'owner-3', username: 'brushchen', password: '123456', displayName: '陈画师' },
];

export const stalls: Stall[] = [
  {
    id: 'stall-1',
    ownerId: 'owner-1',
    name: '花间手作',
    description: '手工银饰与干花首饰，每一件都是独一无二的自然之美。在这里，你可以找到融合了花卉元素的手工银戒指、耳环和项链。',
    photoUrl: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=handmade%20silver%20jewelry%20with%20dried%20flowers%20on%20wooden%20table%2C%20warm%20lighting%2C%20bokeh%20background%2C%20artisan%20craft&image_size=square',
    category: '首饰',
    businessHoursStart: 9,
    businessHoursEnd: 18,
    maxReservations: 5,
  },
  {
    id: 'stall-2',
    ownerId: 'owner-2',
    name: '泥趣陶舍',
    description: '手拉坯与釉下彩绘，体验泥土在指尖的温暖。提供陶艺体验课程，从揉泥到上釉，全程指导。',
    photoUrl: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=handmade%20pottery%20ceramics%20on%20rustic%20shelf%2C%20warm%20studio%20lighting%2C%20cozy%20workshop&image_size=square',
    category: '陶艺',
    businessHoursStart: 10,
    businessHoursEnd: 20,
    maxReservations: 4,
  },
  {
    id: 'stall-3',
    ownerId: 'owner-3',
    name: '墨色画坊',
    description: '水彩插画与手绘明信片，用画笔记录生活中的小美好。原创插画周边、定制手绘人像。',
    photoUrl: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=watercolor%20illustrations%20and%20handdrawn%20postcards%20on%20desk%2C%20artistic%20studio%2C%20warm%20light&image_size=square',
    category: '插画',
    businessHoursStart: 8,
    businessHoursEnd: 16,
    maxReservations: 3,
  },
  {
    id: 'stall-4',
    ownerId: 'owner-1',
    name: '织梦工坊',
    description: '手工编织与钩针小物，温暖的毛线传递指尖温度。围巾、杯垫、小玩偶，样样精巧。',
    photoUrl: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=handmade%20knitted%20crocheted%20items%20yarn%20balls%2C%20cozy%20warm%20lighting%2C%20craft%20market&image_size=square',
    category: '手工',
    businessHoursStart: 9,
    businessHoursEnd: 17,
    maxReservations: 6,
  },
  {
    id: 'stall-5',
    ownerId: 'owner-2',
    name: '釉光器物',
    description: '柴烧茶器与日式食器，每一件都带着窑火的记忆。手工烧制的独特釉色，适合茶道与日常。',
    photoUrl: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=wood-fired%20tea%20ceramics%20Japanese%20tableware%2C%20warm%20rustic%2C%20artisan%20pottery&image_size=square',
    category: '陶艺',
    businessHoursStart: 11,
    businessHoursEnd: 19,
    maxReservations: 4,
  },
  {
    id: 'stall-6',
    ownerId: 'owner-3',
    name: '纸间物语',
    description: '手作纸品与立体贺卡，纸上的童话世界。精致剪纸与立体书，适合送礼收藏。',
    photoUrl: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=handmade%20paper%20crafts%20popup%20greeting%20cards%2C%20colorful%20artistic%2C%20creative%20market&image_size=square',
    category: '插画',
    businessHoursStart: 10,
    businessHoursEnd: 18,
    maxReservations: 5,
  },
];

export const reservations: Reservation[] = [];

export function generateId(): string {
  return uuidv4();
}

export function getTimeSlots(stall: Stall): { label: string; hour: number }[] {
  const slots: { label: string; hour: number }[] = [];
  for (let h = stall.businessHoursStart; h < stall.businessHoursEnd; h++) {
    slots.push({
      label: `${h}:00-${h + 1}:00`,
      hour: h,
    });
  }
  return slots;
}

export function getSlotRemaining(stall: Stall, timeSlot: string): number {
  const count = reservations.filter(
    (r) => r.stallId === stall.id && r.timeSlot === timeSlot && r.status !== 'cancelled'
  ).length;
  return stall.maxReservations - count;
}
