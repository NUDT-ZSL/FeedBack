import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { projects, registrations, users } from '../data';
import { Project, Registration } from '../types';
import { authenticateToken } from './users';

const router = express.Router();

declare global {
  var wss: any;
}

const broadcastToAdmins = (message: any) => {
  if (global.wss) {
    global.wss.clients.forEach((client: any) => {
      if (client.readyState === 1 && client.userRole === 'admin') {
        client.send(JSON.stringify(message));
      }
    });
  }
};

const broadcastToUser = (userId: string, message: any) => {
  if (global.wss) {
    global.wss.clients.forEach((client: any) => {
      if (client.readyState === 1 && client.userId === userId) {
        client.send(JSON.stringify(message));
      }
    });
  }
};

router.get('/', (req, res) => {
  const { page = 1, limit = 20, search, type, dateFrom, dateTo } = req.query;
  
  let filteredProjects = [...projects];

  if (search) {
    const searchLower = (search as string).toLowerCase();
    filteredProjects = filteredProjects.filter(p =>
      p.name.toLowerCase().includes(searchLower) ||
      p.description.toLowerCase().includes(searchLower) ||
      p.location.toLowerCase().includes(searchLower)
    );
  }

  if (type) {
    filteredProjects = filteredProjects.filter(p => p.type === type);
  }

  if (dateFrom) {
    filteredProjects = filteredProjects.filter(p => p.serviceDate >= dateFrom);
  }

  if (dateTo) {
    filteredProjects = filteredProjects.filter(p => p.serviceDate <= dateTo);
  }

  const startIndex = (Number(page) - 1) * Number(limit);
  const paginatedProjects = filteredProjects.slice(startIndex, startIndex + Number(limit));

  const projectsWithStats = paginatedProjects.map(project => {
    const approvedCount = registrations.filter(
      r => r.projectId === project.id && r.status === 'approved'
    ).length;
    return {
      ...project,
      registeredCount: approvedCount,
      remainingSlots: Math.max(0, project.maxVolunteers - approvedCount)
    };
  });

  res.json({
    projects: projectsWithStats,
    total: filteredProjects.length,
    page: Number(page),
    limit: Number(limit),
    hasMore: startIndex + Number(limit) < filteredProjects.length
  });
});

router.get('/:id', (req, res) => {
  const project = projects.find(p => p.id === req.params.id);
  
  if (!project) {
    return res.status(404).json({ message: '项目不存在' });
  }

  const projectRegistrations = registrations.filter(r => r.projectId === req.params.id);
  const approvedRegistrations = projectRegistrations.filter(r => r.status === 'approved');
  
  const registeredVolunteers = approvedRegistrations.map(r => {
    const user = users.find(u => u.id === r.userId);
    return {
      id: r.id,
      userId: r.userId,
      nickname: user?.nickname,
      avatar: user?.avatar,
      status: r.status,
      serviceHours: r.serviceHours
    };
  });

  res.json({
    ...project,
    registeredCount: approvedRegistrations.length,
    remainingSlots: Math.max(0, project.maxVolunteers - approvedRegistrations.length),
    registeredVolunteers
  });
});

router.post('/', authenticateToken, (req, res) => {
  const userRole = (req as any).user.role;
  
  if (userRole !== 'admin') {
    return res.status(403).json({ message: '无权限创建项目' });
  }

  const { name, description, location, serviceDate, startTime, endTime, maxVolunteers, type, deadline } = req.body;

  if (!name || !description || !location || !serviceDate || !startTime || !endTime || !maxVolunteers || !type || !deadline) {
    return res.status(400).json({ message: '请填写完整信息' });
  }

  if (maxVolunteers < 1 || maxVolunteers > 20) {
    return res.status(400).json({ message: '志愿者人数必须在1-20之间' });
  }

  const newProject: Project = {
    id: uuidv4(),
    name,
    description,
    location,
    serviceDate,
    startTime,
    endTime,
    maxVolunteers,
    type,
    deadline,
    createdAt: new Date(),
    status: 'active'
  };

  projects.unshift(newProject);

  res.status(201).json(newProject);
});

router.post('/:id/register', authenticateToken, (req, res) => {
  const userId = (req as any).user.id;
  const projectId = req.params.id;
  const { remark } = req.body;

  const project = projects.find(p => p.id === projectId);
  
  if (!project) {
    return res.status(404).json({ message: '项目不存在' });
  }

  const now = new Date();
  const deadline = new Date(project.deadline);
  if (now > deadline) {
    return res.status(400).json({ message: '报名已截止' });
  }

  const existingRegistration = registrations.find(r => r.userId === userId && r.projectId === projectId);
  if (existingRegistration) {
    return res.status(400).json({ message: '您已报名该项目' });
  }

  const approvedCount = registrations.filter(
    r => r.projectId === projectId && r.status === 'approved'
  ).length;
  if (approvedCount >= project.maxVolunteers) {
    return res.status(400).json({ message: '名额已满' });
  }

  const newRegistration: Registration = {
    id: uuidv4(),
    userId,
    projectId,
    remark: remark || '',
    status: 'pending',
    serviceHours: 0,
    createdAt: new Date()
  };

  registrations.push(newRegistration);

  const user = users.find(u => u.id === userId);
  broadcastToAdmins({
    type: 'registration',
    data: {
      registration: newRegistration,
      user: { nickname: user?.nickname, id: userId },
      project: { name: project.name, id: projectId }
    }
  });

  res.status(201).json(newRegistration);
});

router.put('/:projectId/registrations/:registrationId/approve', authenticateToken, (req, res) => {
  const userRole = (req as any).user.role;
  
  if (userRole !== 'admin') {
    return res.status(403).json({ message: '无权限审批' });
  }

  const { status } = req.body;
  const registration = registrations.find(r => r.id === req.params.registrationId);

  if (!registration) {
    return res.status(404).json({ message: '报名记录不存在' });
  }

  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ message: '无效的状态值' });
  }

  registration.status = status;
  registration.reviewedAt = new Date();

  broadcastToUser(registration.userId, {
    type: 'approval',
    data: {
      registrationId: registration.id,
      projectId: registration.projectId,
      status
    }
  });

  res.json(registration);
});

router.put('/:projectId/registrations/:registrationId/hours', authenticateToken, (req, res) => {
  const userRole = (req as any).user.role;
  
  if (userRole !== 'admin') {
    return res.status(403).json({ message: '无权限录入时长' });
  }

  const { hours } = req.body;
  const registration = registrations.find(r => r.id === req.params.registrationId);

  if (!registration) {
    return res.status(404).json({ message: '报名记录不存在' });
  }

  if (registration.status !== 'approved') {
    return res.status(400).json({ message: '只能录入已通过审批的服务时长' });
  }

  if (hours < 0 || hours > 24) {
    return res.status(400).json({ message: '服务时长无效' });
  }

  const oldHours = registration.serviceHours;
  registration.serviceHours = hours;

  const user = users.find(u => u.id === registration.userId);
  if (user) {
    user.totalHours = user.totalHours - oldHours + hours;

    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthRecord = user.monthlyHours.find(m => m.month === currentMonth);
    if (monthRecord) {
      monthRecord.hours = monthRecord.hours - oldHours + hours;
    } else {
      user.monthlyHours.push({ month: currentMonth, hours });
    }
  }

  res.json(registration);
});

router.get('/admin/registrations', authenticateToken, (req, res) => {
  const userRole = (req as any).user.role;
  
  if (userRole !== 'admin') {
    return res.status(403).json({ message: '无权限访问' });
  }

  const allRegistrations = registrations.map(r => {
    const user = users.find(u => u.id === r.userId);
    const project = projects.find(p => p.id === r.projectId);
    return {
      ...r,
      userNickname: user?.nickname,
      projectName: project?.name,
      projectType: project?.type
    };
  });

  res.json(allRegistrations);
});

export default router;
