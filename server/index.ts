import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

app.use(cors());
app.use(express.json());

interface Plant {
  id: string;
  name: string;
  category: 'succulent' | 'green' | 'flowering' | 'cactus' | 'fern';
  purchaseDate: string;
  difficulty: 1 | 2 | 3;
  image?: string;
  nextWateringDate?: string;
  nextFertilizingDate?: string;
  createdAt: string;
}

interface CareRecord {
  id: string;
  plantId: string;
  type: 'water' | 'fertilize' | 'prune' | 'repot' | 'other';
  note?: string;
  date: string;
}

interface Database {
  plants: Plant[];
  records: CareRecord[];
}

const readDB = (): Database => {
  const data = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(data);
};

const writeDB = (db: Database) => {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
};

const calculateHealthScore = (plant: Plant, records: CareRecord[]): number => {
  const plantRecords = records.filter(r => r.plantId === plant.id);
  if (plantRecords.length === 0) return 50;

  let score = 50;
  const now = new Date();
  const purchaseDate = new Date(plant.purchaseDate);
  const daysOwned = Math.floor((now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));

  const recentRecords = plantRecords.filter(r => {
    const recordDate = new Date(r.date);
    const diffDays = Math.floor((now.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 30;
  });

  if (recentRecords.length > 0) {
    score += Math.min(recentRecords.length * 5, 25);
  }

  const hasWater = recentRecords.some(r => r.type === 'water');
  const hasFertilize = recentRecords.some(r => r.type === 'fertilize');

  if (hasWater) score += 10;
  if (hasFertilize) score += 5;

  if (plant.nextWateringDate) {
    const nextWater = new Date(plant.nextWateringDate);
    const daysDiff = Math.floor((nextWater.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 0) {
      score -= Math.min(Math.abs(daysDiff) * 2, 20);
    }
  }

  if (plant.nextFertilizingDate) {
    const nextFertilize = new Date(plant.nextFertilizingDate);
    const daysDiff = Math.floor((nextFertilize.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 0) {
      score -= Math.min(Math.abs(daysDiff) * 1, 10);
    }
  }

  const avgRecordsPerWeek = daysOwned > 7 ? (plantRecords.length / (daysOwned / 7)) : plantRecords.length;
  if (avgRecordsPerWeek >= 1) score += 5;
  if (avgRecordsPerWeek >= 2) score += 5;

  return Math.max(0, Math.min(100, score));
};

app.get('/api/plants', (_req: Request, res: Response) => {
  try {
    const db = readDB();
    res.json(db.plants);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read plants' });
  }
});

app.get('/api/plants/:id', (req: Request, res: Response) => {
  try {
    const db = readDB();
    const plant = db.plants.find(p => p.id === req.params.id);
    if (!plant) {
      res.status(404).json({ error: 'Plant not found' });
      return;
    }
    const healthScore = calculateHealthScore(plant, db.records);
    res.json({ ...plant, healthScore });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read plant' });
  }
});

app.post('/api/plants', (req: Request, res: Response) => {
  try {
    const db = readDB();
    const newPlant: Plant = {
      id: uuidv4(),
      name: req.body.name,
      category: req.body.category,
      purchaseDate: req.body.purchaseDate,
      difficulty: req.body.difficulty,
      image: req.body.image,
      nextWateringDate: req.body.nextWateringDate,
      nextFertilizingDate: req.body.nextFertilizingDate,
      createdAt: new Date().toISOString(),
    };
    db.plants.push(newPlant);
    writeDB(db);
    res.status(201).json(newPlant);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create plant' });
  }
});

app.put('/api/plants/:id', (req: Request, res: Response) => {
  try {
    const db = readDB();
    const index = db.plants.findIndex(p => p.id === req.params.id);
    if (index === -1) {
      res.status(404).json({ error: 'Plant not found' });
      return;
    }
    db.plants[index] = { ...db.plants[index], ...req.body };
    writeDB(db);
    res.json(db.plants[index]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update plant' });
  }
});

app.delete('/api/plants/:id', (req: Request, res: Response) => {
  try {
    const db = readDB();
    db.plants = db.plants.filter(p => p.id !== req.params.id);
    db.records = db.records.filter(r => r.plantId !== req.params.id);
    writeDB(db);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete plant' });
  }
});

app.get('/api/plants/:id/records', (req: Request, res: Response) => {
  try {
    const db = readDB();
    const records = db.records
      .filter(r => r.plantId === req.params.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read records' });
  }
});

app.post('/api/plants/:id/records', (req: Request, res: Response) => {
  try {
    const db = readDB();
    const plant = db.plants.find(p => p.id === req.params.id);
    if (!plant) {
      res.status(404).json({ error: 'Plant not found' });
      return;
    }
    const newRecord: CareRecord = {
      id: uuidv4(),
      plantId: req.params.id,
      type: req.body.type,
      note: req.body.note,
      date: new Date().toISOString(),
    };
    db.records.push(newRecord);

    if (req.body.type === 'water') {
      const defaultWateringDays = plant.category === 'succulent' || plant.category === 'cactus' ? 14 : 7;
      const nextWater = new Date();
      nextWater.setDate(nextWater.getDate() + defaultWateringDays);
      plant.nextWateringDate = nextWater.toISOString().split('T')[0];
    }
    if (req.body.type === 'fertilize') {
      const nextFertilize = new Date();
      nextFertilize.setDate(nextFertilize.getDate() + 30);
      plant.nextFertilizingDate = nextFertilize.toISOString().split('T')[0];
    }

    writeDB(db);
    const healthScore = calculateHealthScore(plant, db.records);
    res.status(201).json({ record: newRecord, healthScore });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create record' });
  }
});

app.get('/api/reminders/today', (_req: Request, res: Response) => {
  try {
    const db = readDB();
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const reminders: Array<{
      plantId: string;
      plantName: string;
      type: 'water' | 'fertilize';
      dueDate: string;
      daysOverdue: number;
    }> = [];

    db.plants.forEach(plant => {
      if (plant.nextWateringDate) {
        const dueDate = plant.nextWateringDate;
        const due = new Date(dueDate);
        const todayDate = new Date(today);
        const diffTime = todayDate.getTime() - due.getTime();
        const daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (daysOverdue >= 0) {
          reminders.push({
            plantId: plant.id,
            plantName: plant.name,
            type: 'water',
            dueDate,
            daysOverdue,
          });
        }
      }
      if (plant.nextFertilizingDate) {
        const dueDate = plant.nextFertilizingDate;
        const due = new Date(dueDate);
        const todayDate = new Date(today);
        const diffTime = todayDate.getTime() - due.getTime();
        const daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (daysOverdue >= 0) {
          reminders.push({
            plantId: plant.id,
            plantName: plant.name,
            type: 'fertilize',
            dueDate,
            daysOverdue,
          });
        }
      }
    });

    reminders.sort((a, b) => b.daysOverdue - a.daysOverdue);
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get reminders' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
