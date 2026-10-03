import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const UPDATABLE_FIELDS = ['name', 'themeColor', 'description', 'components', 'thumbnail'];

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(uploadsDir));

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    }
  });
  const upload = multer({ storage });

  const exhibitions = [];

  app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  app.post('/api/exhibitions', (req, res) => {
    const { name, themeColor, description, components, thumbnail } = req.body;
    const exhibition = {
      id: uuidv4(),
      name,
      themeColor,
      description,
      components: components || [],
      thumbnail: thumbnail || null,
      createdAt: new Date().toISOString(),
      published: false,
      version: 0
    };
    exhibitions.push(exhibition);
    res.status(201).json(exhibition);
  });

  app.get('/api/exhibitions', (req, res) => {
    const published = exhibitions.filter((e) => e.published);
    res.json(published);
  });

  app.get('/api/exhibitions/:id', (req, res) => {
    const exhibition = exhibitions.find((e) => e.id === req.params.id);
    if (!exhibition) {
      return res.status(404).json({ error: 'Exhibition not found' });
    }
    res.json(exhibition);
  });

  app.put('/api/exhibitions/:id', (req, res) => {
    const index = exhibitions.findIndex((e) => e.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Exhibition not found' });
    }

    const exhibition = exhibitions[index];
    const { version: expectedVersion, ...fields } = req.body || {};

    if (
      expectedVersion !== undefined &&
      expectedVersion !== null &&
      Number(expectedVersion) !== exhibition.version
    ) {
      return res.status(409).json({
        error: 'Version conflict: the exhibition was modified by a newer save',
        currentVersion: exhibition.version
      });
    }

    for (const field of UPDATABLE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(fields, field)) {
        exhibition[field] = fields[field];
      }
    }
    exhibition.version += 1;

    res.json(exhibition);
  });

  app.delete('/api/exhibitions/:id', (req, res) => {
    const index = exhibitions.findIndex((e) => e.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Exhibition not found' });
    }
    exhibitions.splice(index, 1);
    res.status(204).end();
  });

  app.post('/api/exhibitions/:id/publish', (req, res) => {
    const index = exhibitions.findIndex((e) => e.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Exhibition not found' });
    }
    exhibitions[index].published = true;
    exhibitions[index].version += 1;
    res.json(exhibitions[index]);
  });

  return app;
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  const PORT = process.env.PORT || 3001;
  createApp().listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
