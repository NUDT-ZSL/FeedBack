import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { users, registrations, projects } from '../data';
import { User } from '../types';

const router = express.Router();
const JWT_SECRET = 'volunteer-platform-secret-key';

export const authenticateToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: '未提供认证令牌' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: '认证令牌无效' });
    }
    (req as any).user = user as User;
    next();
  });
};

router.post('/register', (req, res) => {
  const { username, nickname, password } = req.body;

  if (!username || !nickname || !password) {
    return res.status(400).json({ message: '请填写完整信息' });
  }

  if (users.find(u => u.username === username)) {
    return res.status(400).json({ message: '用户名已存在' });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const newUser: User = {
    id: uuidv4(),
    username,
    nickname,
    password: hashedPassword,
    role: 'volunteer',
    avatar: '',
    totalHours: 0,
    monthlyHours: [],
    createdAt: new Date()
  };

  users.push(newUser);

  const token = jwt.sign(
    { id: newUser.id, username: newUser.username, role: newUser.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.status(201).json({
    token,
    user: {
      id: newUser.id,
      username: newUser.username,
      nickname: newUser.nickname,
      role: newUser.role,
      totalHours: newUser.totalHours
    }
  });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: '请填写用户名和密码' });
  }

  const user = users.find(u => u.username === username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: '用户名或密码错误' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      totalHours: user.totalHours,
      avatar: user.avatar
    }
  });
});

const calculateMonthlyHours = (userId: string) => {
  const userRegs = registrations.filter(r => r.userId === userId && r.status === 'approved' && r.serviceHours > 0);
  
  const monthlyMap: { [key: string]: number } = {};
  
  userRegs.forEach(reg => {
    const project = projects.find(p => p.id === reg.projectId);
    if (project) {
      const month = project.serviceDate.slice(0, 7);
      monthlyMap[month] = (monthlyMap[month] || 0) + reg.serviceHours;
    }
  });
  
  const months: { month: string; hours: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = date.toISOString().slice(0, 7);
    months.push({
      month: monthStr,
      hours: monthlyMap[monthStr] || 0
    });
  }
  
  return months;
};

router.get('/profile', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const user = users.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ message: '用户不存在' });
  }

  const userRegistrations = registrations.filter(r => r.userId === userId);
  const approvedRegistrations = userRegistrations.filter(r => r.status === 'approved');
  
  const registeredProjects = approvedRegistrations.map(r => {
    const project = projects.find(p => p.id === r.projectId);
    return {
      ...r,
      projectName: project?.name,
      serviceDate: project?.serviceDate,
      type: project?.type
    };
  });

  const monthlyHours = calculateMonthlyHours(userId);
  const totalHours = monthlyHours.reduce((sum, m) => sum + m.hours, 0);

  res.json({
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
      totalHours: totalHours,
      monthlyHours,
      avatar: user.avatar
    },
    registrations: userRegistrations,
    registeredProjects
  });
});

router.get('/ranking', (req, res) => {
  const volunteerUsers = users.filter(u => u.role === 'volunteer');
  const ranking = volunteerUsers
    .map(u => {
      const monthlyHours = calculateMonthlyHours(u.id);
      const totalHours = monthlyHours.reduce((sum, m) => sum + m.hours, 0) + u.totalHours;
      return {
        id: u.id,
        nickname: u.nickname,
        totalHours,
        avatar: u.avatar,
        isSenior: totalHours >= 50
      };
    })
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 20);

  res.json(ranking);
});

export default router;
