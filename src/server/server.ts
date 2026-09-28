import express from 'express';
import cors from 'cors';
import { Parser } from 'json2csv';
import {
  stalls,
  reservations,
  owners,
  generateId,
  getTimeSlots,
  getSlotRemaining,
  Stall,
  Reservation,
} from './data.js';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const owner = owners.find((o) => o.username === username && o.password === password);
  if (!owner) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  res.json({ id: owner.id, username: owner.username, displayName: owner.displayName });
});

app.post('/api/register', (req, res) => {
  const { username, password, displayName } = req.body;
  if (owners.find((o) => o.username === username)) {
    return res.status(400).json({ error: '用户名已存在' });
  }
  const newOwner = {
    id: generateId(),
    username,
    password,
    displayName,
  };
  owners.push(newOwner);
  res.status(201).json({ id: newOwner.id, username: newOwner.username, displayName: newOwner.displayName });
});

app.get('/api/stalls', (_req, res) => {
  const result = stalls.map((stall) => {
    const slots = getTimeSlots(stall);
    let availableSlots = 0;
    for (const slot of slots) {
      if (getSlotRemaining(stall, slot.label) > 0) {
        availableSlots++;
      }
    }
    return {
      ...stall,
      totalSlots: slots.length,
      availableSlots,
    };
  });
  res.json(result);
});

app.get('/api/stalls/:id', (req, res) => {
  const stall = stalls.find((s) => s.id === req.params.id);
  if (!stall) {
    return res.status(404).json({ error: '摊位不存在' });
  }
  const slotDetails = getTimeSlots(stall).map((slot) => {
    const remaining = getSlotRemaining(stall, slot.label);
    return {
      ...slot,
      remaining,
      isFull: remaining <= 0,
    };
  });
  res.json({ ...stall, timeSlots: slotDetails });
});

app.post('/api/stalls', (req, res) => {
  const { ownerId, name, description, photoUrl, category, businessHoursStart, businessHoursEnd, maxReservations } = req.body;
  const newStall: Stall = {
    id: generateId(),
    ownerId,
    name,
    description,
    photoUrl,
    category,
    businessHoursStart: Number(businessHoursStart),
    businessHoursEnd: Number(businessHoursEnd),
    maxReservations: Number(maxReservations),
  };
  stalls.push(newStall);
  res.status(201).json(newStall);
});

app.delete('/api/stalls/:id', (req, res) => {
  const idx = stalls.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: '摊位不存在' });
  }
  stalls.splice(idx, 1);
  res.json({ success: true });
});

app.post('/api/reservations', (req, res) => {
  const { stallId, customerName, customerPhone, timeSlot } = req.body;
  const stall = stalls.find((s) => s.id === stallId);
  if (!stall) {
    return res.status(404).json({ error: '摊位不存在' });
  }
  const remaining = getSlotRemaining(stall, timeSlot);
  if (remaining <= 0) {
    return res.status(400).json({ error: '该时段已约满' });
  }
  const newReservation: Reservation = {
    id: generateId(),
    stallId,
    customerName,
    customerPhone,
    timeSlot,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  reservations.push(newReservation);
  res.status(201).json(newReservation);
});

app.get('/api/reservations', (req, res) => {
  const { ownerId } = req.query;
  let filtered = [...reservations];
  if (ownerId) {
    const ownerStallIds = stalls.filter((s) => s.ownerId === ownerId).map((s) => s.id);
    filtered = filtered.filter((r) => ownerStallIds.includes(r.stallId));
  }
  const enriched = filtered.map((r) => ({
    ...r,
    stallName: stalls.find((s) => s.id === r.stallId)?.name || '未知摊位',
  }));
  res.json(enriched);
});

app.put('/api/reservations/:id/approve', (req, res) => {
  const reservation = reservations.find((r) => r.id === req.params.id);
  if (!reservation) {
    return res.status(404).json({ error: '预约不存在' });
  }
  reservation.status = 'confirmed';
  res.json(reservation);
});

app.put('/api/reservations/:id/reject', (req, res) => {
  const reservation = reservations.find((r) => r.id === req.params.id);
  if (!reservation) {
    return res.status(404).json({ error: '预约不存在' });
  }
  reservation.status = 'cancelled';
  res.json(reservation);
});

app.get('/api/reservations/export', (req, res) => {
  const { ownerId } = req.query;
  let filtered = reservations.filter((r) => r.status === 'confirmed');
  if (ownerId) {
    const ownerStallIds = stalls.filter((s) => s.ownerId === ownerId).map((s) => s.id);
    filtered = filtered.filter((r) => ownerStallIds.includes(r.stallId));
  }
  const today = new Date().toISOString().split('T')[0];
  const todayReservations = filtered.filter((r) => r.createdAt.startsWith(today));
  const data = todayReservations.map((r) => ({
    摊位名称: stalls.find((s) => s.id === r.stallId)?.name || '未知',
    顾客姓名: r.customerName,
    联系电话: r.customerPhone,
    预约时段: r.timeSlot,
    状态: '已确认',
  }));
  const parser = new Parser();
  const csv = parser.parse(data);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=reservations.csv');
  res.send('\uFEFF' + csv);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🛒 创意市集服务器运行在 http://localhost:${PORT}`);
});
