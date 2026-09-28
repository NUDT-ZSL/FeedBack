import { User, Project, Registration } from './types';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export const users: User[] = [
  {
    id: uuidv4(),
    username: 'admin',
    nickname: '管理员',
    password: bcrypt.hashSync('admin123', 10),
    role: 'admin',
    avatar: '',
    totalHours: 0,
    monthlyHours: [],
    createdAt: new Date()
  },
  {
    id: uuidv4(),
    username: 'volunteer1',
    nickname: '志愿小明',
    password: bcrypt.hashSync('123456', 10),
    role: 'volunteer',
    avatar: '',
    totalHours: 65,
    monthlyHours: [
      { month: '2025-01', hours: 8 },
      { month: '2025-02', hours: 12 },
      { month: '2025-03', hours: 10 },
      { month: '2025-04', hours: 15 },
      { month: '2025-05', hours: 10 },
      { month: '2025-06', hours: 10 }
    ],
    createdAt: new Date()
  },
  {
    id: uuidv4(),
    username: 'volunteer2',
    nickname: '爱心小红',
    password: bcrypt.hashSync('123456', 10),
    role: 'volunteer',
    avatar: '',
    totalHours: 35,
    monthlyHours: [
      { month: '2025-01', hours: 5 },
      { month: '2025-02', hours: 6 },
      { month: '2025-03', hours: 8 },
      { month: '2025-04', hours: 6 },
      { month: '2025-05', hours: 5 },
      { month: '2025-06', hours: 5 }
    ],
    createdAt: new Date()
  }
];

const now = new Date();
const futureDate = (days: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

export const projects: Project[] = [
  {
    id: uuidv4(),
    name: '城市公园环保清洁行动',
    description: '组织志愿者前往城市中心公园进行垃圾清理、绿化维护等环保工作，共同守护我们的绿色家园。活动内容包括：捡拾垃圾、分类投放、植物浇水养护等。',
    location: '城市中心公园',
    serviceDate: futureDate(7),
    startTime: '09:00',
    endTime: '12:00',
    maxVolunteers: 15,
    type: '环保',
    deadline: futureDate(5),
    createdAt: new Date(),
    status: 'active'
  },
  {
    id: uuidv4(),
    name: '社区儿童课外辅导',
    description: '为社区内的留守儿童和困难家庭子女提供课外学习辅导，包括语文、数学、英语等科目，帮助他们提高学习成绩，树立学习信心。',
    location: '阳光社区活动中心',
    serviceDate: futureDate(10),
    startTime: '14:00',
    endTime: '17:00',
    maxVolunteers: 8,
    type: '教育',
    deadline: futureDate(8),
    createdAt: new Date(),
    status: 'active'
  },
  {
    id: uuidv4(),
    name: '敬老院爱心探访',
    description: '前往敬老院看望孤寡老人，陪伴聊天、表演节目、帮助打扫卫生，让老人们感受到社会的温暖与关怀。',
    location: '幸福敬老院',
    serviceDate: futureDate(14),
    startTime: '09:30',
    endTime: '11:30',
    maxVolunteers: 12,
    type: '助老',
    deadline: futureDate(12),
    createdAt: new Date(),
    status: 'active'
  },
  {
    id: uuidv4(),
    name: '社区法律知识宣传',
    description: '在社区内开展法律知识普及活动，发放宣传资料，提供免费法律咨询服务，提高居民的法律意识和维权能力。',
    location: '和谐社区广场',
    serviceDate: futureDate(5),
    startTime: '10:00',
    endTime: '15:00',
    maxVolunteers: 6,
    type: '社区',
    deadline: futureDate(3),
    createdAt: new Date(),
    status: 'active'
  },
  {
    id: uuidv4(),
    name: '河道生态保护志愿活动',
    description: '参与河道清洁、水质监测、生态修复等工作，保护母亲河，共建美丽家园。适合热爱自然、关心环保的朋友参加。',
    location: '滨河公园河段',
    serviceDate: futureDate(20),
    startTime: '08:30',
    endTime: '11:30',
    maxVolunteers: 20,
    type: '环保',
    deadline: futureDate(18),
    createdAt: new Date(),
    status: 'active'
  },
  {
    id: uuidv4(),
    name: '图书馆志愿服务',
    description: '协助图书馆进行图书整理、读者引导、阅读推广等工作，为市民创造良好的阅读环境。',
    location: '市图书馆',
    serviceDate: futureDate(3),
    startTime: '09:00',
    endTime: '17:00',
    maxVolunteers: 10,
    type: '教育',
    deadline: futureDate(1),
    createdAt: new Date(),
    status: 'active'
  }
];

export const registrations: Registration[] = [];
