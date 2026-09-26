// 验证入口：在随机端口启动本地临时服务实例，顺序执行全部风险用例
// 完全离线运行，不依赖真实外部账号或网络服务
import { createApp } from '../src/server/app';
import { runAll } from './framework';
import './booking.tests';
import './idempotency.tests';
import './qrcode.tests';
import './checkin.tests';

const app = createApp();
const server = app.listen(0, () => {
  void (async () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const base = `http://127.0.0.1:${port}`;
    console.log(`验证目标: ${base}（本地临时实例，无外部依赖）`);
    const ok = await runAll(base);
    server.close(() => process.exit(ok ? 0 : 1));
  })();
});
