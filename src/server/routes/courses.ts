// 课程与预约路由 - 处理课程CRUD、预约逻辑、教练排班、VIP升级
// 数据流向：
//   GET /api/courses -> 返回课程列表（含剩余名额和用户预约状态）
//   POST /api/bookings -> 预约课程（冲突检测、VIP优先、自动升级VIP）
//   GET /api/bookings -> 返回用户预约列表
//   POST /api/courses -> 管理员排课（教练时间冲突检测）
// 调用关系：index.ts -> courses.ts -> store.ts -> authMiddleware

import express from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import {
  getAllCourses,
  addCourse,
  findCourseById,
  updateCourse,
  deleteCourse,
  addBooking,
  getBookingsByUserId,
  hasUserBookedCourse,
  findUserById,
  updateUser,
  findCoachById,
  getAllCoaches,
  addCoach,
  updateCoach,
  deleteCoach,
  checkCoachConflict,
  findBookingById,
  updateBooking,
  getStore,
} from '../data/store';

const router = express.Router();

// ==================== 教练管理 ====================

// 获取教练列表
// 数据流向：GET /api/coaches -> getAllCoaches -> 返回教练列表
router.get('/coaches', authMiddleware, (_req, res) => {
  try {
    const coaches = getAllCoaches();
    res.json({ coaches });
  } catch (_err) {
    res.status(500).json({ message: '获取教练列表失败' });
  }
});

// 添加教练
// 数据流向：POST /api/coaches -> addCoach -> 返回新教练
router.post('/coaches', authMiddleware, (req, res) => {
  try {
    const { name, specialty } = req.body;

    if (!name || !specialty) {
      return res.status(400).json({ message: '请填写教练姓名和专长' });
    }

    const coach = addCoach({ name, specialty });
    res.json({ coach, message: '教练添加成功' });
  } catch (_err) {
    res.status(500).json({ message: '添加教练失败' });
  }
});

// 更新教练
// 数据流向：PUT /api/coaches/:id -> updateCoach -> 返回更新后的教练
router.put('/coaches/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { name, specialty } = req.body;

    // 参数校验
    if (!name || !specialty) {
      return res.status(400).json({ message: '请填写教练姓名和专长' });
    }

    // 查找教练是否存在
    const existingCoach = findCoachById(id);
    if (!existingCoach) {
      return res.status(404).json({ message: '教练不存在' });
    }

    // 调用store更新教练信息
    const updatedCoach = updateCoach(id, { name, specialty });
    res.json({ coach: updatedCoach, message: '教练更新成功' });
  } catch (_err) {
    res.status(500).json({ message: '更新教练失败' });
  }
});

// 删除教练
// 数据流向：DELETE /api/coaches/:id -> deleteCoach -> 返回成功/失败
router.delete('/coaches/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;

    // 查找教练是否存在
    const existingCoach = findCoachById(id);
    if (!existingCoach) {
      return res.status(404).json({ message: '教练不存在' });
    }

    // 调用store删除教练
    const deleted = deleteCoach(id);
    if (!deleted) {
      return res.status(500).json({ message: '删除教练失败' });
    }

    res.json({ message: '教练删除成功' });
  } catch (_err) {
    res.status(500).json({ message: '删除教练失败' });
  }
});

// ==================== 课程管理 ====================

// 获取课程列表（带用户预约状态）
// 性能约束：使用内存数据结构，最多100条，响应在2秒内
// 数据流向：GET /api/courses -> getAllCourses -> 标记userBooked -> 返回
router.get('/courses', authMiddleware, (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const courses = getAllCourses();

    // 为每个课程标记用户是否已预约
    const coursesWithStatus = courses
      .filter((c) => new Date(c.endTime) > new Date()) // 只显示未结束的课程
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .map((course) => ({
        id: course.id,
        name: course.name,
        coachName: course.coachName,
        startTime: course.startTime,
        endTime: course.endTime,
        maxCapacity: course.maxCapacity,
        currentBookings: course.currentBookings,
        description: course.description,
        userBooked: hasUserBookedCourse(userId, course.id),
      }));

    res.json({ courses: coursesWithStatus });
  } catch (_err) {
    res.status(500).json({ message: '获取课程列表失败' });
  }
});

// 获取所有课程（管理员用）
router.get('/courses/admin', authMiddleware, (_req, res) => {
  try {
    const courses = getAllCourses().sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    res.json({ courses });
  } catch (_err) {
    res.status(500).json({ message: '获取课程列表失败' });
  }
});

// 添加课程（排课）
// 数据流向：POST /api/courses -> 检查教练时间冲突 -> addCourse -> 返回新课程
router.post('/courses', authMiddleware, (req, res) => {
  try {
    const { name, coachId, startTime, endTime, maxCapacity, description } = req.body;

    // 参数校验
    if (!name || !coachId || !startTime || !endTime || !maxCapacity) {
      return res.status(400).json({ message: '请填写所有必填项' });
    }

    if (maxCapacity < 1 || maxCapacity > 20) {
      return res.status(400).json({ message: '课程容量必须在1-20之间' });
    }

    // 验证教练存在
    const coach = findCoachById(coachId);
    if (!coach) {
      return res.status(400).json({ message: '教练不存在' });
    }

    // 验证时间
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (end <= start) {
      return res.status(400).json({ message: '结束时间必须晚于开始时间' });
    }

    // 关键：检查教练时间冲突 - 同一教练不能在同一时间排两门课
    const hasConflict = checkCoachConflict(coachId, startTime, endTime);
    if (hasConflict) {
      return res.status(400).json({
        message: '该教练在此时间段已有课程安排，请选择其他时间',
      });
    }

    // 创建课程
    const course = addCourse({
      name,
      coachId,
      coachName: coach.name,
      startTime,
      endTime,
      maxCapacity,
      description: description || `${name}课程`,
    });

    res.json({ course, message: '课程添加成功' });
  } catch (err) {
    console.error('添加课程错误:', err);
    res.status(500).json({ message: '添加课程失败' });
  }
});

// 更新课程（编辑课程）
// 数据流向：PUT /api/courses/:id -> 校验参数 -> 检查教练时间冲突（排除自身） -> updateCourse -> 返回结果
router.put('/courses/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const { name, coachId, startTime, endTime, maxCapacity, description } = req.body;

    // 参数校验
    if (!name || !coachId || !startTime || !endTime || !maxCapacity) {
      return res.status(400).json({ message: '请填写所有必填项' });
    }

    if (maxCapacity < 1 || maxCapacity > 20) {
      return res.status(400).json({ message: '课程容量必须在1-20之间' });
    }

    // 1. 检查课程是否存在
    const existingCourse = findCourseById(id);
    if (!existingCourse) {
      return res.status(404).json({ message: '课程不存在' });
    }

    // 2. 验证教练存在
    const coach = findCoachById(coachId);
    if (!coach) {
      return res.status(400).json({ message: '教练不存在' });
    }

    // 3. 验证时间
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (end <= start) {
      return res.status(400).json({ message: '结束时间必须晚于开始时间' });
    }

    // 4. 关键：检查教练时间冲突 - 排除当前编辑的课程自身
    const hasConflict = checkCoachConflict(coachId, startTime, endTime, id);
    if (hasConflict) {
      return res.status(400).json({
        message: '该教练在此时间段已有课程安排，请选择其他时间',
      });
    }

    // 5. 检查容量是否合法（不能小于当前已预约人数）
    if (maxCapacity < existingCourse.currentBookings) {
      return res.status(400).json({
        message: `容量不能小于当前已预约人数(${existingCourse.currentBookings})`,
      });
    }

    // 6. 更新课程
    const updatedCourse = updateCourse(id, {
      name,
      coachId,
      coachName: coach.name,
      startTime,
      endTime,
      maxCapacity,
      description: description || `${name}课程`,
    });

    res.json({ course: updatedCourse, message: '课程更新成功' });
  } catch (err) {
    console.error('更新课程错误:', err);
    res.status(500).json({ message: '更新课程失败' });
  }
});

// 删除课程
// 数据流向：DELETE /api/courses/:id -> deleteCourse -> 返回成功/失败
router.delete('/courses/:id', authMiddleware, (req, res) => {
  try {
    const { id } = req.params;
    const deleted = deleteCourse(id);
    if (!deleted) {
      return res.status(404).json({ message: '课程不存在' });
    }
    res.json({ message: '课程已删除' });
  } catch (_err) {
    res.status(500).json({ message: '删除失败' });
  }
});

// ==================== 预约管理 ====================

// 获取用户预约列表
// 数据流向：GET /api/bookings -> getBookingsByUserId -> 返回预约列表
router.get('/bookings', authMiddleware, (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const bookings = getBookingsByUserId(userId);
    res.json({ bookings });
  } catch (_err) {
    res.status(500).json({ message: '获取预约列表失败' });
  }
});

// 预约课程
// 核心逻辑：
// 1. 检查重复预约
// 2. 检查名额（VIP会员优先，即使名额已满也可预约最多5个VIP预留名额）
// 3. 创建预约记录
// 4. 增加用户预约次数
// 5. 检查是否满足VIP升级条件（预约满5次自动升级）
// 6. 返回升级状态给前端
// 数据流向：POST /api/bookings -> 上述逻辑 -> 返回结果
router.post('/bookings', authMiddleware, (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const userLevel = req.user!.level;
    const { courseId } = req.body;

    if (!courseId) {
      return res.status(400).json({ message: '请选择课程' });
    }

    // 1. 检查课程是否存在
    const course = findCourseById(courseId);
    if (!course) {
      return res.status(404).json({ message: '课程不存在' });
    }

    // 2. 检查课程是否已结束
    if (new Date(course.startTime) < new Date()) {
      return res.status(400).json({ message: '该课程已开始，无法预约' });
    }

    // 3. 检查重复预约 - 用户无法重复预约同一课程
    if (hasUserBookedCourse(userId, courseId)) {
      return res.status(400).json({ message: '您已预约此课程' });
    }

    // 4. 检查名额，VIP会员享有优先预约权
    const remaining = course.maxCapacity - course.currentBookings;
    const VIP_RESERVED_SLOTS = 5; // 为VIP预留5个名额

    // 普通会员：名额已满时不可预约
    if (remaining <= 0 && userLevel !== 'vip') {
      return res.status(400).json({
        message: '名额已满，升级为VIP会员可享有优先预约权',
      });
    }

    // VIP会员：即使名额为0，只要VIP预留名额未满仍可预约
    if (remaining <= 0 && userLevel === 'vip') {
      // 统计当前课程的VIP预约数量
      const store = getStore();
      const vipBookings = store.bookings.filter(
        (b) => b.courseId === courseId && b.status !== 'cancelled'
      ).length;
      
      if (vipBookings >= course.maxCapacity + VIP_RESERVED_SLOTS) {
        return res.status(400).json({ message: 'VIP预留名额也已满' });
      }
    }

    // 5. 获取用户信息
    const user = findUserById(userId);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 6. 创建预约记录
    const booking = addBooking({
      userId,
      userName: user.name,
      courseId,
      courseName: course.name,
      coachId: course.coachId,
      coachName: course.coachName,
      startTime: course.startTime,
    });

    // 7. 更新课程预约数
    updateCourse(courseId, {
      currentBookings: course.currentBookings + 1,
    });

    // 8. 增加用户预约次数
    const newBookingCount = user.bookingCount + 1;
    let upgradedToVIP = false;
    let newLevel = user.level;

    // 9. 关键：检查VIP升级条件 - 普通会员预约满5次自动升级
    if (user.level === 'normal' && newBookingCount >= 5) {
      newLevel = 'vip';
      upgradedToVIP = true;
      updateUser(userId, {
        bookingCount: newBookingCount,
        level: 'vip',
      });
    } else {
      updateUser(userId, {
        bookingCount: newBookingCount,
      });
    }

    // 10. 返回结果（包含升级状态）
    res.json({
      booking,
      newBookingCount,
      upgradedToVIP,
      newLevel,
      message: upgradedToVIP
        ? '🎉 预约成功！恭喜您升级为VIP会员，享有优先预约权！'
        : '预约成功！',
    });
  } catch (err) {
    console.error('预约错误:', err);
    res.status(500).json({ message: '预约失败' });
  }
});

// 签到（从二维码路由调用，也可以直接调用）
// 数据流向：POST /api/checkin -> 校验qrToken -> 更新预约状态为checked-in
router.post('/checkin', authMiddleware, (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: '缺少预约ID' });
    }

    const booking = findBookingById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: '预约不存在' });
    }

    if (booking.status !== 'booked') {
      return res.status(400).json({ message: '该预约已签到或已取消' });
    }

    // 更新预约状态为已签到
    const updatedBooking = updateBooking(bookingId, {
      status: 'checked-in',
    });

    res.json({
      booking: updatedBooking,
      message: '签到成功！',
    });
  } catch (_err) {
    res.status(500).json({ message: '签到失败' });
  }
});

export default router;
