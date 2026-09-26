import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import type { Event, EventStats, CreateEventRequest, CreateAttendanceRequest } from './types';
import {
  addEvent,
  getEvent,
  addAttendance,
  getAttendances,
  getNextSerial,
  hasCheckedInByPhone,
  getOnlineCount
} from './store';

const router = Router();

router.post('/events', async (req: Request<{}, {}, CreateEventRequest & { origin?: string }>, res: Response) => {
  try {
    const { name, location, time, description, expectedCount, origin } = req.body;

    if (!name || !location || !time) {
      return res.status(400).json({ message: '缺少必填字段' });
    }

    if (!origin) {
      return res.status(400).json({ message: '缺少 origin 参数，无法生成签到链接' });
    }

    const eventId = uuidv4();
    const checkInUrl = `${origin}/attendance/${eventId}`;
    
    const qrCodeDataUrl = await QRCode.toDataURL(checkInUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#333333',
        light: '#ffffff'
      }
    });

    const event: Event = {
      id: eventId,
      name,
      location,
      time,
      description: description || '',
      expectedCount: expectedCount || 100,
      createdAt: new Date().toISOString(),
      qrCode: qrCodeDataUrl
    };

    addEvent(event);

    res.status(201).json(event);
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ message: '创建活动失败' });
  }
});

router.get('/events/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const event = getEvent(req.params.id);
    if (!event) {
      return res.status(404).json({ message: '活动不存在' });
    }
    res.json(event);
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ message: '获取活动信息失败' });
  }
});

router.post('/attendance', (req: Request<{}, {}, CreateAttendanceRequest>, res: Response) => {
  const startTime = Date.now();
  try {
    const { eventId, name, phone, gender } = req.body;

    if (!eventId || !name) {
      return res.status(400).json({ message: '缺少必填字段' });
    }

    const event = getEvent(eventId);
    if (!event) {
      return res.status(404).json({ message: '活动不存在' });
    }

    const currentAttendance = getAttendances(eventId).length;
    if (currentAttendance >= event.expectedCount) {
      return res.status(400).json({ message: '人数已满' });
    }

    if (phone && hasCheckedInByPhone(eventId, phone)) {
      return res.status(400).json({ message: '该手机号已签到' });
    }

    const existingByName = getAttendances(eventId).find(a => a.name === name);
    if (existingByName && !phone) {
      return res.status(400).json({ message: '该姓名已签到，请提供手机号区分' });
    }

    const serialNumber = getNextSerial(eventId);
    const attendance = {
      id: uuidv4(),
      eventId,
      name,
      phone,
      gender,
      checkInTime: new Date().toISOString(),
      serialNumber
    };

    addAttendance(attendance);

    const wss = req.app.get('wss');
    if (wss) {
      wss.broadcast(eventId, {
        type: 'newAttendance',
        attendance
      });
    }

    const duration = Date.now() - startTime;
    console.log(`Check-in processed in ${duration}ms`);

    res.json({
      success: true,
      serialNumber,
      checkInTime: attendance.checkInTime
    });
  } catch (error) {
    console.error('Check-in error:', error);
    res.status(500).json({ message: '签到失败' });
  }
});

router.get('/events/:id/attendance', (req: Request<{ id: string }, {}, {}, { limit?: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
    const attendances = getAttendances(id, limit);
    res.json(attendances);
  } catch (error) {
    console.error('Get attendances error:', error);
    res.status(500).json({ message: '获取签到记录失败' });
  }
});

router.get('/events/:id/stats', (req: Request<{ id: string }>, res: Response) => {
  try {
    const { id } = req.params;
    const event = getEvent(id);

    if (!event) {
      return res.status(404).json({ message: '活动不存在' });
    }

    const attendances = getAttendances(id);
    const totalAttendance = attendances.length;

    let maleCount = 0;
    let femaleCount = 0;
    const hourlyMap: Map<number, number> = new Map();

    for (let i = 0; i < 24; i++) {
      hourlyMap.set(i, 0);
    }

    attendances.forEach(a => {
      if (a.gender === 'male') maleCount++;
      if (a.gender === 'female') femaleCount++;

      const hour = new Date(a.checkInTime).getHours();
      hourlyMap.set(hour, (hourlyMap.get(hour) || 0) + 1);
    });

    const hourlyDistribution = Array.from(hourlyMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([hour, count]) => ({ hour, count }));

    const attendanceRate = event.expectedCount > 0
      ? (totalAttendance / event.expectedCount) * 100
      : 0;

    const stats: EventStats = {
      totalAttendance,
      maleCount,
      femaleCount,
      hourlyDistribution,
      attendanceRate,
      expectedCount: event.expectedCount,
      onlineCount: getOnlineCount(id)
    };

    res.json(stats);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: '获取统计数据失败' });
  }
});

export default router;
