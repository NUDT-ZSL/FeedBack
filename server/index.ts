import express from 'express';
import cors from 'cors';
import { simulateBattle } from './battleEngine';
import { storageService } from './storage';
import { CharacterConfig, SavedConfig } from '../src/types';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.post('/api/battle/simulate', (req, res) => {
  try {
    const { player1, player2 } = req.body as {
      player1: CharacterConfig;
      player2: CharacterConfig;
    };

    if (!player1 || !player2) {
      return res.status(400).json({ error: 'Missing player configurations' });
    }

    const result = simulateBattle(player1, player2);
    res.json(result);
  } catch (error) {
    console.error('Battle simulation error:', error);
    res.status(500).json({ error: 'Failed to simulate battle' });
  }
});

app.get('/api/configs', (req, res) => {
  try {
    const configs = storageService.getAllConfigs();
    res.json(configs);
  } catch (error) {
    console.error('Get configs error:', error);
    res.status(500).json({ error: 'Failed to get configs' });
  }
});

app.post('/api/configs', (req, res) => {
  try {
    const config = req.body as Omit<SavedConfig, 'id' | 'createdAt'>;
    const savedConfig = storageService.saveConfig(config);
    res.status(201).json(savedConfig);
  } catch (error) {
    console.error('Save config error:', error);
    res.status(500).json({ error: 'Failed to save config' });
  }
});

app.delete('/api/configs/:id', (req, res) => {
  try {
    const { id } = req.params;
    const deleted = storageService.deleteConfig(id);
    if (deleted) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Config not found' });
    }
  } catch (error) {
    console.error('Delete config error:', error);
    res.status(500).json({ error: 'Failed to delete config' });
  }
});

app.patch('/api/configs/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body as { status: 'verified' | 'pending' };
    const updated = storageService.updateConfigStatus(id, status);
    if (updated) {
      res.json(updated);
    } else {
      res.status(404).json({ error: 'Config not found' });
    }
  } catch (error) {
    console.error('Update config status error:', error);
    res.status(500).json({ error: 'Failed to update config status' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
