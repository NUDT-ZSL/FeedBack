import { useState, useEffect } from 'react';
import { User } from '../hooks/useAuth';

// 课程类型定义
interface Course {
  id: string;
  name: string;
  coachName: string;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  currentBookings: number;
  description: string;
  userBooked: boolean;
}

// 课程列表组件
// 数据流向：fetch GET /api/courses -> 展示课程网格 -> 点击预约 -> fetch POST /api/bookings
// 调用关系：Courses -> fetch -> 后端routes/courses.ts（含VIP优先预约逻辑）
interface CoursesProps {
  token: string;
  user: User;
  updateUser: (data: Partial<User>) => void;
}

export default function Courses({ token, user, updateUser }: CoursesProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 加载课程列表
  useEffect(() => {
    loadCourses();
  }, [token]);

  const loadCourses = async () => {
    try {
      // 性能约束：后端使用内存数据，响应应在2秒内完成
      const res = await fetch('/api/courses', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setCourses(data.courses || []);
      }
    } catch (err) {
      console.error('加载课程失败:', err);
    } finally {
      setLoading(false);
    }
  };

  // 预约课程
  const bookCourse = async (course: Course) => {
    if (course.userBooked) {
      setMessage({ type: 'error', text: '您已预约此课程' });
      return;
    }

    const remaining = course.maxCapacity - course.currentBookings;
    // 普通会员在名额紧张（<5）且剩余名额为0时无法预约
    // VIP会员享有优先预约权，即使剩余名额为0也可预约（最多保留5个VIP名额）
    if (remaining <= 0 && user.level !== 'vip') {
      setMessage({ type: 'error', text: '名额已满，升级为VIP会员可享有优先预约权' });
      return;
    }

    setBookingId(course.id);
    setMessage(null);

    try {
      // 调用后端预约API
      // 后端逻辑：检查重复预约 -> 检查名额（VIP优先） -> 创建预约 -> 检查升级VIP条件
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ courseId: course.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || '预约失败');
      }

      setMessage({ type: 'success', text: data.message || '预约成功！' });

      // 后端返回升级状态，同步更新前端用户信息
      if (data.upgradedToVIP) {
        updateUser({ level: 'vip', bookingCount: data.newBookingCount });
      } else {
        updateUser({ bookingCount: data.newBookingCount });
      }

      // 刷新课程列表
      loadCourses();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '预约失败' });
    } finally {
      setBookingId(null);
    }
  };

  // 根据剩余名额显示不同按钮状态
  const getBookingButton = (course: Course) => {
    const remaining = course.maxCapacity - course.currentBookings;

    if (course.userBooked) {
      return (
        <button className="btn-booked" disabled>
          ✓ 已预约
        </button>
      );
    }

    if (remaining <= 0) {
      if (user.level === 'vip') {
        return (
          <button
            className="btn-primary vip-priority"
            onClick={() => bookCourse(course)}
            disabled={bookingId === course.id}
          >
            ⭐ VIP优先预约
          </button>
        );
      }
      return (
        <button className="btn-full" disabled>
          名额已满
        </button>
      );
    }

    if (remaining < 5) {
      return (
        <button
          className="btn-primary btn-urgent"
          onClick={() => bookCourse(course)}
          disabled={bookingId === course.id}
        >
          {bookingId === course.id ? '预约中...' : `🔥 紧张 (剩${remaining})`}
        </button>
      );
    }

    return (
      <button
        className="btn-primary"
        onClick={() => bookCourse(course)}
        disabled={bookingId === course.id}
      >
        {bookingId === course.id ? '预约中...' : `立即预约 (剩${remaining})`}
      </button>
    );
  };

  if (loading) {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="courses-page">
      <div className="page-header">
        <h1>课程列表</h1>
        <p>选择您感兴趣的课程开始预约</p>
        {user.level === 'normal' && (
          <p className="vip-tip">
            💡 预约满5次即可升级为VIP会员，享有优先预约权
          </p>
        )}
        {user.level === 'vip' && (
          <p className="vip-tip vip">
            ⭐ 您是VIP会员，可享有优先预约权
          </p>
        )}
      </div>

      {message && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      {/* 课程网格布局 - 每行3列，移动端自动变为单列 */}
      <div className="courses-grid">
        {courses.map((course) => {
          const startTime = new Date(course.startTime);
          const endTime = new Date(course.endTime);
          const remaining = course.maxCapacity - course.currentBookings;

          return (
            <div key={course.id} className="course-card glass-card">
              <div className="course-card-header">
                <h3 className="course-title">{course.name}</h3>
                {user.level === 'vip' && remaining <= 0 && (
                  <span className="vip-badge">⭐ VIP可约</span>
                )}
              </div>

              <div className="course-info">
                <p className="coach">
                  <span className="label">教练：</span>
                  {course.coachName}
                </p>
                <p className="time">
                  <span className="label">时间：</span>
                  {startTime.toLocaleDateString('zh-CN')}
                  <br />
                  {startTime.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  -{' '}
                  {endTime.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="description">{course.description}</p>
              </div>

              <div className="course-footer">
                <div className="capacity-bar">
                  <div
                    className={`capacity-fill ${remaining < 5 ? 'urgent' : ''}`}
                    style={{
                      width: `${(course.currentBookings / course.maxCapacity) * 100}%`,
                    }}
                  ></div>
                </div>
                <p className="capacity-text">
                  名额：{course.currentBookings}/{course.maxCapacity}
                </p>
                {getBookingButton(course)}
              </div>
            </div>
          );
        })}
      </div>

      {courses.length === 0 && (
        <div className="empty-state">
          <p>暂无课程，请等待管理员排课</p>
        </div>
      )}
    </div>
  );
}
