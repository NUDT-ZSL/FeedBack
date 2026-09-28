import express = require('express');
import cors = require('cors');
import type { Request, Response } from 'express';
import { skills, getSkillById, jobs } from './data';
import { calculateLearningPath } from './utils/pathCalculator';
import type { PlanRequest, PlanResponse, SkillNode, JobRequirement } from './types';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.get('/api/skills', (_req: Request, res: Response<{ skills: SkillNode[]; jobs: JobRequirement[] }>) => {
  try {
    res.json({
      skills,
      jobs
    });
  } catch (error) {
    res.status(500).json({
      skills: [],
      jobs: []
    });
  }
});

app.post('/api/plan', async (req: Request<unknown, unknown, PlanRequest>, res: Response<PlanResponse | { error: string }>) => {
  try {
    const { currentProficiencies, targetJobId, maxHoursPerWeek } = req.body;

    if (!targetJobId) {
      return res.status(400).json({ error: 'targetJobId is required' });
    }

    if (!currentProficiencies || !Array.isArray(currentProficiencies)) {
      return res.status(400).json({ error: 'currentProficiencies must be an array' });
    }

    const job = jobs.find(j => j.id === targetJobId);
    if (!job) {
      return res.status(404).json({ error: `Job not found: ${targetJobId}` });
    }

    const plan = await calculateLearningPath({
      currentProficiencies,
      targetJobId,
      maxHoursPerWeek
    });

    res.json(plan);
  } catch (error) {
    console.error('Error calculating plan:', error);
    res.status(500).json({ error: 'Failed to calculate learning plan' });
  }
});

app.get('/api/resources/:skillId', (req: Request<{ skillId: string }>, res: Response) => {
  try {
    const { skillId } = req.params;
    const skill = getSkillById(skillId);

    if (!skill) {
      return res.status(404).json({ error: `Skill not found: ${skillId}` });
    }

    res.json({
      skillId: skill.id,
      skillName: skill.name,
      resources: skill.resources
    });
  } catch (error) {
    console.error('Error fetching resources:', error);
    res.status(500).json({ error: 'Failed to fetch learning resources' });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Skill learning server running on http://localhost:${PORT}`);
  console.log(`API Endpoints:`);
  console.log(`  GET  /api/skills`);
  console.log(`  POST /api/plan`);
  console.log(`  GET  /api/resources/:skillId`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
