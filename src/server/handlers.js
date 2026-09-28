import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import data, { jwtSecret } from './data.js';

let wsBroadcastFn = null;
let wsSendToUserFn = null;

export function setWSCallbacks(broadcastFn, sendToUserFn) {
  wsBroadcastFn = broadcastFn;
  wsSendToUserFn = sendToUserFn;
}

function broadcast(type, payload) {
  if (wsBroadcastFn) {
    wsBroadcastFn({ type, payload, timestamp: Date.now() });
  }
}

function sendToUser(userId, type, payload) {
  if (wsSendToUserFn) {
    wsSendToUserFn(userId, { type, payload, timestamp: Date.now() });
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, jwtSecret);
    const user = data.findUserById(decoded.id);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    req.user = sanitizeUser(user);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token无效或已过期' });
  }
}

function directorOnly(req, res, next) {
  if (!req.user || req.user.role !== 'director') {
    return res.status(403).json({ error: '仅导演可执行此操作' });
  }
  next();
}

function actorOnly(req, res, next) {
  if (!req.user || req.user.role !== 'actor') {
    return res.status(403).json({ error: '仅演员可执行此操作' });
  }
  next();
}

export const authHandler = {
  async register(req, res) {
    try {
      const { email, password, name, role } = req.body;
      if (!email || !password || !name || !role) {
        return res.status(400).json({ error: '请填写所有必填字段' });
      }
      if (!['actor', 'director'].includes(role)) {
        return res.status(400).json({ error: '用户角色无效' });
      }
      if (data.findUserByEmail(email)) {
        return res.status(400).json({ error: '该邮箱已被注册' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: '密码长度至少6位' });
      }
      const salt = bcrypt.genSaltSync(10);
      const hashed = bcrypt.hashSync(password, salt);
      const bgColor = role === 'director' ? '722F37' : 'D4AF37';
      const user = data.addUser({
        email,
        password: hashed,
        name,
        role,
        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=${bgColor}`,
      });
      const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: '7d' });
      res.json({ user: sanitizeUser(user), token });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: '注册失败' });
    }
  },

  async login(req, res) {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: '请输入邮箱和密码' });
      }
      const user = data.findUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      const valid = bcrypt.compareSync(password, user.password);
      if (!valid) {
        return res.status(401).json({ error: '邮箱或密码错误' });
      }
      const token = jwt.sign({ id: user.id, role: user.role }, jwtSecret, { expiresIn: '7d' });
      res.json({ user: sanitizeUser(user), token });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: '登录失败' });
    }
  },

  me(req, res) {
    res.json({ user: req.user });
  },
};

export const playHandler = {
  list(req, res) {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 12;
    const search = req.query.search || '';
    const result = data.getPlays({ page, pageSize, search });
    res.json(result);
  },

  myPlays(req, res) {
    const result = data.getPlaysByDirector(req.user.id);
    res.json(result);
  },

  get(req, res) {
    const play = data.getPlayById(req.params.id);
    if (!play) return res.status(404).json({ error: '剧本不存在' });
    res.json(play);
  },

  create(req, res) {
    const { title, author, coverUrl, synopsis, deadline } = req.body;
    if (!title || !author) {
      return res.status(400).json({ error: '标题和作者为必填项' });
    }
    const play = data.addPlay({
      directorId: req.user.id,
      title,
      author,
      coverUrl: coverUrl || '',
      synopsis: synopsis || '',
      deadline: deadline || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    broadcast('play_update', { play, action: 'create' });
    res.json(play);
  },

  update(req, res) {
    const play = data.getPlayById(req.params.id);
    if (!play) return res.status(404).json({ error: '剧本不存在' });
    if (play.directorId !== req.user.id) {
      return res.status(403).json({ error: '无权修改此剧本' });
    }
    const { title, author, coverUrl, synopsis, deadline } = req.body;
    const updated = data.updatePlay(req.params.id, {
      title: title || play.title,
      author: author || play.author,
      coverUrl: coverUrl !== undefined ? coverUrl : play.coverUrl,
      synopsis: synopsis !== undefined ? synopsis : play.synopsis,
      deadline: deadline || play.deadline,
    });
    broadcast('play_update', { play: updated, action: 'update' });
    res.json(updated);
  },

  delete(req, res) {
    const play = data.getPlayById(req.params.id);
    if (!play) return res.status(404).json({ error: '剧本不存在' });
    if (play.directorId !== req.user.id) {
      return res.status(403).json({ error: '无权删除此剧本' });
    }
    data.deletePlay(req.params.id);
    broadcast('play_update', { playId: req.params.id, action: 'delete' });
    res.json({ success: true });
  },
};

export const roleHandler = {
  create(req, res) {
    const play = data.getPlayById(req.params.playId);
    if (!play) return res.status(404).json({ error: '剧本不存在' });
    if (play.directorId !== req.user.id) {
      return res.status(403).json({ error: '无权操作此剧本' });
    }
    const { name, gender, ageMin, ageMax, dialogue } = req.body;
    if (!name) return res.status(400).json({ error: '角色名称必填' });
    const role = data.addRole({
      playId: req.params.playId,
      name,
      gender: gender || 'any',
      ageMin: parseInt(ageMin) || 0,
      ageMax: parseInt(ageMax) || 100,
      dialogue: dialogue || '',
    });
    const updatedPlay = data.getPlayById(req.params.playId);
    broadcast('play_update', { play: updatedPlay, action: 'update' });
    res.json(role);
  },

  update(req, res) {
    const role = data.getRoleById(req.params.roleId);
    if (!role) return res.status(404).json({ error: '角色不存在' });
    const play = data.getPlayById(role.playId);
    if (!play || play.directorId !== req.user.id) {
      return res.status(403).json({ error: '无权操作此角色' });
    }
    const { name, gender, ageMin, ageMax, dialogue } = req.body;
    const updated = data.updateRole(req.params.roleId, {
      name: name || role.name,
      gender: gender || role.gender,
      ageMin: ageMin !== undefined ? parseInt(ageMin) : role.ageMin,
      ageMax: ageMax !== undefined ? parseInt(ageMax) : role.ageMax,
      dialogue: dialogue !== undefined ? dialogue : role.dialogue,
    });
    const updatedPlay = data.getPlayById(role.playId);
    broadcast('play_update', { play: updatedPlay, action: 'update' });
    res.json(updated);
  },

  delete(req, res) {
    const role = data.getRoleById(req.params.roleId);
    if (!role) return res.status(404).json({ error: '角色不存在' });
    const play = data.getPlayById(role.playId);
    if (!play || play.directorId !== req.user.id) {
      return res.status(403).json({ error: '无权操作此角色' });
    }
    data.deleteRole(req.params.roleId);
    const updatedPlay = data.getPlayById(role.playId);
    broadcast('play_update', { play: updatedPlay, action: 'update' });
    res.json({ success: true });
  },

  reorder(req, res) {
    const { roleIds } = req.body;
    if (!Array.isArray(roleIds)) {
      return res.status(400).json({ error: 'roleIds必须为数组' });
    }
    data.reorderRoles(req.params.playId, roleIds);
    const play = data.getPlayById(req.params.playId);
    broadcast('play_update', { play, action: 'update' });
    res.json({ success: true });
  },

  applications(req, res) {
    const role = data.getRoleById(req.params.roleId);
    if (!role) return res.status(404).json({ error: '角色不存在' });
    const play = data.getPlayById(role.playId);
    if (!play || play.directorId !== req.user.id) {
      return res.status(403).json({ error: '无权查看报名信息' });
    }
    const list = data.getApplicationsByRole(req.params.roleId);
    res.json(list);
  },
};

export const applicationHandler = {
  apply(req, res) {
    const role = data.getRoleById(req.params.roleId);
    if (!role) return res.status(404).json({ error: '角色不存在' });
    if (data.hasApplied(req.params.roleId, req.user.id)) {
      return res.status(400).json({ error: '您已报名此角色' });
    }
    const { introduction, experience } = req.body;
    if (!introduction) {
      return res.status(400).json({ error: '请填写自我介绍' });
    }
    if (introduction.length > 500) {
      return res.status(400).json({ error: '自我介绍不能超过500字' });
    }
    const app = data.addApplication({
      roleId: req.params.roleId,
      actorId: req.user.id,
      introduction,
      experience: experience || '',
    });
    const play = data.getPlayById(role.playId);
    const updatedPlay = data.getPlayById(role.playId);
    if (play) {
      const notif = data.addNotification({
        userId: play.directorId,
        type: 'new_application',
        title: '新的报名申请',
        content: `角色"${role.name}"收到了${req.user.name}的报名申请`,
        link: `/play/${play.id}`,
      });
      sendToUser(play.directorId, 'notification', notif);
      sendToUser(play.directorId, 'application_update', { application: app, action: 'create' });
    }
    broadcast('play_update', { play: updatedPlay, action: 'update' });
    res.json(app);
  },

  myApplications(req, res) {
    const list = data.getApplicationsByActor(req.user.id);
    res.json(list);
  },

  updateStatus(req, res) {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: '状态值无效' });
    }
    const app = data.updateApplicationStatus(req.params.id, status);
    if (!app) return res.status(404).json({ error: '报名记录不存在' });
    const role = data.getRoleById(app.roleId);
    const play = role ? data.getPlayById(role.playId) : null;

    if (status === 'approved') {
      const notif = data.addNotification({
        userId: app.actorId,
        type: 'application_approved',
        title: '报名通过',
        content: `恭喜！您申请的《${play?.title || ''}》角色"${role?.name || ''}"已通过审核`,
        link: `/play/${play?.id || ''}`,
      });
      sendToUser(app.actorId, 'notification', notif);
      sendToUser(app.actorId, 'application_status', { applicationId: app.id, status });
    } else if (status === 'rejected') {
      const notif = data.addNotification({
        userId: app.actorId,
        type: 'application_rejected',
        title: '报名未通过',
        content: `很遗憾，您申请的《${play?.title || ''}》角色"${role?.name || ''}"未通过审核`,
        link: `/play/${play?.id || ''}`,
      });
      sendToUser(app.actorId, 'notification', notif);
      sendToUser(app.actorId, 'application_status', { applicationId: app.id, status });
    }
    const updatedPlay = data.getPlayById(role?.playId);
    broadcast('play_update', { play: updatedPlay, action: 'update' });
    res.json(app);
  },
};

export const interviewHandler = {
  list(req, res) {
    const list = data.getInterviews({ userId: req.user.id, userRole: req.user.role });
    res.json(list);
  },

  create(req, res) {
    const { applicationId, startTime, endTime, location, notes } = req.body;
    if (!applicationId || !startTime || !endTime) {
      return res.status(400).json({ error: '请填写面试安排信息' });
    }
    const apps = data.getApplicationsByActor('any');
    const app = data.applications.get(applicationId);
    if (!app) return res.status(404).json({ error: '报名记录不存在' });
    const role = data.getRoleById(app.roleId);
    const play = role ? data.getPlayById(role.playId) : null;
    if (play && play.directorId !== req.user.id) {
      return res.status(403).json({ error: '无权安排此面试' });
    }
    const interview = data.addInterview({
      directorId: req.user.id,
      applicationId,
      startTime,
      endTime,
      location: location || '',
      notes: notes || '',
    });
    const notif = data.addNotification({
      userId: app.actorId,
      type: 'interview_scheduled',
      title: '面试安排',
      content: `您的《${play?.title || ''}》"${role?.name || ''}"角色面试已安排，请查看日程`,
      link: '/schedule',
    });
    sendToUser(app.actorId, 'notification', notif);
    sendToUser(app.actorId, 'interview_update', { interview, action: 'create' });
    sendToUser(req.user.id, 'interview_update', { interview, action: 'create' });
    res.json(interview);
  },

  update(req, res) {
    const interview = data.interviews.get(req.params.id);
    if (!interview) return res.status(404).json({ error: '面试安排不存在' });
    if (interview.directorId !== req.user.id) {
      return res.status(403).json({ error: '无权修改此面试安排' });
    }
    const { startTime, endTime, location, notes } = req.body;
    const updated = data.updateInterview(req.params.id, {
      startTime: startTime || interview.startTime,
      endTime: endTime || interview.endTime,
      location: location !== undefined ? location : interview.location,
      notes: notes !== undefined ? notes : interview.notes,
    });
    const app = data.applications.get(updated.applicationId);
    const role = app ? data.getRoleById(app.roleId) : null;
    const play = role ? data.getPlayById(role.playId) : null;
    if (app) {
      const notif = data.addNotification({
        userId: app.actorId,
        type: 'interview_updated',
        title: '面试时间变更',
        content: `您的《${play?.title || ''}》"${role?.name || ''}"角色面试时间有变更，请查看日程`,
        link: '/schedule',
      });
      sendToUser(app.actorId, 'notification', notif);
      sendToUser(app.actorId, 'interview_update', { interview: updated, action: 'update' });
    }
    sendToUser(req.user.id, 'interview_update', { interview: updated, action: 'update' });
    res.json(updated);
  },

  delete(req, res) {
    const interview = data.interviews.get(req.params.id);
    if (!interview) return res.status(404).json({ error: '面试安排不存在' });
    if (interview.directorId !== req.user.id) {
      return res.status(403).json({ error: '无权删除此面试安排' });
    }
    const app = data.applications.get(interview.applicationId);
    data.deleteInterview(req.params.id);
    if (app) {
      sendToUser(app.actorId, 'interview_update', { interviewId: req.params.id, action: 'delete' });
    }
    sendToUser(req.user.id, 'interview_update', { interviewId: req.params.id, action: 'delete' });
    res.json({ success: true });
  },
};

export const notificationHandler = {
  list(req, res) {
    const list = data.getNotifications(req.user.id);
    const unread = data.getUnreadCount(req.user.id);
    res.json({ list, unread });
  },

  markRead(req, res) {
    data.markNotificationsRead(req.user.id);
    res.json({ success: true });
  },
};

export { authMiddleware, directorOnly, actorOnly };
export default {
  authHandler,
  playHandler,
  roleHandler,
  applicationHandler,
  interviewHandler,
  notificationHandler,
};
