import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { body, param, validationResult } from 'express-validator';
import type { Trip, TripCreateInput, TripReport, DayPlan, ExpenseCategory } from '../types';

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

let trips: Trip[] = [];

function generateDays(startDate: string, endDate: string): DayPlan[] {
  const days: DayPlan[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push({
      date: d.toISOString().split('T')[0],
      activities: []
    });
  }
  
  return days;
}

app.post(
  '/api/trips',
  [
    body('destination').isString().notEmpty().withMessage('目的地不能为空'),
    body('startDate').isISO8601().withMessage('开始日期格式无效'),
    body('endDate').isISO8601().withMessage('结束日期格式无效'),
    body('totalBudget').isFloat({ min: 0 }).withMessage('总预算必须 >= 0')
  ],
  (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { destination, startDate, endDate, totalBudget }: TripCreateInput = req.body;
    
    const trip: Trip = {
      id: uuidv4(),
      destination,
      startDate,
      endDate,
      totalBudget,
      days: generateDays(startDate, endDate),
      createdAt: new Date().toISOString()
    };
    
    trips.push(trip);
    res.status(201).json(trip);
  }
);

app.get('/api/trips', (_req: Request, res: Response) => {
  res.json(trips);
});

app.get(
  '/api/trips/:id',
  [
    param('id').isUUID().withMessage('无效的旅行ID')
  ],
  (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const trip = trips.find(t => t.id === req.params.id);
    if (!trip) {
      return res.status(404).json({ error: '旅行计划不存在' });
    }
    res.json(trip);
  }
);

app.put(
  '/api/trips/:id',
  [
    param('id').isUUID().withMessage('无效的旅行ID'),
    body('destination').optional().isString().notEmpty().withMessage('目的地不能为空字符串'),
    body('startDate').optional().isISO8601().withMessage('开始日期格式无效'),
    body('endDate').optional().isISO8601().withMessage('结束日期格式无效'),
    body('totalBudget').optional().isFloat({ min: 0 }).withMessage('总预算必须 >= 0'),
    body('days').optional().isArray().withMessage('days必须是数组'),
    body('days.*.date').optional().isISO8601().withMessage('day.date格式无效'),
    body('days.*.activities').optional().isArray().withMessage('day.activities必须是数组'),
    body('days.*.activities.*.id').optional().isString().notEmpty().withMessage('activity.id不能为空'),
    body('days.*.activities.*.time').optional().isString().notEmpty().withMessage('activity.time不能为空'),
    body('days.*.activities.*.location').optional().isString().notEmpty().withMessage('activity.location不能为空'),
    body('days.*.activities.*.description').optional().isString().withMessage('activity.description必须是字符串'),
    body('days.*.activities.*.transport').optional().isString().withMessage('activity.transport必须是字符串'),
    body('days.*.activities.*.cost').optional().isFloat({ min: 0 }).withMessage('activity.cost必须 >= 0'),
    body('days.*.activities.*.category').optional().isIn(['transport','accommodation','food','ticket','other']).withMessage('activity.category无效')
  ],
  (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const index = trips.findIndex(t => t.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: '旅行计划不存在' });
    }

    const body = req.body;

    const updatedTrip = Object.assign({}, trips[index]);

    if ('destination' in body) updatedTrip.destination = body.destination;
    if ('startDate' in body) updatedTrip.startDate = body.startDate;
    if ('endDate' in body) updatedTrip.endDate = body.endDate;
    if ('totalBudget' in body) updatedTrip.totalBudget = body.totalBudget;
    if ('days' in body) updatedTrip.days = body.days;

    trips[index] = updatedTrip;
    res.json(updatedTrip);
  }
);

app.delete('/api/trips/:id', (req: Request, res: Response) => {
  const index = trips.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: '旅行计划不存在' });
  }
  
  trips.splice(index, 1);
  res.status(204).send();
});

app.get(
  '/api/trips/:id/report',
  [
    param('id').isUUID().withMessage('无效的旅行ID')
  ],
  (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const trip = trips.find(t => t.id === req.params.id);
    if (!trip) {
      return res.status(404).json({ error: '旅行计划不存在' });
    }
    
    const categoryBreakdown: Record<ExpenseCategory, number> = {
      transport: 0,
      accommodation: 0,
      food: 0,
      ticket: 0,
      other: 0
    };
    
    let totalSpent = 0;
    const dailySummary = trip.days.map(day => {
      let dayTotal = 0;
      day.activities.forEach(act => {
        dayTotal += act.cost;
        categoryBreakdown[act.category] += act.cost;
      });
      totalSpent += dayTotal;
      return {
        date: day.date,
        total: dayTotal,
        count: day.activities.length
      };
    });
    
    const report: TripReport = {
      trip,
      totalSpent,
      categoryBreakdown,
      dailySummary
    };
    
    res.json(report);
  }
);

app.listen(PORT, () => {
  console.log('服务器运行在 http://localhost:' + PORT);
});
