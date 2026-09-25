// Express服务器入口
// 数据流向：接收前端请求 -> CORS中间件 -> JSON解析 -> 路由分发 -> 各模块路由处理 -> 返回响应
// 调用关系：index.ts -> routes/auth.ts, routes/courses.ts, routes/qrcode.ts

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import courseRoutes from './routes/courses';
import qrCodeRoutes from './routes/qrcode';

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: '健身房预约系统运行中' });
});

// 路由注册
// 数据流向：
// /api/auth/* -> authRoutes -> 处理登录注册
// /api/* -> courseRoutes -> 处理课程、预约、教练管理
// /api/* -> qrCodeRoutes -> 处理二维码生成和签到核销
app.use('/api/auth', authRoutes);
app.use('/api', courseRoutes);
app.use('/api', qrCodeRoutes);

// 404处理
app.use('*', (_req, res) => {
  res.status(404).json({ message: '接口不存在' });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
  ==========================================
  🏋️ 健身房预约管理系统
  🚀 后端服务器运行在: http://localhost:${PORT}
  📱 前端开发服务器: http://localhost:5173
  ==========================================
  `);
});
