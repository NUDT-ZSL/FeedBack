import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import type { PosterConfig } from '../client/types';

const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const posterStore = new Map<string, PosterConfig>();

app.post('/api/share', (req, res) => {
  try {
    const config: PosterConfig = req.body;
    if (!config.bandId || !config.elements) {
      res.status(400).json({ success: false, error: 'Invalid poster config' });
      return;
    }
    const id = uuidv4().slice(0, 8);
    posterStore.set(id, config);
    const url = `${req.protocol}://${req.get('host')}/?poster=${id}`;
    res.json({ success: true, id, url });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.get('/api/load/:id', (req, res) => {
  try {
    const { id } = req.params;
    const config = posterStore.get(id);
    if (!config) {
      res.status(404).json({ success: false, error: 'Poster not found' });
      return;
    }
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Poster share server running on http://localhost:${PORT}`);
});
