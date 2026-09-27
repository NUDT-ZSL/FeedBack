export type ExchangeStatus = 'pending' | 'approved' | 'rejected' | 'completed' | 'cancelled';

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  avatar?: string;
  createdAt: string;
}

export interface Book {
  id: string;
  ownerId: string;
  owner?: User;
  title: string;
  author: string;
  category: string;
  coverImage?: string;
  condition: 'new' | 'good' | 'fair' | 'poor';
  description?: string;
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
  status: ExchangeStatus;
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
  type: 'system' | 'exchange' | 'chat' | 'exchange_request' | 'exchange_update';
  isRead: boolean;
  relatedExchangeId?: string;
  /** 通知携带的申请状态标记，须始终与关联交换记录的 status 保持一致 */
  exchangeStatus?: ExchangeStatus;
  createdAt: string;
}
