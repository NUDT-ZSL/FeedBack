export type EventType = '读书会' | '新书签售' | '作者对谈' | '手工工作坊';

export interface BookstoreEvent {
  id: string;
  name: string;
  type: EventType;
  date: string;
  startTime: string;
  endTime: string;
  maxParticipants: number;
  description: string;
}

export interface Registration {
  id: string;
  eventId: string;
  name: string;
  phone: string;
  email: string;
  registeredAt: string;
}

export interface CheckInRecord {
  registrationId: string;
  eventId: string;
  checkedIn: boolean;
  checkedInAt: string | null;
}

const EVENT_TYPES: EventType[] = ['读书会', '新书签售', '作者对谈', '手工工作坊'];

const EVENT_NAMES: Record<EventType, string[]> = {
  '读书会': [
    '春日读书会', '经典文学共读', '科幻小说研讨', '女性主义阅读', '哲学思辨读书会',
    '诗歌朗诵之夜', '历史人文读书会', '心理学读书会', '推理小说鉴赏', '散文共赏会',
    '世界文学巡礼', '绘本阅读沙龙', '古诗词品读', '非虚构阅读', '儿童文学读书会',
    '漫画研究社', '科幻经典重温', '旅行文学之夜', '美食与书', '音乐与文学',
  ],
  '新书签售': [
    '《人间烟火》签售', '《星空之下》签售', '《城市漫步》签售', '《时光书简》签售',
    '《山河故人》签售', '《秋日私语》签售', '《远方来信》签售', '《海上繁花》签售',
    '《深夜书店》签售', '《花间一壶酒》签售', '《云边小卖部》签售', '《百年孤独》新版签售',
    '《活着》纪念版签售', '《白夜行》签售', '《三体》典藏版签售', '《围城》新译本签售',
    '《小王子》插画版签售', '《挪威的森林》签售', '《追风筝的人》签售', '《月亮与六便士》签售',
  ],
  '作者对谈': [
    '张三·城市书写对谈', '李四·科幻与未来', '王五·历史的温度', '赵六·诗歌的力量',
    '陈七·非虚构创作谈', '刘八·儿童文学对谈', '周九·翻译的艺术', '吴十·摄影与文字',
    '郑一·饮食与文学', '孙二·音乐故事对谈', '林三·建筑与诗', '黄四·旅行的意义',
    '何五·科技与人文', '罗六·设计思维对谈', '梁七·电影与原著', '宋八·自然写作对谈',
    '谢九·社会观察对谈', '韩十·艺术与生活', '唐一·教育理念对谈', '冯二·创业故事分享',
  ],
  '手工工作坊': [
    '手工书签制作', '古籍修复体验', '拓印工作坊', '书法入门工作坊',
    '水彩书衣制作', '手账装饰工坊', '纸艺花制作', '布艺书套缝制',
    '版画制作体验', '橡皮章雕刻', '线装书制作', '染纸艺术工坊',
    '押花书签制作', '墨水调制工坊', '丝网印刷体验', '手工造纸工坊',
    '木刻版画制作', '皮具书签制作', '手绘明信片', '陶艺书立制作',
  ],
};

const DESCRIPTIONS: Record<EventType, string[]> = {
  '读书会': [
    '让我们一起沉浸在文字的海洋中，分享阅读的喜悦与感动。每位参与者可携带推荐书目，与书友交流心得。',
    '本期精选主题书目，由资深书虫领读，深入探讨文本背后的思想与情感。欢迎新老书友参加。',
    '这是一场关于文字与灵魂的对话，我们在书中寻找共鸣，在交流中收获成长。期待你的加入。',
  ],
  '新书签售': [
    '著名作家亲临现场，为新书签名并与读者互动。限量签名本先到先得，购书即可参与签售。',
    '新书首发签售会，作者将分享创作背后的故事，并为每位读者签名留念。请提前预约报名。',
    '期待已久的签名版终于来了！作者现场签售，分享创作心路历程，更有读者问答环节。',
  ],
  '作者对谈': [
    '两位风格迥异的作家面对面碰撞思想火花，从各自领域出发探讨创作的可能性与边界。',
    '知名作者莅临书店，与读者零距离交流。从写作技巧到人生感悟，畅谈文学创作的方方面面。',
    '本期邀请到重量级嘉宾，围绕文学与社会话题展开深度对话，现场观众可参与提问互动。',
  ],
  '手工工作坊': [
    '亲手制作独一无二的手工作品，体验传统工艺的魅力。材料工具由书店提供，无需基础即可参加。',
    '专业手作老师现场指导，从零开始完成一件精美作品。名额有限，报名从速。作品可带走留念。',
    '放松心情，享受手作的乐趣。在书香环绕中，用双手创造属于自己的小确幸。含茶歇。',
  ],
};

const SURNAMES = ['张', '李', '王', '赵', '陈', '刘', '周', '吴', '郑', '孙', '林', '黄', '何', '罗', '梁', '宋', '谢', '韩', '唐', '冯', '许', '邓', '曹', '彭', '曾', '萧', '田', '董', '袁', '潘'];
const GIVEN_NAMES = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '洋', '勇', '军', '杰', '涛', '明', '超', '秀英', '华', '慧', '建华', '建国', '志强', '文', '雪', '玲', '婷', '欣', '萍', '红', '梅', '兰'];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generatePhone(): string {
  const prefixes = ['130', '131', '132', '133', '135', '136', '137', '138', '139', '150', '151', '152', '153', '155', '156', '157', '158', '159', '170', '176', '177', '178', '180', '181', '182', '183', '185', '186', '187', '188', '189'];
  return randomFrom(prefixes) + String(randomInt(10000000, 99999999));
}

function generateName(): string {
  return randomFrom(SURNAMES) + randomFrom(GIVEN_NAMES) + (Math.random() > 0.5 ? randomFrom(GIVEN_NAMES) : '');
}

function generateEmail(name: string): string {
  const domains = ['qq.com', '163.com', 'gmail.com', 'outlook.com', 'foxmail.com'];
  const pinyin = 'user' + randomInt(100, 999);
  return pinyin + '@' + randomFrom(domains);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function generateEvents(): BookstoreEvent[] {
  const events: BookstoreEvent[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const typeCounts: Record<EventType, number> = { '读书会': 0, '新书签售': 0, '作者对谈': 0, '手工工作坊': 0 };

  for (let i = 0; i < 100; i++) {
    const type = EVENT_TYPES[i % 4];
    const typeIdx = typeCounts[type] % EVENT_NAMES[type].length;
    typeCounts[type]++;

    let date: Date;
    if (i < 30) {
      const d = new Date(today);
      d.setDate(d.getDate() - (30 - i));
      date = d;
    } else if (i < 35) {
      date = new Date(today);
    } else {
      const d = new Date(today);
      d.setDate(d.getDate() + (i - 34));
      date = d;
    }

    const startHour = randomInt(9, 18);
    const endHour = startHour + randomInt(1, 3);
    const startMin = randomFrom([0, 30]);
    const endMin = endHour >= 21 ? 0 : randomFrom([0, 30]);

    events.push({
      id: `evt_${String(i + 1).padStart(3, '0')}`,
      name: EVENT_NAMES[type][typeIdx],
      type,
      date: formatDate(date),
      startTime: `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`,
      endTime: `${String(Math.min(endHour, 21)).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`,
      maxParticipants: randomInt(2, 20) * 10,
      description: randomFrom(DESCRIPTIONS[type]),
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function generateRegistrations(events: BookstoreEvent[]): Registration[] {
  const registrations: Registration[] = [];
  const usedPhones = new Set<string>();

  for (const event of events) {
    const regCount = randomInt(3, Math.min(event.maxParticipants, 40));
    for (let j = 0; j < regCount; j++) {
      const phone = generatePhone();
      if (usedPhones.has(phone + event.id)) continue;
      usedPhones.add(phone + event.id);

      const name = generateName();
      const regDate = new Date(event.date);
      regDate.setDate(regDate.getDate() - randomInt(1, 14));

      registrations.push({
        id: `reg_${event.id}_${String(j + 1).padStart(3, '0')}`,
        eventId: event.id,
        name,
        phone,
        email: generateEmail(name),
        registeredAt: regDate.toISOString(),
      });
    }
  }

  return registrations;
}

function generateCheckInRecords(events: BookstoreEvent[], registrations: Registration[]): CheckInRecord[] {
  const records: CheckInRecord[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = formatDate(today);

  for (const event of events) {
    const eventRegs = registrations.filter(r => r.eventId === event.id);
    const isPast = event.date < todayStr;
    const isToday = event.date === todayStr;

    for (const reg of eventRegs) {
      let checkedIn = false;
      let checkedInAt: string | null = null;

      if (isPast) {
        checkedIn = Math.random() < 0.78;
        if (checkedIn) {
          const [sh, sm] = event.startTime.split(':').map(Number);
          const checkInMinute = randomInt(0, 90);
          const totalMin = sh * 60 + sm + checkInMinute;
          const ch = Math.floor(totalMin / 60);
          const cm = totalMin % 60;
          checkedInAt = `${event.date}T${String(ch).padStart(2, '0')}:${String(cm).padStart(2, '0')}:00`;
        }
      } else if (isToday) {
        checkedIn = Math.random() < 0.4;
        if (checkedIn) {
          const now = new Date();
          checkedInAt = now.toISOString();
        }
      }

      records.push({
        registrationId: reg.id,
        eventId: event.id,
        checkedIn,
        checkedInAt,
      });
    }
  }

  return records;
}

let _events: BookstoreEvent[] = [];
let _registrations: Registration[] = [];
let _checkInRecords: CheckInRecord[] = [];
let _initialized = false;

function ensureInitialized(): void {
  if (_initialized) return;
  _events = generateEvents();
  _registrations = generateRegistrations(_events);
  _checkInRecords = generateCheckInRecords(_events, _registrations);
  _initialized = true;
}

export function getEvents(): BookstoreEvent[] {
  ensureInitialized();
  return [..._events].sort((a, b) => a.date.localeCompare(b.date));
}

export function getEventById(id: string): BookstoreEvent | undefined {
  ensureInitialized();
  return _events.find(e => e.id === id);
}

export function getRegistrations(eventId?: string): Registration[] {
  ensureInitialized();
  if (eventId) return _registrations.filter(r => r.eventId === eventId);
  return [..._registrations];
}

export function getCheckInRecords(eventId?: string): CheckInRecord[] {
  ensureInitialized();
  if (eventId) return _checkInRecords.filter(r => r.eventId === eventId);
  return [..._checkInRecords];
}

export function addEvent(data: Omit<BookstoreEvent, 'id'>): BookstoreEvent {
  ensureInitialized();
  const id = `evt_${Date.now()}`;
  const newEvent: BookstoreEvent = { ...data, id };
  _events.push(newEvent);
  return newEvent;
}

export function updateEvent(id: string, data: Partial<BookstoreEvent>): BookstoreEvent | undefined {
  ensureInitialized();
  const idx = _events.findIndex(e => e.id === id);
  if (idx === -1) return undefined;
  _events[idx] = { ..._events[idx], ...data };
  return _events[idx];
}

export function deleteEvent(id: string): boolean {
  ensureInitialized();
  const idx = _events.findIndex(e => e.id === id);
  if (idx === -1) return false;
  _events.splice(idx, 1);
  _registrations = _registrations.filter(r => r.eventId !== id);
  _checkInRecords = _checkInRecords.filter(r => r.eventId !== id);
  return true;
}

export function addRegistration(data: Omit<Registration, 'id'>): Registration {
  ensureInitialized();
  const id = `reg_${data.eventId}_${Date.now()}`;
  const newReg: Registration = { ...data, id };
  _registrations.push(newReg);
  _checkInRecords.push({
    registrationId: id,
    eventId: data.eventId,
    checkedIn: false,
    checkedInAt: null,
  });
  return newReg;
}

export function toggleCheckIn(registrationId: string, eventId: string): CheckInRecord | undefined {
  ensureInitialized();
  const idx = _checkInRecords.findIndex(
    r => r.registrationId === registrationId && r.eventId === eventId
  );
  if (idx === -1) return undefined;
  const record = _checkInRecords[idx];
  if (record.checkedIn) return record;
  record.checkedIn = true;
  record.checkedInAt = new Date().toISOString();
  return record;
}

export function getRegistrationCount(eventId: string): number {
  ensureInitialized();
  return _registrations.filter(r => r.eventId === eventId).length;
}

export function getCheckInCount(eventId: string): number {
  ensureInitialized();
  return _checkInRecords.filter(r => r.eventId === eventId && r.checkedIn).length;
}
