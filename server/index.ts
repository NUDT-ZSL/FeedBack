import path from 'path';
import { createApp } from './app';

const PORT = Number(process.env.PORT || 3001);
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const app = createApp({ dataDir });

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Database located at: ${dataDir}`);
});
