import express from 'express';
import cors from 'cors';
import evaluationsRouter from './routes/evaluations.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.use('/api/evaluations', evaluationsRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
