import express from 'express';
import http from 'http';
import net from 'net';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import routes from './routes';
import { createWebSocketServer, broadcast } from './wsHandler';

const app = express();
const START_PORT = parseInt(process.env.PORT || '3001');
const MAX_PORT_TRIES = 20;
const HEALTH_CHECK_MAX_RETRIES = 10;
const HEALTH_CHECK_INTERVAL_MS = 500;

app.use(cors());
app.use(express.json());

app.use('/api', routes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const isPortUsable = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer();
    const timeout = setTimeout(() => {
      server.close();
      resolve(false);
    }, 3000);

    server.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES' || err.code === 'EPERM') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      clearTimeout(timeout);
      server.close(() => resolve(true));
    });

    server.listen(port, '0.0.0.0');
  });
};

const findAvailablePort = async (startPort: number, maxTries: number): Promise<number> => {
  for (let offset = 0; offset < maxTries; offset++) {
    const port = startPort + offset;
    const usable = await isPortUsable(port);
    if (usable) {
      return port;
    }
    console.log(`端口 ${port} 不可用${offset > 0 ? '' : '（被占用或受限制）'}，尝试端口 ${port + 1}...`);
  }
  throw new Error(`无法找到可用端口（尝试范围 ${startPort}-${startPort + maxTries - 1}）`);
};

const waitForHealthCheck = async (port: number): Promise<boolean> => {
  for (let i = 0; i < HEALTH_CHECK_MAX_RETRIES; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) {
        const data = await res.json();
        console.log(`✅ 健康检查通过 (第${i + 1}次): ${data.status}`);
        return true;
      }
    } catch {
      await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL_MS));
    }
  }
  console.warn(`⚠️  健康检查在 ${HEALTH_CHECK_MAX_RETRIES} 次重试后仍未通过`);
  return false;
};

const updateViteProxyTarget = (port: number) => {
  const viteConfigPath = path.resolve(process.cwd(), 'vite.config.js');
  try {
    if (fs.existsSync(viteConfigPath)) {
      let content = fs.readFileSync(viteConfigPath, 'utf-8');
      content = content.replace(/localhost:\d+/g, `localhost:${port}`);
      fs.writeFileSync(viteConfigPath, content, 'utf-8');
      console.log(`📝 已更新 vite.config.js 代理目标为 localhost:${port}`);
    }
  } catch (err) {
    console.warn('⚠️  无法自动更新 vite.config.js，请手动修改代理端口:', err);
  }
};

const startServer = async () => {
  try {
    const PORT = await findAvailablePort(START_PORT, MAX_PORT_TRIES);

    if (PORT !== START_PORT) {
      updateViteProxyTarget(PORT);
    }

    const server = http.createServer(app);
    const wss = createWebSocketServer(server);

    wss.broadcast = broadcast;

    app.set('wss', wss);

    server.listen(PORT, async () => {
      console.log(`
  🚀 活动签到互动平台已启动
  
  后端服务: http://localhost:${PORT}
  前端服务: http://localhost:5173 (或自动分配端口)
  
  API 文档:
    POST /api/events          - 创建活动
    GET  /api/events/:id      - 获取活动信息
    POST /api/attendance      - 签到
    GET  /api/events/:id/attendance - 获取签到记录
    GET  /api/events/:id/stats      - 获取统计数据
  
  WebSocket: ws://localhost:${PORT}/ws?eventId=<eventId>
  
  健康检查: http://localhost:${PORT}/health
      `);

      await waitForHealthCheck(PORT);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ 端口 ${PORT} 在检测后被占用，请重启服务`);
      } else {
        console.error('❌ 服务器运行错误:', error);
      }
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ 启动服务器失败:', error);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

startServer();

export default app;
