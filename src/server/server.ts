import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import QRCode from 'qrcode';
import {
  addEvent,
  getEvents,
  getEventById,
  register,
  getRegistrationById,
  getRegistrationsByEvent,
  verify,
} from './db-service';
import type {
  CreateEventRequest,
  RegisterRequest,
  VerifyRequest,
} from '../shared/types';

const app = express();
const PORT = 8080;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/events', (_req, res) => {
  try {
    const events = getEvents();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: '获取活动列表失败' });
  }
});

app.post('/api/events', (req, res) => {
  try {
    const body = req.body as CreateEventRequest;
    if (!body.name || !body.dateTime || !body.location || !body.maxCapacity || !body.description) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    const event = addEvent(body);
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: '创建活动失败' });
  }
});

app.get('/api/events/:id', (req, res) => {
  try {
    const event = getEventById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: '活动不存在' });
    }
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: '获取活动详情失败' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const body = req.body as RegisterRequest;
    if (!body.eventId || !body.name || !body.email) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    const result = register(body);
    if ('error' in result) {
      return res.status(400).json({ error: result.error });
    }
    const qrPayload = JSON.stringify({
      registrationId: result.id,
      eventId: result.eventId,
      name: result.name,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 320,
      margin: 2,
      color: {
        dark: '#1a2a6c',
        light: '#ffffff',
      },
    });
    res.status(201).json({
      registration: result,
      qrCodeDataUrl,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '报名失败' });
  }
});

app.get('/api/registrations/:id', (req, res) => {
  try {
    const reg = getRegistrationById(req.params.id);
    if (!reg) {
      return res.status(404).json({ error: '报名记录不存在' });
    }
    res.json(reg);
  } catch (err) {
    res.status(500).json({ error: '获取报名信息失败' });
  }
});

app.get('/api/registrations/event/:eventId', (req, res) => {
  try {
    const list = getRegistrationsByEvent(req.params.eventId);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: '获取报名名单失败' });
  }
});

app.post('/api/verify', (req, res) => {
  try {
    const body = req.body as VerifyRequest;
    if (!body.registrationId || !body.eventId) {
      return res.status(400).json({ success: false, message: '缺少必填字段' });
    }
    const result = verify(body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: '签到验证失败' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Activity Registration Server running at http://localhost:${PORT}`);
});
