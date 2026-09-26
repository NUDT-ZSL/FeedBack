import express from 'express';
import cors from 'cors';
import { parseFormula } from './engine';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

interface ParseRequest {
  formula: string;
}

interface ParseResponse {
  latex: string;
  success: boolean;
  error?: string;
  parseTimeMs: number;
}

app.post('/parse', (req, res) => {
  const startTime = Date.now();
  try {
    const body = req.body as ParseRequest;
    const formula = body.formula || '';

    if (!formula.trim()) {
      const response: ParseResponse = {
        latex: '',
        success: true,
        parseTimeMs: Date.now() - startTime,
      };
      return res.json(response);
    }

    const latex = parseFormula(formula);
    const endTime = Date.now();

    const response: ParseResponse = {
      latex,
      success: true,
      parseTimeMs: endTime - startTime,
    };
    return res.json(response);
  } catch (err) {
    const error = err instanceof Error ? err.message : '未知错误';
    const response: ParseResponse = {
      latex: '',
      success: false,
      error,
      parseTimeMs: Date.now() - (req as any)._startTime || 0,
    };
    return res.status(500).json(response);
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`[Formula Parser Server] 运行在 http://localhost:${PORT}`);
  console.log(`[Formula Parser Server] POST /parse 接口已就绪`);
});

export default app;
