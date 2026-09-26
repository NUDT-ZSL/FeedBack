const express = require('express');
const cors = require('cors');
const { parseFormula } = require('./engine');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.post('/parse', (req, res) => {
  const startTime = Date.now();
  try {
    const { formula = '' } = req.body || {};

    if (!formula.trim()) {
      return res.json({
        latex: '',
        success: true,
        parseTimeMs: Date.now() - startTime,
      });
    }

    const latex = parseFormula(formula);
    return res.json({
      latex,
      success: true,
      parseTimeMs: Date.now() - startTime,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : '未知错误';
    return res.status(500).json({
      latex: '',
      success: false,
      error,
      parseTimeMs: Date.now() - (req._startTime || Date.now()),
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`[Formula Parser Server] 运行在 http://localhost:${PORT}`);
  console.log(`[Formula Parser Server] POST /parse 接口已就绪`);
});
