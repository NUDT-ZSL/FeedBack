export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  createdAt: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  category: string;
  description?: string;
  coverImage?: string;
  condition: 'new' | 'good' | 'fair' | 'poor';
  ownerId: string;
  owner?: User;
  createdAt: string;
  isAvailable: boolean;
}

export interface Exchange {
  id: string;
  bookId: string;
  book?: Book;
  requesterId: string;
  requester?: User;
  ownerId: string;
  owner?: User;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';
  message?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  senderId: string;
  sender?: User;
  receiverId: string;
  receiver?: User;
  content: string;
  type: 'system' | 'exchange' | 'chat';
  isRead: boolean;
  relatedExchangeId?: string;
  createdAt: string;
}
