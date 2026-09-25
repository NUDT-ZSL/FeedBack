// 内存数据存储 - 模拟数据库
// 数据流向：后端各路由通过此模块访问和修改数据
// 最大数据量限制：100条课程记录，满足性能约束

import { v4 as uuidv4 } from 'uuid';

export interface User {
  id: string;
  email: string;
  name: string;
  password: string; // bcrypt加密后的密码
  level: 'normal' | 'vip';
  bookingCount: number;
  createdAt: string;
}

export interface Coach {
  id: string;
  name: string;
  specialty: string;
}

export interface Course {
  id: string;
  name: string;
  coachId: string;
  coachName: string;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  currentBookings: number;
  description: string;
  createdAt: string;
}

export interface Booking {
  id: string;
  userId: string;
  userName: string;
  courseId: string;
  courseName: string;
  coachId: string;
  coachName: string;
  startTime: string;
  status: 'booked' | 'checked-in' | 'cancelled';
  createdAt: string;
}

// 内存存储
const store = {
  users: [] as User[],
  coaches: [] as Coach[],
  courses: [] as Course[],
  bookings: [] as Booking[],
};

// 初始化示例数据
const initSampleData = () => {
  // 添加示例教练
  const sampleCoaches: Coach[] = [
    { id: uuidv4(), name: '王教练', specialty: '动感单车' },
    { id: uuidv4(), name: '李教练', specialty: '瑜伽' },
    { id: uuidv4(), name: '张教练', specialty: '力量训练' },
    { id: uuidv4(), name: '刘教练', specialty: '有氧健身操' },
  ];
  store.coaches.push(...sampleCoaches);

  // 添加示例课程（未来几天的课程）
  const now = new Date();
  const sampleCourses: Course[] = [];
  
  const courseTemplates = [
    { name: '动感单车燃脂', coachIdx: 0, duration: 60, desc: '高强度间歇训练，快速燃烧脂肪' },
    { name: '流瑜伽放松', coachIdx: 1, duration: 90, desc: '舒缓身心，提升柔韧性' },
    { name: '力量塑形', coachIdx: 2, duration: 60, desc: '专业力量训练，塑造完美体型' },
    { name: '有氧健身操', coachIdx: 3, duration: 45, desc: '活力四射的有氧运动' },
    { name: '核心训练', coachIdx: 2, duration: 45, desc: '强化核心肌群，提升稳定性' },
    { name: '普拉提', coachIdx: 1, duration: 60, desc: '精准控制，塑造优美线条' },
  ];

  for (let day = 0; day < 5; day++) {
    for (let i = 0; i < courseTemplates.length; i++) {
      const template = courseTemplates[i];
      const courseDate = new Date(now);
      courseDate.setDate(courseDate.getDate() + day + 1);
      courseDate.setHours(9 + (i % 4) * 2, 0, 0, 0);

      const endTime = new Date(courseDate);
      endTime.setMinutes(endTime.getMinutes() + template.duration);

      const coach = sampleCoaches[template.coachIdx];
      sampleCourses.push({
        id: uuidv4(),
        name: template.name,
        coachId: coach.id,
        coachName: coach.name,
        startTime: courseDate.toISOString(),
        endTime: endTime.toISOString(),
        maxCapacity: 20,
        currentBookings: Math.floor(Math.random() * 15),
        description: template.desc,
        createdAt: now.toISOString(),
      });
    }
  }

  // 限制最多100条数据
  store.courses.push(...sampleCourses.slice(0, 100));
};

initSampleData();

export const getStore = () => store;

// 用户操作
export const addUser = (user: Omit<User, 'id' | 'createdAt'>) => {
  const newUser: User = {
    ...user,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
  };
  store.users.push(newUser);
  return newUser;
};

export const findUserByEmail = (email: string) => {
  return store.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
};

export const findUserById = (id: string) => {
  return store.users.find((u) => u.id === id);
};

export const updateUser = (id: string, updates: Partial<User>) => {
  const idx = store.users.findIndex((u) => u.id === id);
  if (idx !== -1) {
    store.users[idx] = { ...store.users[idx], ...updates };
    return store.users[idx];
  }
  return null;
};

// 教练操作
// 数据流向：routes/courses.ts -> 调用这些函数 -> 修改内存中的coaches数组
export const addCoach = (coach: Omit<Coach, 'id'>) => {
  const newCoach: Coach = { ...coach, id: uuidv4() };
  store.coaches.push(newCoach);
  return newCoach;
};

export const getAllCoaches = () => [...store.coaches];

export const findCoachById = (id: string) => {
  return store.coaches.find((c) => c.id === id);
};

// 更新教练信息
// 数据流向：PUT /api/coaches/:id -> updateCoach -> 返回更新后的教练
export const updateCoach = (id: string, updates: Partial<Coach>) => {
  const idx = store.coaches.findIndex((c) => c.id === id);
  if (idx !== -1) {
    store.coaches[idx] = { ...store.coaches[idx], ...updates };
    return store.coaches[idx];
  }
  return null;
};

// 删除教练
// 数据流向：DELETE /api/coaches/:id -> deleteCoach -> 返回是否成功
export const deleteCoach = (id: string) => {
  const idx = store.coaches.findIndex((c) => c.id === id);
  if (idx !== -1) {
    store.coaches.splice(idx, 1);
    return true;
  }
  return false;
};

// 课程操作
export const addCourse = (course: Omit<Course, 'id' | 'createdAt' | 'currentBookings'>) => {
  const newCourse: Course = {
    ...course,
    id: uuidv4(),
    currentBookings: 0,
    createdAt: new Date().toISOString(),
  };
  store.courses.push(newCourse);
  return newCourse;
};

export const getAllCourses = () => [...store.courses];

export const findCourseById = (id: string) => {
  return store.courses.find((c) => c.id === id);
};

export const updateCourse = (id: string, updates: Partial<Course>) => {
  const idx = store.courses.findIndex((c) => c.id === id);
  if (idx !== -1) {
    store.courses[idx] = { ...store.courses[idx], ...updates };
    return store.courses[idx];
  }
  return null;
};

export const deleteCourse = (id: string) => {
  const idx = store.courses.findIndex((c) => c.id === id);
  if (idx !== -1) {
    store.courses.splice(idx, 1);
    return true;
  }
  return false;
};

// 检查教练时间冲突
export const checkCoachConflict = (coachId: string, startTime: string, endTime: string, excludeCourseId?: string) => {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  return store.courses.some((c) => {
    if (c.coachId !== coachId) return false;
    if (excludeCourseId && c.id === excludeCourseId) return false;

    const cStart = new Date(c.startTime).getTime();
    const cEnd = new Date(c.endTime).getTime();

    // 检查时间重叠
    return start < cEnd && end > cStart;
  });
};

// 预约操作
export const addBooking = (booking: Omit<Booking, 'id' | 'status' | 'createdAt'>) => {
  const newBooking: Booking = {
    ...booking,
    id: uuidv4(),
    status: 'booked',
    createdAt: new Date().toISOString(),
  };
  store.bookings.push(newBooking);
  return newBooking;
};

export const findBookingById = (id: string) => {
  return store.bookings.find((b) => b.id === id);
};

export const getBookingsByUserId = (userId: string) => {
  return store.bookings.filter((b) => b.userId === userId).sort((a, b) => 
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
};

export const updateBooking = (id: string, updates: Partial<Booking>) => {
  const idx = store.bookings.findIndex((b) => b.id === id);
  if (idx !== -1) {
    store.bookings[idx] = { ...store.bookings[idx], ...updates };
    return store.bookings[idx];
  }
  return null;
};

export const hasUserBookedCourse = (userId: string, courseId: string) => {
  return store.bookings.some(
    (b) => b.userId === userId && b.courseId === courseId && b.status !== 'cancelled'
  );
};
