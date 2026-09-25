import { useState, useEffect } from 'react';

// 教练类型定义
interface Coach {
  id: string;
  name: string;
  specialty: string;
}

// 课程类型定义
interface Course {
  id: string;
  name: string;
  coachName: string;
  coachId: string;
  startTime: string;
  endTime: string;
  maxCapacity: number;
  currentBookings: number;
}

// 教练排班管理组件
// 数据流向：
//   初始化 -> useEffect触发loadData -> 并行fetch教练和课程列表 -> setState渲染
//   添加教练 -> handleAddCoach -> POST /api/coaches -> loadData刷新
//   编辑教练 -> handleEditCoach -> PUT /api/coaches/:id -> loadData刷新
//   删除教练 -> handleDeleteCoach -> DELETE /api/coaches/:id -> loadData刷新
//   添加课程 -> handleAddCourse -> POST /api/courses -> 后端校验时间冲突 -> loadData刷新
//   编辑课程 -> handleUpdateCourse -> PUT /api/courses/:id -> 后端校验 -> loadData刷新
//   删除课程 -> handleDeleteCourse -> DELETE /api/courses/:id -> loadData刷新
// 调用关系：Schedule -> fetch(后端路由courses.ts的/coaches和/courses端点) -> 内存store.ts
interface ScheduleProps {
  token: string;
}

export default function Schedule({ token }: ScheduleProps) {
  // Tab状态：教练管理 / 课程管理
  const [activeTab, setActiveTab] = useState<'coaches' | 'courses'>('courses');
  // 数据列表状态
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  // ============ 教练表单状态 ============
  const [coachName, setCoachName] = useState('');
  const [coachSpecialty, setCoachSpecialty] = useState('');
  // 编辑模式：存储正在编辑的教练ID
  const [editingCoachId, setEditingCoachId] = useState<string | null>(null);

  // ============ 课程表单状态 ============
  const [courseName, setCourseName] = useState('');
  const [courseCoachId, setCourseCoachId] = useState('');
  const [courseDate, setCourseDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [maxCapacity, setMaxCapacity] = useState('20');
  // 编辑模式：存储正在编辑的课程ID
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);

  // 消息提示状态
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 初始化加载数据
  // 数据流向：组件挂载 -> useEffect -> loadData -> Promise.all并行请求两个接口
  useEffect(() => {
    loadData();
  }, [token]);

  // 加载教练和课程数据
  // 调用关系：fetch GET /api/coaches -> routes/courses.ts -> getAllCoaches()
  //          fetch GET /api/courses/admin -> routes/courses.ts -> getAllCourses()
  const loadData = async () => {
    try {
      setLoading(true);
      // 并行请求提高加载速度
      const [coachesRes, coursesRes] = await Promise.all([
        fetch('/api/coaches', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/courses/admin', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (coachesRes.ok) {
        const data = await coachesRes.json();
        // 数据流向：后端返回coaches数组 -> setCoaches -> 触发重新渲染
        setCoaches(data.coaches || []);
      }

      if (coursesRes.ok) {
        const data = await coursesRes.json();
        // 数据流向：后端返回courses数组 -> setCourses -> 触发重新渲染
        setCourses(data.courses || []);
      }
    } catch (err) {
      console.error('加载数据失败:', err);
      setMessage({ type: 'error', text: '加载数据失败' });
    } finally {
      setLoading(false);
    }
  };

  // 显示消息并自动清除
  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  // ============ 教练管理：增删改 ============

  // 添加/编辑教练提交处理
  // 数据流向：表单submit -> 构造请求体 -> fetch POST/PUT -> 后端addCoach/updateCoach -> 返回结果
  const handleCoachSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);

    try {
      const url = editingCoachId
        ? `/api/coaches/${editingCoachId}`   // 编辑：PUT
        : '/api/coaches';                    // 新增：POST
      const method = editingCoachId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: coachName, specialty: coachSpecialty }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || (editingCoachId ? '编辑教练失败' : '添加教练失败'));
      }

      showMessage('success', editingCoachId ? '教练编辑成功！' : '教练添加成功！');
      // 清空表单并退出编辑模式
      resetCoachForm();
      // 刷新数据
      loadData();
    } catch (err: any) {
      showMessage('error', err.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 点击编辑按钮：填充表单并进入编辑模式
  // 数据流向：点击"编辑" -> setEditingCoachId -> 表单预填教练数据
  const handleEditCoach = (coach: Coach) => {
    setEditingCoachId(coach.id);
    setCoachName(coach.name);
    setCoachSpecialty(coach.specialty);
  };

  // 删除教练
  // 调用关系：fetch DELETE /api/coaches/:id -> routes/courses.ts -> deleteCoach
  const handleDeleteCoach = async (coachId: string) => {
    if (!confirm('确定要删除此教练吗？相关课程不会被删除，请手动调整。')) return;

    try {
      const res = await fetch(`/api/coaches/${coachId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        showMessage('success', '教练已删除');
        loadData();
      } else {
        const data = await res.json();
        showMessage('error', data.message || '删除失败');
      }
    } catch {
      showMessage('error', '删除失败');
    }
  };

  // 重置教练表单
  const resetCoachForm = () => {
    setEditingCoachId(null);
    setCoachName('');
    setCoachSpecialty('');
  };

  // ============ 课程管理：增删改 ============

  // 添加/编辑课程提交处理
  // 核心逻辑：
  //   1. 组合日期和时间为ISO格式
  //   2. 校验结束时间晚于开始时间
  //   3. 校验容量1-20
  //   4. 发送请求，后端自动校验教练时间冲突
  //   5. 成功则刷新列表
  const handleCourseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSubmitting(true);

    try {
      const startDateTime = new Date(`${courseDate}T${startTime}`);
      const endDateTime = new Date(`${courseDate}T${endTime}`);

      if (endDateTime <= startDateTime) {
        throw new Error('结束时间必须晚于开始时间');
      }

      const capacity = parseInt(maxCapacity);
      if (isNaN(capacity) || capacity <= 0 || capacity > 20) {
        throw new Error('容量必须在1-20之间');
      }

      const url = editingCourseId
        ? `/api/courses/${editingCourseId}`   // 编辑：PUT
        : '/api/courses';                     // 新增：POST
      const method = editingCourseId ? 'PUT' : 'POST';

      // 数据流向：请求体 -> routes/courses.ts POST/PUT /api/courses -> checkCoachConflict校验冲突 -> addCourse/updateCourse
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: courseName,
          coachId: courseCoachId,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          maxCapacity: capacity,
          description: `${courseName}课程`,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || (editingCourseId ? '编辑课程失败' : '添加课程失败'));
      }

      showMessage('success', editingCourseId ? '课程编辑成功！' : '课程添加成功！');
      resetCourseForm();
      loadData();
    } catch (err: any) {
      showMessage('error', err.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 点击编辑课程：填充表单
  // 数据流向：点击"编辑" -> setEditingCourseId -> 解析课程日期时间 -> 预填表单
  const handleEditCourse = (course: Course) => {
    setEditingCourseId(course.id);
    setCourseName(course.name);
    setCourseCoachId(course.coachId);

    // 解析ISO时间为日期和时间字符串
    const start = new Date(course.startTime);
    const end = new Date(course.endTime);
    // 日期格式：YYYY-MM-DD
    const dateStr = start.toISOString().split('T')[0];
    // 时间格式：HH:MM
    const startTimeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
    const endTimeStr = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;

    setCourseDate(dateStr);
    setStartTime(startTimeStr);
    setEndTime(endTimeStr);
    setMaxCapacity(course.maxCapacity.toString());
  };

  // 删除课程
  // 调用关系：fetch DELETE /api/courses/:id -> routes/courses.ts -> deleteCourse
  const handleDeleteCourse = async (courseId: string) => {
    if (!confirm('确定要删除此课程吗？已预约的会员将无法签到，请谨慎操作。')) return;

    try {
      const res = await fetch(`/api/courses/${courseId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        showMessage('success', '课程已删除');
        loadData();
      } else {
        const data = await res.json();
        showMessage('error', data.message || '删除失败');
      }
    } catch {
      showMessage('error', '删除失败');
    }
  };

  // 重置课程表单
  const resetCourseForm = () => {
    setEditingCourseId(null);
    setCourseName('');
    setCourseCoachId('');
    setCourseDate('');
    setStartTime('');
    setEndTime('');
    setMaxCapacity('20');
  };

  if (loading) {
    return <div className="loading">加载中...</div>;
  }

  return (
    <div className="schedule-page">
      <div className="page-header">
        <h1>排班管理</h1>
        <p>管理教练信息和课程排班，支持增删改操作</p>
      </div>

      {/* Tab切换 */}
      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === 'courses' ? 'active' : ''}`}
          onClick={() => { setActiveTab('courses'); resetCourseForm(); }}
        >
          📅 课程管理
        </button>
        <button
          className={`tab-btn ${activeTab === 'coaches' ? 'active' : ''}`}
          onClick={() => { setActiveTab('coaches'); resetCoachForm(); }}
        >
          👨‍🏫 教练管理
        </button>
      </div>

      {/* 消息提示 */}
      {message && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      {/* ============ 教练管理 Tab ============ */}
      {activeTab === 'coaches' && (
        <div className="admin-section">
          {/* 添加/编辑教练表单 */}
          <div className="form-card glass-card">
            <h3>{editingCoachId ? '✏️ 编辑教练' : '➕ 添加教练'}</h3>
            <form onSubmit={handleCoachSubmit} className="admin-form">
              <div className="form-row">
                <div className="form-group">
                  <label>教练姓名</label>
                  <input
                    type="text"
                    value={coachName}
                    onChange={(e) => setCoachName(e.target.value)}
                    placeholder="请输入教练姓名"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>专长</label>
                  <input
                    type="text"
                    value={coachSpecialty}
                    onChange={(e) => setCoachSpecialty(e.target.value)}
                    placeholder="例如：瑜伽、动感单车、力量训练"
                    required
                  />
                </div>
              </div>
              <div className="form-actions">
                {editingCoachId && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={resetCoachForm}
                    disabled={submitting}
                  >
                    取消编辑
                  </button>
                )}
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? '提交中...' : (editingCoachId ? '保存修改' : '添加教练')}
                </button>
              </div>
            </form>
          </div>

          {/* 教练列表 - 展示所有教练，支持编辑和删除 */}
          <div className="list-card glass-card">
            <h3>教练列表 ({coaches.length})</h3>
            {coaches.length === 0 ? (
              <p className="empty">暂无教练，请先添加</p>
            ) : (
              <div className="coach-list">
                {coaches.map((coach) => (
                  <div key={coach.id} className="coach-item">
                    <div className="coach-avatar">👨‍🏫</div>
                    <div className="coach-info">
                      <p className="coach-name">{coach.name}</p>
                      <p className="coach-specialty">专长：{coach.specialty}</p>
                    </div>
                    <div className="coach-actions">
                      {/* 编辑按钮：点击后进入编辑模式，表单预填数据 */}
                      <button
                        className="btn-edit"
                        onClick={() => handleEditCoach(coach)}
                      >
                        ✏️ 编辑
                      </button>
                      {/* 删除按钮：二次确认后调用删除API */}
                      <button
                        className="btn-delete"
                        onClick={() => handleDeleteCoach(coach.id)}
                      >
                        🗑️ 删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ 课程管理 Tab ============ */}
      {activeTab === 'courses' && (
        <div className="admin-section">
          {/* 添加/编辑课程表单 */}
          <div className="form-card glass-card">
            <h3>{editingCourseId ? '✏️ 编辑课程' : '➕ 排课'}</h3>
            <form onSubmit={handleCourseSubmit} className="admin-form">
              <div className="form-row">
                <div className="form-group">
                  <label>课程名称</label>
                  <input
                    type="text"
                    value={courseName}
                    onChange={(e) => setCourseName(e.target.value)}
                    placeholder="例如：动感单车、瑜伽、HIIT"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>授课教练</label>
                  <select
                    value={courseCoachId}
                    onChange={(e) => setCourseCoachId(e.target.value)}
                    required
                  >
                    <option value="">请选择教练</option>
                    {coaches.map((coach) => (
                      <option key={coach.id} value={coach.id}>
                        {coach.name} ({coach.specialty})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>课程日期</label>
                  <input
                    type="date"
                    value={courseDate}
                    onChange={(e) => setCourseDate(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>开始时间</label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>结束时间</label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>最大容量 (1-20)</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={maxCapacity}
                    onChange={(e) => setMaxCapacity(e.target.value)}
                    required
                  />
                </div>
              </div>
              <p className="form-tip">
                💡 系统会自动检查教练时间冲突，同一教练不能在同一时间排两门课
              </p>
              <div className="form-actions">
                {editingCourseId && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={resetCourseForm}
                    disabled={submitting}
                  >
                    取消编辑
                  </button>
                )}
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? '提交中...' : (editingCourseId ? '保存修改' : '添加课程')}
                </button>
              </div>
            </form>
          </div>

          {/* 课程列表 - 展示所有课程，支持编辑和删除 */}
          <div className="list-card glass-card">
            <h3>课程列表 ({courses.length})</h3>
            {courses.length === 0 ? (
              <p className="empty">暂无课程，请先排课</p>
            ) : (
              <div className="admin-course-list">
                {courses.map((course) => {
                  const start = new Date(course.startTime);
                  const end = new Date(course.endTime);
                  const remaining = course.maxCapacity - course.currentBookings;
                  return (
                    <div key={course.id} className="admin-course-item">
                      <div className="course-info-main">
                        <h4>{course.name}</h4>
                        <p>
                          教练：{course.coachName} | 时间：
                          {start.toLocaleDateString('zh-CN')}{' '}
                          {start.toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          -{' '}
                          {end.toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                        <p>
                          预约人数：{course.currentBookings}/{course.maxCapacity}
                          {remaining <= 0 && <span className="status-full"> (已满)</span>}
                          {remaining > 0 && remaining < 5 && <span className="status-tight"> (紧张)</span>}
                        </p>
                      </div>
                      <div className="course-actions">
                        {/* 编辑按钮：点击后进入编辑模式 */}
                        <button
                          className="btn-edit"
                          onClick={() => handleEditCourse(course)}
                        >
                          ✏️ 编辑
                        </button>
                        {/* 删除按钮：二次确认后删除 */}
                        <button
                          className="btn-delete"
                          onClick={() => handleDeleteCourse(course.id)}
                        >
                          🗑️ 删除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
