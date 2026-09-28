export interface User {
  id: string;
  username: string;
  nickname: string;
  password: string;
  role: 'admin' | 'volunteer';
  avatar?: string;
  totalHours: number;
  monthlyHours: { month: string; hours: number }[];
  createdAt: Date;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  location: string;
  serviceDate: string;
  startTime: string;
  endTime: string;
  maxVolunteers: number;
  type: '环保' | '教育' | '助老' | '社区';
  deadline: string;
  createdAt: Date;
  status: 'active' | 'closed';
}

export interface Registration {
  id: string;
  userId: string;
  projectId: string;
  remark: string;
  status: 'pending' | 'approved' | 'rejected';
  serviceHours: number;
  createdAt: Date;
  reviewedAt?: Date;
}

export interface WebSocketMessage {
  type: 'registration' | 'approval' | 'notification';
  data: any;
}
