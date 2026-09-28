import express from 'express';
import cors from 'cors';
import { createServer } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

async function startServer() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa'
  });

  app.use(vite.middlewares);

  app.use('*', async (req, res) => {
    const url = req.originalUrl;
    try {
      const templatePath = join(__dirname, 'index.html');
      const fs = await import('fs/promises');
      let template = await fs.readFile(templatePath, 'utf-8');
      template = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      console.error(e);
      res.status(500).end(e.message);
    }
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`\n🌿 田野调查工具已启动: http://localhost:${port}\n`);
  });
}

startServer().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
