import { createApp, initDatabase } from './app.ts';

const PORT = Number(process.env.PORT) || 3001;
const DB_PATH = process.env.DB_PATH || './database.sqlite';

async function startServer() {
  const db = await initDatabase(DB_PATH);
  const app = createApp(db);

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
