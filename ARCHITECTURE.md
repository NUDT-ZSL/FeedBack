# 健身房预约管理系统 - 架构说明

## 项目文件结构

```
gym-booking-system/
├── package.json              # 项目依赖和脚本配置
├── vite.config.js            # Vite构建配置
├── tsconfig.json             # TypeScript配置
├── index.html                # HTML入口
├── ARCHITECTURE.md           # 本文档
└── src/
    ├── client/               # 前端React应用
    │   ├── main.tsx          # React入口
    │   ├── App.tsx           # 主组件（路由分发）
    │   ├── styles.css        # 全局样式
    │   ├── hooks/
    │   │   └── useAuth.ts    # 认证Hook（全局状态）
    │   └── components/
    │       ├── Login.tsx     # 登录页面
    │       ├── Register.tsx  # 注册页面
    │       ├── Dashboard.tsx # 个人中心/仪表盘
    │       ├── Courses.tsx   # 课程列表与预约
    │       ├── Schedule.tsx  # 教练排班管理
    │       └── Checkin.tsx   # 签到核销页面
    └── server/               # 后端Express应用
        ├── index.ts          # Express服务器入口
        ├── data/
        │   └── store.ts      # 内存数据存储（模拟数据库）
        ├── middleware/
        │   └── auth.ts       # JWT认证中间件
        └── routes/
            ├── auth.ts       # 登录/注册路由
            ├── courses.ts    # 课程/预约/教练路由
            └── qrcode.ts     # 二维码生成/签到路由
```

---

## 数据流向总览

```
┌─────────────────┐     HTTP/REST     ┌─────────────────┐
│  前端 (React)   │ ────────────────▶ │  后端 (Express) │
│  - 用户交互     │   (Authorization: │  - 路由分发      │
│  - 状态管理     │    Bearer JWT)    │  - 业务逻辑      │
│  - 渲染UI       │ ◀──────────────── │  - 数据存储      │
└─────────────────┘    JSON响应       └─────────────────┘
         │                                      │
         ▼                                      ▼
┌─────────────────┐                  ┌─────────────────┐
│  localStorage   │                  │  内存数据结构   │
│  - JWT token    │                  │  - users        │
│  - 用户信息     │                  │  - coaches      │
└─────────────────┘                  │  - courses      │
                                      │  - bookings     │
                                      └─────────────────┘
```

---

## 各模块调用关系详解

### 1. 认证流程 (`/api/auth/*`)

**文件调用链：**
```
Login.tsx / Register.tsx
    ↓ (fetch POST)
auth.ts (routes/auth.ts)
    ↓ (bcrypt加密/校验)
    ↓ (jwt.sign签发token)
store.ts (addUser / findUserByEmail)
    ↓ (返回)
useAuth.ts (login() 存储到localStorage)
    ↓
App.tsx (根据token渲染页面)
```

**数据流向：**
1. 用户输入邮箱密码 → 前端校验
2. `fetch('/api/auth/login' | '/api/auth/register')`
3. 后端 `bcrypt` 加密/校验密码
4. `jsonwebtoken` 签发JWT（含userId, email, level）
5. 返回 `{ token, user }`
6. 前端 `localStorage` 持久化存储
7. 后续请求在 `Authorization: Bearer <token>` 头携带

---

### 2. 课程浏览与预约流程 (`/api/courses`, `/api/bookings`)

**文件调用链：**
```
Courses.tsx
    ↓ (fetch GET /api/courses)
courses.ts (routes/courses.ts)
    ↓ (authMiddleware校验JWT)
    ↓ (getAllCourses + hasUserBookedCourse)
store.ts
    ↓ (返回课程列表，标记userBooked)
Courses.tsx (渲染课程卡片网格)
    ↓ (用户点击预约)
    ↓ (fetch POST /api/bookings)
courses.ts (POST /api/bookings)
    ├─ 检查重复预约 (hasUserBookedCourse)
    ├─ 检查名额 (VIP优先逻辑)
    ├─ 创建预约 (addBooking)
    ├─ 更新课程名额 (updateCourse)
    ├─ 增加预约次数 (updateUser)
    └─ 检查VIP升级 (bookingCount >= 5 ? 升级VIP)
        ↓ (返回结果 + 升级状态)
Courses.tsx → updateUser() → 同步前端状态
```

**VIP升级逻辑（关键）：**
- 普通会员预约满 **5次** 自动升级为VIP
- 升级在 `POST /api/bookings` 中自动检测
- 返回 `upgradedToVIP: true` 给前端
- 前端调用 `updateUser({ level: 'vip' })` 同步状态

---

### 3. 教练排班流程 (`/api/coaches`, `/api/courses` POST)

**文件调用链：**
```
Schedule.tsx
    ├─ (fetch GET /api/coaches) → 教练列表
    ├─ (fetch POST /api/coaches) → 添加教练
    └─ (fetch POST /api/courses) → 排课
            ↓
courses.ts (routes/courses.ts)
    ├─ 参数校验
    ├─ 验证教练存在 (findCoachById)
    ├─ **关键: 教练时间冲突检测** (checkCoachConflict)
    │   └─ 同一时间已有课程 → 返回400错误
    └─ 创建课程 (addCourse)
```

**时间冲突检测逻辑：**
```
checkCoachConflict(coachId, startTime, endTime):
  for each course of coach:
    if (startTime < course.endTime AND endTime > course.startTime):
      return CONFLICT
  return OK
```

---

### 4. 签到二维码流程 (`/api/qrcode`, `/api/checkin`)

**文件调用链（生成二维码）：**
```
Dashboard.tsx
    ↓ (点击"生成签到码"按钮，检查提前30分钟)
    ↓ (fetch POST /api/qrcode)
qrcode.ts (routes/qrcode.ts)
    ├─ authMiddleware校验
    ├─ 验证预约属于当前用户
    ├─ 检查时间（提前30分钟内）
    ├─ JWT签名qrPayload: { bookingId, userId, ... }
    │  (使用独立密钥，5分钟有效期，防篡改)
    ├─ qrcode.toDataURL() 生成Base64图片
    │  (性能约束: 200ms内返回)
    └─ 返回 { qrCode: "data:image/png;base64,...", qrToken }
        ↓
Dashboard.tsx (模态框展示二维码，带淡蓝色光晕动画)
```

**文件调用链（核销签到）：**
```
Checkin.tsx
    ↓ (教练输入qrToken)
    ↓ (fetch POST /api/checkin)
qrcode.ts (POST /api/checkin)
    ├─ jwt.verify(qrToken) 校验签名和有效期
    ├─ 验证预约存在
    ├─ 验证预约状态为booked
    ├─ 验证用户匹配
    ├─ 检查签到时间
    └─ updateBooking(status: 'checked-in')
        ↓
Checkin.tsx (展示签到成功信息)
```

---

## 前后端API接口清单

| 方法 | 路径 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 会员注册 | 否 |
| POST | `/api/auth/login` | 会员登录 | 否 |
| GET | `/api/courses` | 获取课程列表（带预约状态） | 是 |
| GET | `/api/courses/admin` | 获取所有课程（管理员） | 是 |
| POST | `/api/courses` | 添加课程（排课） | 是 |
| DELETE | `/api/courses/:id` | 删除课程 | 是 |
| GET | `/api/coaches` | 获取教练列表 | 是 |
| POST | `/api/coaches` | 添加教练 | 是 |
| GET | `/api/bookings` | 获取我的预约列表 | 是 |
| POST | `/api/bookings` | 预约课程 | 是 |
| POST | `/api/qrcode` | 生成签到二维码 | 是 |
| POST | `/api/checkin` | 核销签到 | 是 |

---

## 关键技术点

### 1. JWT认证机制
- **登录JWT**：7天有效期，用于接口认证
- **二维码JWT**：5分钟有效期，独立密钥，防止伪造
- 中间件 `authMiddleware` 自动校验所有需要认证的接口

### 2. VIP优先级机制
- 普通会员：`maxCapacity` 名额满时不可预约
- VIP会员：额外预留5个名额，即使 `currentBookings == maxCapacity` 仍可预约

### 3. 性能约束
- 课程列表：内存数据结构，最多100条，响应 < 2秒
- 二维码生成：`qrcode.toDataURL` 异步生成，< 200ms
- 所有查询为O(n)复杂度，n ≤ 100

### 4. 响应式设计
- 桌面端：3列网格布局
- 移动端（<768px）：单列布局 + 汉堡菜单

### 5. UI动效
- 卡片悬停：上浮8px，`ease-out` 0.3秒过渡阴影
- 二维码模态框：淡蓝色径向渐变光晕动画，2秒周期脉冲
- 毛玻璃效果：`backdrop-filter: blur(8px)`

---

## 启动方式

```bash
# 安装依赖
npm install

# 同时启动前后端（端口3001后端，5173前端）
npm run dev

# 单独启动
npm run dev:server  # 后端
npm run dev:client  # 前端
```

启动后访问 `http://localhost:5173` 即可使用系统。
