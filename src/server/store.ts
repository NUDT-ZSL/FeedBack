import type { Event, Attendance, BarrageMessage } from './types';

export const events: Map<string, Event> = new Map();
export const attendances: Map<string, Attendance[]> = new Map();
export const attendanceSerials: Map<string, number> = new Map();
export const checkedInPhones: Map<string, Set<string>> = new Map();
export const barrageHistory: Map<string, BarrageMessage[]> = new Map();
export const onlineCounts: Map<string, number> = new Map();

export const getEvent = (id: string): Event | undefined => events.get(id);

export const addEvent = (event: Event): void => {
  events.set(event.id, event);
  attendances.set(event.id, []);
  attendanceSerials.set(event.id, 0);
  checkedInPhones.set(event.id, new Set());
  barrageHistory.set(event.id, []);
  onlineCounts.set(event.id, 0);
};

export const addAttendance = (attendance: Attendance): void => {
  const eventAttendances = attendances.get(attendance.eventId) || [];
  eventAttendances.unshift(attendance);
  attendances.set(attendance.eventId, eventAttendances);

  const serial = attendanceSerials.get(attendance.eventId) || 0;
  attendanceSerials.set(attendance.eventId, Math.max(serial, attendance.serialNumber));

  if (attendance.phone) {
    const phones = checkedInPhones.get(attendance.eventId) || new Set();
    phones.add(attendance.phone);
    checkedInPhones.set(attendance.eventId, phones);
  }
};

export const getAttendances = (eventId: string, limit?: number): Attendance[] => {
  const list = attendances.get(eventId) || [];
  return limit ? list.slice(0, limit) : list;
};

export const getNextSerial = (eventId: string): number => {
  const current = attendanceSerials.get(eventId) || 0;
  return current + 1;
};

export const hasCheckedInByPhone = (eventId: string, phone: string): boolean => {
  const phones = checkedInPhones.get(eventId);
  return phones ? phones.has(phone) : false;
};

export const addBarrageMessage = (message: BarrageMessage): void => {
  const history = barrageHistory.get(message.eventId) || [];
  history.push(message);
  if (history.length > 100) {
    history.shift();
  }
  barrageHistory.set(message.eventId, history);
};

export const getBarrageHistory = (eventId: string): BarrageMessage[] => {
  return barrageHistory.get(eventId) || [];
};

export const incrementOnlineCount = (eventId: string): number => {
  const current = onlineCounts.get(eventId) || 0;
  const updated = current + 1;
  onlineCounts.set(eventId, updated);
  return updated;
};

export const decrementOnlineCount = (eventId: string): number => {
  const current = onlineCounts.get(eventId) || 0;
  const updated = Math.max(0, current - 1);
  onlineCounts.set(eventId, updated);
  return updated;
};

export const getOnlineCount = (eventId: string): number => {
  return onlineCounts.get(eventId) || 0;
};
