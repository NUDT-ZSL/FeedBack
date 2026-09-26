import { createApp } from './app.js';

const PORT = 3001;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
