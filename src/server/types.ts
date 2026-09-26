export interface User {
  id: string;
  username: string;
  password: string;
  avatar?: string;
  createdAt: string;
}

export interface Pet {
  id: string;
  ownerId: string;
  name: string;
  breed: string;
  age: string;
  personality: string;
  photo: string;
  availableForBorrow: boolean;
  availableForAdoption: boolean;
  createdAt: string;
}

export interface Item {
  id: string;
  ownerId: string;
  name: string;
  image: string;
  condition: '全新' | '几乎全新' | '轻微使用痕迹' | '明显使用痕迹';
  location: string;
  availableForBorrow: boolean;
  createdAt: string;
}

export interface Application {
  id: string;
  type: 'borrow' | 'adopt';
  targetType: 'pet' | 'item';
  targetId: string;
  targetName: string;
  applicantId: string;
  applicantName: string;
  ownerId: string;
  reason: string;
  contact: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: 'application_received' | 'application_approved' | 'application_rejected';
  applicationId: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface Comment {
  id: string;
  targetType: 'pet' | 'item';
  targetId: string;
  userId: string;
  username: string;
  content: string;
  parentId: string | null;
  likes: string[];
  createdAt: string;
}
