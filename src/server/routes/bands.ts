import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { store, persistStore } from '../data/store.js';
import { Band } from '../types/index.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const { status } = req.query;
  let bands = store.bands;

  if (status && typeof status === 'string') {
    bands = bands.filter(b => b.status === status);
  }

  res.json(bands);
});

router.get('/:id', (req: Request, res: Response) => {
  const band = store.bands.find(b => b.id === req.params.id);
  if (!band) {
    return res.status(404).json({ message: '乐队不存在' });
  }
  res.json(band);
});

router.post('/', (req: Request, res: Response) => {
  const { name, description, genres, memberCount, contact, requestId } = req.body;

  if (!name || !description || !genres || !memberCount || !contact) {
    return res.status(400).json({ message: '请填写完整信息' });
  }

  if (requestId) {
    const existing = store.bands.find(b => (b as any).requestId === requestId);
    if (existing) {
      return res.status(200).json({
        id: existing.id,
        status: existing.status,
        message: '申请已提交，等待审核'
      });
    }
  }

  if (store.bands.some(b => b.name === name)) {
    return res.status(400).json({ message: '该乐队名称已存在' });
  }

  const emailRegex = /^[\w.-]+@[\w.-]+\.\w{2,}$/;
  const phoneRegex = /^1[3-9]\d{9}$/;
  if (!emailRegex.test(contact) && !phoneRegex.test(contact)) {
    return res.status(400).json({ message: '联系方式格式不正确，请输入有效邮箱或手机号' });
  }

  const newBand: Band = {
    id: uuidv4(),
    name,
    description,
    genres: Array.isArray(genres) ? genres : [genres],
    memberCount: Number(memberCount),
    contact,
    status: 'pending',
    submittedAt: new Date().toISOString()
  } as Band & { requestId?: string };

  if (requestId) {
    (newBand as any).requestId = requestId;
  }

  store.bands.push(newBand);
  persistStore();

  res.status(201).json({
    id: newBand.id,
    status: newBand.status,
    message: '申请已提交，等待审核'
  });
});

router.put('/:id', (req: Request, res: Response) => {
  const bandIndex = store.bands.findIndex(b => b.id === req.params.id);
  if (bandIndex === -1) {
    return res.status(404).json({ message: '乐队不存在' });
  }

  const { name, description, genres, memberCount, contact } = req.body;
  const band = store.bands[bandIndex];

  if (name) band.name = name;
  if (description) band.description = description;
  if (genres) band.genres = Array.isArray(genres) ? genres : [genres];
  if (memberCount) band.memberCount = Number(memberCount);
  if (contact) band.contact = contact;

  persistStore();
  res.json(band);
});

router.post('/:id/review', (req: Request, res: Response) => {
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: '无效的审核状态' });
  }

  const bandIndex = store.bands.findIndex(b => b.id === req.params.id);
  if (bandIndex === -1) {
    return res.status(404).json({ message: '乐队不存在' });
  }

  store.bands[bandIndex].status = status;
  persistStore();

  res.json({
    id: store.bands[bandIndex].id,
    status,
    message: '审核完成'
  });
});

export default router;
