import express from 'express';
import cors from 'cors';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import path from 'path';
import type { Plant, Task, User, WateringRecord, PlantCreate, TaskCreate, TaskUpdate, WateringRecordCreate } from '../src/types';
import { initialPlants, initialTasks, initialNeighbors, initialWateringRecords } from '../src/data';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Data {
  plants: Plant[];
  tasks: Task[];
  neighbors: User[];
  wateringRecords: WateringRecord[];
}

const dbFile = path.join(__dirname, 'db.json');
const adapter = new JSONFile<Data>(dbFile);
const db = new Low(adapter, {
  plants: initialPlants,
  tasks: initialTasks,
  neighbors: initialNeighbors,
  wateringRecords: initialWateringRecords,
});

await db.write();
await db.read();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/plants', (_req, res) => {
  res.json(db.data!.plants);
});

app.post('/api/plants', (req, res) => {
  const body: PlantCreate = req.body;
  const plant: Plant = {
    id: uuidv4(),
    ...body,
    status: 'watered',
    addedAt: new Date().toISOString(),
    lastWateredAt: null,
  };
  db.data!.plants.push(plant);
  db.write();
  res.json(plant);
});

app.put('/api/plants/:id', (req, res) => {
  const { id } = req.params;
  const plant = db.data!.plants.find(p => p.id === id);
  if (plant) {
    Object.assign(plant, req.body);
    db.write();
    res.json(plant);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.delete('/api/plants/:id', (req, res) => {
  const { id } = req.params;
  const index = db.data!.plants.findIndex(p => p.id === id);
  if (index > -1) {
    db.data!.plants.splice(index, 1);
    db.write();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.get('/api/tasks', (_req, res) => {
  res.json(db.data!.tasks);
});

app.post('/api/tasks', (req, res) => {
  const body: TaskCreate = req.body;
  const task: Task = {
    id: uuidv4(),
    ...body,
    accepterId: null,
    accepterName: null,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  db.data!.tasks.push(task);
  db.write();
  res.json(task);
});

app.put('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const task = db.data!.tasks.find(t => t.id === id);
  const body: TaskUpdate = req.body;
  if (task) {
    Object.assign(task, body);
    db.write();
    res.json(task);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  const { id } = req.params;
  const index = db.data!.tasks.findIndex(t => t.id === id);
  if (index > -1) {
    db.data!.tasks.splice(index, 1);
    db.write();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.get('/api/neighbors', (_req, res) => {
  const sorted = [...db.data!.neighbors].sort((a, b) => {
    const scoreA = a.creditScore - a.distance * 10;
    const scoreB = b.creditScore - b.distance * 10;
    return scoreB - scoreA;
  });
  res.json(sorted);
});

app.get('/api/plants/:id/watering', (req, res) => {
  const { id } = req.params;
  const records = db.data!.wateringRecords
    .filter(r => r.plantId === id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json(records);
});

app.post('/api/plants/:id/watering', (req, res) => {
  const { id } = req.params;
  const body: WateringRecordCreate = req.body;
  const record: WateringRecord = {
    id: uuidv4(),
    ...body,
    plantId: id,
    photos: body.photos || [],
    note: body.note || '',
    timestamp: new Date().toISOString(),
  };
  db.data!.wateringRecords.push(record);

  const plant = db.data!.plants.find(p => p.id === id);
  if (plant && record.type === 'water') {
    plant.status = 'watered';
    plant.lastWateredAt = record.timestamp;
  }
  db.write();
  res.json(record);
});

app.get('/api/watering', (_req, res) => {
  res.json(db.data!.wateringRecords);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
