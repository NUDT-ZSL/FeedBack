import { User, Book, Exchange, Message } from '../types';
import { createExchangeService, ExchangeService } from '../services/exchangeService';

// 纯内存样例数据：不触碰网络、数据库与外部账号
export interface World {
  users: User[];
  books: Book[];
  exchanges: Exchange[];
  messages: Message[];
  service: ExchangeService;
  owner: User;
  requester: User;
  outsider: User;
  ownerBook: Book;
  requesterBook: Book;
  outsiderBook: Book;
}

const ts = () => new Date().toISOString();

const makeUser = (id: string, username: string): User => ({
  id,
  username,
  email: `${id}@test.local`,
  passwordHash: 'not-used-in-verification',
  avatar: '',
  createdAt: ts(),
});

const makeBook = (id: string, ownerId: string, title: string): Book => ({
  id,
  ownerId,
  title,
  author: '验证样例',
  category: '测试',
  coverImage: '',
  condition: 'good',
  description: '',
  createdAt: ts(),
  isAvailable: true,
});

export const buildWorld = (): World => {
  const owner = makeUser('user-owner', '书主');
  const requester = makeUser('user-requester', '求书人');
  const outsider = makeUser('user-outsider', '旁观者');
  const users = [owner, requester, outsider];

  const ownerBook = makeBook('book-owner-1', owner.id, '书主的书');
  const requesterBook = makeBook('book-requester-1', requester.id, '求书人的书');
  const outsiderBook = makeBook('book-outsider-1', outsider.id, '旁观者的书');
  const books = [ownerBook, requesterBook, outsiderBook];

  const exchanges: Exchange[] = [];
  const messages: Message[] = [];
  const service = createExchangeService({ users, books, exchanges, messages });

  return {
    users,
    books,
    exchanges,
    messages,
    service,
    owner,
    requester,
    outsider,
    ownerBook,
    requesterBook,
    outsiderBook,
  };
};
