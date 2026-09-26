export interface Event {
  id: string;
  name: string;
  location: string;
  time: string;
  description: string;
  expectedCount: number;
  createdAt: string;
  qrCode?: string;
}

export interface Attendance {
  id: string;
  eventId: string;
  name: string;
  phone?: string;
  gender?: 'male' | 'female';
  checkInTime: string;
  serialNumber: number;
}

export interface BarrageMessage {
  id: string;
  eventId: string;
  content: string;
  timestamp: string;
  color: string;
}

export interface EventStats {
  totalAttendance: number;
  maleCount: number;
  femaleCount: number;
  hourlyDistribution: { hour: number; count: number }[];
  attendanceRate: number;
  expectedCount: number;
  onlineCount: number;
}

export interface CreateEventRequest {
  name: string;
  location: string;
  time: string;
  description?: string;
  expectedCount: number;
}

export interface CreateAttendanceRequest {
  eventId: string;
  name: string;
  phone?: string;
  gender?: 'male' | 'female';
}
