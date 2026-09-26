// Express服务器入口 - 仅负责构建应用并监听端口
// 应用构建逻辑位于app.ts，测试环境可直接复用
import { createApp } from './app';

const PORT = process.env.PORT || 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`健身房预约管理系统后端运行在: http://localhost:${PORT}`);
});
