import { createApp } from './app';

const PORT = 3002;

const app = createApp();

app.listen(PORT, () => {
  console.log(`食谱管家服务端已启动: http://localhost:${PORT}`);
});
