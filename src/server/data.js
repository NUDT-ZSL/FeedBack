import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const users = new Map();
const plays = new Map();
const roles = new Map();
const applications = new Map();
const interviews = new Map();
const notifications = new Map();

const JWT_SECRET = process.env.JWT_SECRET || 'theater-casting-secret-key-2024';

function initMockData() {
  const salt = bcrypt.genSaltSync(10);
  const hashedPwd = bcrypt.hashSync('123456', salt);

  const directorId = uuidv4();
  users.set(directorId, {
    id: directorId,
    email: 'director@theater.com',
    password: hashedPwd,
    name: '李导演',
    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=LD&backgroundColor=722F37`,
    role: 'director',
    createdAt: new Date().toISOString(),
  });

  const actor1Id = uuidv4();
  users.set(actor1Id, {
    id: actor1Id,
    email: 'actor1@theater.com',
    password: hashedPwd,
    name: '张演员',
    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=ZY&backgroundColor=D4AF37`,
    role: 'actor',
    createdAt: new Date().toISOString(),
  });

  const actor2Id = uuidv4();
  users.set(actor2Id, {
    id: actor2Id,
    email: 'actor2@theater.com',
    password: hashedPwd,
    name: '王演员',
    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=WY&backgroundColor=722F37`,
    role: 'actor',
    createdAt: new Date().toISOString(),
  });

  const actor3Id = uuidv4();
  users.set(actor3Id, {
    id: actor3Id,
    email: 'actor3@theater.com',
    password: hashedPwd,
    name: '赵演员',
    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=CY&backgroundColor=D4AF37`,
    role: 'actor',
    createdAt: new Date().toISOString(),
  });

  const deadline1 = new Date();
  deadline1.setDate(deadline1.getDate() + 14);

  const play1Id = uuidv4();
  plays.set(play1Id, {
    id: play1Id,
    directorId,
    title: '雷雨',
    author: '曹禺',
    coverUrl: 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=800&q=80',
    synopsis: '# 雷雨\n\n《雷雨》是剧作家曹禺创作的一部话剧，此剧以1925年前后的中国社会为背景，描写了一个带有浓厚封建色彩的资产阶级家庭的悲剧。\n\n## 剧情简介\n\n剧中以两个家庭、八个人物、三十年的恩怨为主线，伪善的资本家大家长周朴园，受新思想影响的单纯少年周冲，被冷漠的家庭逼疯了的蘩漪，对过去所作所为充满了罪恶感的周萍，还有意外归来的鲁侍萍，单纯着爱与被爱的鲁四凤，受压迫的工人鲁大海，贪得无厌的管家鲁贵。',
    deadline: deadline1.toISOString(),
    createdAt: new Date().toISOString(),
  });

  const role1Id = uuidv4();
  roles.set(role1Id, {
    id: role1Id,
    playId: play1Id,
    name: '周朴园',
    gender: 'male',
    ageMin: 45,
    ageMax: 60,
    dialogue: '无锡是个好地方，我年轻的时候，在无锡住过一阵。那时候，我还没有结婚，我认识了一个女子，她是一个很聪明的女子，我很爱她。',
    sortOrder: 1,
    applicationCount: 2,
  });

  const role2Id = uuidv4();
  roles.set(role2Id, {
    id: role2Id,
    playId: play1Id,
    name: '蘩漪',
    gender: 'female',
    ageMin: 30,
    ageMax: 45,
    dialogue: '一个女子，你记着，不能受两代的欺侮。我已经预备好棺材，安安静静地等死，一个人偏把我救活了又不理我。',
    sortOrder: 2,
    applicationCount: 1,
  });

  const role3Id = uuidv4();
  roles.set(role3Id, {
    id: role3Id,
    playId: play1Id,
    name: '周萍',
    gender: 'male',
    ageMin: 25,
    ageMax: 35,
    dialogue: '我疯了，我惹了祸。我对不起父亲，对不起四凤，对不起任何人。我没有办法，我只有走。',
    sortOrder: 3,
    applicationCount: 0,
  });

  const deadline2 = new Date();
  deadline2.setDate(deadline2.getDate() + 30);

  const play2Id = uuidv4();
  plays.set(play2Id, {
    id: play2Id,
    directorId,
    title: '茶馆',
    author: '老舍',
    coverUrl: 'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&q=80',
    synopsis: '# 茶馆\n\n《茶馆》是现代文学家老舍于1956年创作的话剧，剧作展示了戊戌变法、军阀混战和新中国成立前夕三个时代近半个世纪的社会风云变化。\n\n一个叫裕泰的茶馆揭示了近半个世纪中国社会的黑暗腐败、光怪陆离，以及在这个社会中的芸芸众生。',
    deadline: deadline2.toISOString(),
    createdAt: new Date().toISOString(),
  });

  const role4Id = uuidv4();
  roles.set(role4Id, {
    id: role4Id,
    playId: play2Id,
    name: '王利发',
    gender: 'male',
    ageMin: 30,
    ageMax: 60,
    dialogue: '改良！改良！越改越凉，冰凉！我按着我父亲遗留下来的老办法，多说好话，多请安，讨人人的喜欢，就不会出大岔子！',
    sortOrder: 1,
    applicationCount: 3,
  });

  const role5Id = uuidv4();
  roles.set(role5Id, {
    id: role5Id,
    playId: play2Id,
    name: '常四爷',
    gender: 'male',
    ageMin: 40,
    ageMax: 65,
    dialogue: '我爱咱们的国呀，可是谁爱我呢？盼哪，盼哪，只盼谁都讲理，谁也不欺侮谁！',
    sortOrder: 2,
    applicationCount: 1,
  });

  const deadline3 = new Date();
  deadline3.setDate(deadline3.getDate() + 21);

  const play3Id = uuidv4();
  plays.set(play3Id, {
    id: play3Id,
    directorId,
    title: '暗恋桃花源',
    author: '赖声川',
    coverUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=800&q=80',
    synopsis: '# 暗恋桃花源\n\n《暗恋桃花源》讲述了一个奇特的故事：“暗恋”和“桃花源”是两个不相干的剧组，他们都与剧场签定了当晚彩排的合约，双方争执不下，谁也不肯相让。\n\n由于演出在即，他们不得不同时在剧场中彩排，遂成就了一出古今悲喜交错的舞台奇观。',
    deadline: deadline3.toISOString(),
    createdAt: new Date().toISOString(),
  });

  const role6Id = uuidv4();
  roles.set(role6Id, {
    id: role6Id,
    playId: play3Id,
    name: '江滨柳',
    gender: 'male',
    ageMin: 22,
    ageMax: 70,
    dialogue: '有些事情，不是你说忘就能忘的。如果我这辈子还能再见到你，我一定不会让你走。',
    sortOrder: 1,
    applicationCount: 0,
  });

  const app1Id = uuidv4();
  applications.set(app1Id, {
    id: app1Id,
    roleId: role1Id,
    actorId: actor1Id,
    introduction: '我是张演员，有着5年的话剧表演经验，曾在多个剧中担任主要角色。我对周朴园这个角色有深入的理解，能展现出他的复杂性格。',
    experience: '《哈姆雷特》饰克劳狄斯、《麦克白》饰麦克白、《北京人》饰曾文清',
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  const app2Id = uuidv4();
  applications.set(app2Id, {
    id: app2Id,
    roleId: role1Id,
    actorId: actor2Id,
    introduction: '王演员，热爱表演艺术，擅长塑造有深度的人物形象。希望能有机会挑战周朴园这个经典角色。',
    experience: '《家》饰高觉新、《日出》饰潘月亭',
    status: 'pending',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  });

  const app3Id = uuidv4();
  applications.set(app3Id, {
    id: app3Id,
    roleId: role2Id,
    actorId: actor3Id,
    introduction: '赵演员，专业戏剧学院表演系毕业，擅长演绎内心复杂的女性角色。蘩漪是我最喜欢的话剧角色之一。',
    experience: '《玩偶之家》饰娜拉、《金锁记》饰曹七巧',
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  const notifId = uuidv4();
  notifications.set(notifId, {
    id: notifId,
    userId: directorId,
    type: 'new_application',
    title: '新的报名申请',
    content: '您的剧本《雷雨》中角色"周朴园"收到了新的报名申请',
    link: `/play/${play1Id}`,
    read: false,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  });
}

initMockData();

export const jwtSecret = JWT_SECRET;

export const data = {
  users,
  plays,
  roles,
  applications,
  interviews,
  notifications,

  addUser(userData) {
    const id = uuidv4();
    const user = { id, ...userData, createdAt: new Date().toISOString() };
    users.set(id, user);
    return user;
  },

  findUserByEmail(email) {
    for (const user of users.values()) {
      if (user.email === email) return user;
    }
    return null;
  },

  findUserById(id) {
    return users.get(id) || null;
  },

  getPlays({ page = 1, pageSize = 12, search = '' } = {}) {
    let result = Array.from(plays.values());
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(s) ||
          p.author.toLowerCase().includes(s) ||
          p.synopsis.toLowerCase().includes(s)
      );
    }
    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = result.length;
    const start = (page - 1) * pageSize;
    const items = result.slice(start, start + pageSize);
    const enriched = items.map((p) => this.enrichPlay(p));
    return { items: enriched, total, page, pageSize };
  },

  getPlaysByDirector(directorId) {
    const result = Array.from(plays.values())
      .filter((p) => p.directorId === directorId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return result.map((p) => this.enrichPlay(p));
  },

  enrichPlay(play) {
    const playRoles = Array.from(roles.values())
      .filter((r) => r.playId === play.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => this.enrichRole(r));
    const director = users.get(play.directorId);
    return {
      ...play,
      director: director
        ? { id: director.id, name: director.name, avatar: director.avatar, role: director.role }
        : undefined,
      roles: playRoles,
      roleCount: playRoles.length,
    };
  },

  enrichRole(role) {
    if (role.selectedActorId) {
      const actor = users.get(role.selectedActorId);
      return {
        ...role,
        selectedActor: actor
          ? { id: actor.id, name: actor.name, avatar: actor.avatar }
          : undefined,
      };
    }
    return role;
  },

  getPlayById(id) {
    const play = plays.get(id);
    return play ? this.enrichPlay(play) : null;
  },

  addPlay(playData) {
    const id = uuidv4();
    const play = { id, ...playData, createdAt: new Date().toISOString() };
    plays.set(id, play);
    return this.enrichPlay(play);
  },

  updatePlay(id, updates) {
    const play = plays.get(id);
    if (!play) return null;
    const updated = { ...play, ...updates };
    plays.set(id, updated);
    return this.enrichPlay(updated);
  },

  deletePlay(id) {
    const rolesToDelete = Array.from(roles.values()).filter((r) => r.playId === id);
    for (const r of rolesToDelete) {
      roles.delete(r.id);
    }
    return plays.delete(id);
  },

  addRole(roleData) {
    const id = uuidv4();
    const maxOrder = Array.from(roles.values())
      .filter((r) => r.playId === roleData.playId)
      .reduce((max, r) => Math.max(max, r.sortOrder), 0);
    const role = {
      id,
      applicationCount: 0,
      sortOrder: maxOrder + 1,
      ...roleData,
    };
    roles.set(id, role);
    return this.enrichRole(role);
  },

  updateRole(id, updates) {
    const role = roles.get(id);
    if (!role) return null;
    const updated = { ...role, ...updates };
    roles.set(id, updated);
    return this.enrichRole(updated);
  },

  deleteRole(id) {
    return roles.delete(id);
  },

  reorderRoles(playId, roleIds) {
    roleIds.forEach((rid, index) => {
      const role = roles.get(rid);
      if (role && role.playId === playId) {
        role.sortOrder = index + 1;
      }
    });
  },

  getRoleById(id) {
    const role = roles.get(id);
    return role ? this.enrichRole(role) : null;
  },

  getApplicationsByRole(roleId) {
    return Array.from(applications.values())
      .filter((a) => a.roleId === roleId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((a) => this.enrichApplication(a));
  },

  getApplicationsByActor(actorId) {
    return Array.from(applications.values())
      .filter((a) => a.actorId === actorId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((a) => this.enrichApplication(a));
  },

  enrichApplication(app) {
    const actor = users.get(app.actorId);
    const role = roles.get(app.roleId);
    const play = role ? plays.get(role.playId) : null;
    return {
      ...app,
      actor: actor
        ? { id: actor.id, name: actor.name, avatar: actor.avatar, email: actor.email }
        : undefined,
      role: role
        ? {
            id: role.id,
            name: role.name,
            playId: role.playId,
            playTitle: play?.title,
          }
        : undefined,
    };
  },

  addApplication(appData) {
    const id = uuidv4();
    const app = { id, status: 'pending', ...appData, createdAt: new Date().toISOString() };
    applications.set(id, app);
    const role = roles.get(appData.roleId);
    if (role) {
      role.applicationCount = (role.applicationCount || 0) + 1;
    }
    return this.enrichApplication(app);
  },

  hasApplied(roleId, actorId) {
    for (const app of applications.values()) {
      if (app.roleId === roleId && app.actorId === actorId) return true;
    }
    return false;
  },

  updateApplicationStatus(id, status) {
    const app = applications.get(id);
    if (!app) return null;
    app.status = status;
    if (status === 'approved') {
      const role = roles.get(app.roleId);
      if (role) {
        role.selectedActorId = app.actorId;
      }
    }
    return this.enrichApplication(app);
  },

  getInterviews({ userId = null, userRole = null } = {}) {
    let result = Array.from(interviews.values());
    if (userId && userRole === 'director') {
      result = result.filter((i) => i.directorId === userId);
    } else if (userId && userRole === 'actor') {
      result = result.filter((i) => {
        const app = applications.get(i.applicationId);
        return app && app.actorId === userId;
      });
    }
    return result.map((i) => this.enrichInterview(i));
  },

  enrichInterview(interview) {
    const app = applications.get(interview.applicationId);
    const enrichedApp = app ? this.enrichApplication(app) : undefined;
    return {
      ...interview,
      application: enrichedApp,
    };
  },

  addInterview(data) {
    const id = uuidv4();
    const interview = { id, ...data };
    interviews.set(id, interview);
    return this.enrichInterview(interview);
  },

  updateInterview(id, updates) {
    const interview = interviews.get(id);
    if (!interview) return null;
    const updated = { ...interview, ...updates };
    interviews.set(id, updated);
    return this.enrichInterview(updated);
  },

  deleteInterview(id) {
    return interviews.delete(id);
  },

  getNotifications(userId) {
    return Array.from(notifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  getUnreadCount(userId) {
    let count = 0;
    for (const n of notifications.values()) {
      if (n.userId === userId && !n.read) count++;
    }
    return count;
  },

  addNotification(data) {
    const id = uuidv4();
    const notification = { id, read: false, ...data, createdAt: new Date().toISOString() };
    notifications.set(id, notification);
    return notification;
  },

  markNotificationsRead(userId) {
    for (const n of notifications.values()) {
      if (n.userId === userId) n.read = true;
    }
  },
};

export default data;
