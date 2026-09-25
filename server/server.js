const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'dist')));

const annotationsStore = new Map();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Annotation server is running' });
});

app.get('/api/annotations', (req, res) => {
  const result = [];
  annotationsStore.forEach((annotations, pageNum) => {
    result.push({
      pageNum: parseInt(pageNum),
      annotations: Array.from(annotations.values()),
    });
  });
  result.sort((a, b) => a.pageNum - b.pageNum);
  res.json({ pages: result });
});

app.get('/api/annotations/:pageNum', (req, res) => {
  const pageNum = req.params.pageNum;
  const annotations = annotationsStore.get(pageNum);
  if (!annotations) {
    return res.json({ pageNum: parseInt(pageNum), annotations: [] });
  }
  res.json({
    pageNum: parseInt(pageNum),
    annotations: Array.from(annotations.values()),
  });
});

app.post('/api/annotations', (req, res) => {
  const { pageNum, text, highlightColor, note } = req.body;

  if (!pageNum || !text) {
    return res.status(400).json({
      error: 'Missing required fields: pageNum and text are required',
    });
  }

  const annotation = {
    id: uuidv4(),
    pageNum,
    text,
    highlightColor: highlightColor || '#fff3b0',
    note: note || '',
    timestamp: Date.now(),
  };

  if (!annotationsStore.has(pageNum.toString())) {
    annotationsStore.set(pageNum.toString(), new Map());
  }
  annotationsStore.get(pageNum.toString()).set(annotation.id, annotation);

  res.status(201).json(annotation);
});

app.post('/api/annotations/batch', (req, res) => {
  const { annotations } = req.body;

  if (!Array.isArray(annotations)) {
    return res.status(400).json({
      error: 'annotations must be an array',
    });
  }

  const created = [];
  annotations.forEach((item) => {
    if (!item.pageNum || !item.text) return;

    const annotation = {
      id: uuidv4(),
      pageNum: item.pageNum,
      text: item.text,
      highlightColor: item.highlightColor || '#fff3b0',
      note: item.note || '',
      timestamp: Date.now(),
    };

    const pageKey = item.pageNum.toString();
    if (!annotationsStore.has(pageKey)) {
      annotationsStore.set(pageKey, new Map());
    }
    annotationsStore.get(pageKey).set(annotation.id, annotation);
    created.push(annotation);
  });

  res.status(201).json({ created: created.length, annotations: created });
});

app.put('/api/annotations/:id', (req, res) => {
  const { id } = req.params;
  const { text, highlightColor, note } = req.body;

  let found = null;
  annotationsStore.forEach((annotations) => {
    if (annotations.has(id)) {
      const ann = annotations.get(id);
      const updated = {
        ...ann,
        text: text !== undefined ? text : ann.text,
        highlightColor: highlightColor !== undefined ? highlightColor : ann.highlightColor,
        note: note !== undefined ? note : ann.note,
        timestamp: Date.now(),
      };
      annotations.set(id, updated);
      found = updated;
    }
  });

  if (!found) {
    return res.status(404).json({ error: 'Annotation not found' });
  }

  res.json(found);
});

app.delete('/api/annotations/:id', (req, res) => {
  const { id } = req.params;

  let deleted = false;
  annotationsStore.forEach((annotations, pageNum) => {
    if (annotations.has(id)) {
      annotations.delete(id);
      deleted = true;
      if (annotations.size === 0) {
        annotationsStore.delete(pageNum);
      }
    }
  });

  if (!deleted) {
    return res.status(404).json({ error: 'Annotation not found' });
  }

  res.json({ message: 'Annotation deleted successfully' });
});

app.delete('/api/annotations', (req, res) => {
  annotationsStore.clear();
  res.json({ message: 'All annotations cleared' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   📚 Book Annotation Server                          ║
║                                                      ║
║   Running on: http://localhost:${PORT}               ║
║                                                      ║
║   API Endpoints:                                     ║
║   GET    /api/health              - Health check     ║
║   GET    /api/annotations         - Get all          ║
║   GET    /api/annotations/:page   - Get by page      ║
║   POST   /api/annotations         - Create one       ║
║   POST   /api/annotations/batch   - Create batch     ║
║   PUT    /api/annotations/:id     - Update           ║
║   DELETE /api/annotations/:id     - Delete one       ║
║   DELETE /api/annotations         - Clear all        ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);
});
