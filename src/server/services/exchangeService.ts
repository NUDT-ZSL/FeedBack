import { randomUUID } from 'crypto';
import { User, Book, Exchange, Message } from '../types';

export type ExchangeStatus = Exchange['status'];

const ALL_STATUSES: ExchangeStatus[] = ['pending', 'approved', 'rejected', 'completed', 'cancelled'];

// 合法状态流转表：pending 可被接受/拒绝/取消；approved 可完成/取消；其余为终态，不允许回退
const ALLOWED_TRANSITIONS: Record<ExchangeStatus, ExchangeStatus[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['completed', 'cancelled'],
  rejected: [],
  completed: [],
  cancelled: [],
};

const STATUS_TEXT: Record<ExchangeStatus, string> = {
  pending: '待处理',
  approved: '已接受',
  rejected: '已拒绝',
  completed: '已完成',
  cancelled: '已取消',
};

export class DomainError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export const isValidStatus = (status: unknown): status is ExchangeStatus =>
  typeof status === 'string' && (ALL_STATUSES as string[]).includes(status);

// 严格流转判断：相同状态不算流转（相同状态的重放是幂等 no-op）
export const isAllowedTransition = (from: ExchangeStatus, to: ExchangeStatus): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);

export interface ExchangeStore {
  users: User[];
  books: Book[];
  exchanges: Exchange[];
  messages: Message[];
}

export interface UpdateStatusResult {
  exchange: Exchange;
  // 状态实际发生变化并产生新通知时为该通知；幂等重放（重复提交相同状态）时为 null
  notification: Message | null;
  changed: boolean;
}

const now = () => new Date().toISOString();

/**
 * 交换申请 + 通知的领域服务。
 * 状态流转、通知状态标记、未读计数全部在这里收敛为单一事实来源，
 * 路由层与离线验证共用同一实现，保证任何处理顺序下两者一致。
 */
export const createExchangeService = (store: ExchangeStore) => {
  const { users, books, exchanges, messages } = store;

  const findUser = (id: string) => users.find((u) => u.id === id);
  const findExchange = (id: string) => exchanges.find((e) => e.id === id);

  const pushNotification = (
    senderId: string,
    receiverId: string,
    content: string,
    type: Message['type'],
    exchange: Exchange
  ): Message => {
    const notification: Message = {
      id: randomUUID(),
      senderId,
      receiverId,
      content,
      type,
      isRead: false,
      relatedExchangeId: exchange.id,
      // 通知携带生成时刻的申请状态标记，用于与交换记录对账
      exchangeStatus: exchange.status,
      createdAt: now(),
    };
    messages.push(notification);
    return notification;
  };

  const createExchange = (input: {
    bookId: string;
    requesterId: string;
    message?: string;
  }): { exchange: Exchange; notification: Message } => {
    const { bookId, requesterId } = input;
    const book = books.find((b) => b.id === bookId);
    if (!book) {
      throw new DomainError(404, '书籍不存在');
    }
    if (book.ownerId === requesterId) {
      throw new DomainError(400, '不能交换自己的书籍');
    }
    const existingPending = exchanges.find(
      (e) => e.bookId === bookId && e.requesterId === requesterId && e.status === 'pending'
    );
    if (existingPending) {
      throw new DomainError(400, '已向此书籍发送过交换请求');
    }

    const exchange: Exchange = {
      id: randomUUID(),
      bookId,
      requesterId,
      ownerId: book.ownerId,
      status: 'pending',
      message: input.message || '',
      createdAt: now(),
      updatedAt: now(),
    };
    exchanges.push(exchange);

    const requester = findUser(requesterId);
    const notification = pushNotification(
      requesterId,
      book.ownerId,
      `${requester?.username || '有人'} 向您请求交换《${book.title}》`,
      'exchange_request',
      exchange
    );
    return { exchange, notification };
  };
  const updateExchangeStatus = (input: {
    exchangeId: string;
    status: ExchangeStatus;
    actorId: string;
  }): UpdateStatusResult => {
    const { exchangeId, status, actorId } = input;
    const exchange = findExchange(exchangeId);
    if (!exchange) {
      throw new DomainError(404, '交换请求不存在');
    }
    if (exchange.ownerId !== actorId && exchange.requesterId !== actorId) {
      throw new DomainError(403, '无权限修改');
    }
    if (!ALL_STATUSES.includes(status)) {
      throw new DomainError(400, `非法的交换状态: ${status}`);
    }
    // 幂等重放：重复提交相同状态不产生任何副作用
    if (exchange.status === status) {
      return { exchange, notification: null, changed: false };
    }
    // 禁止回退与非法跳转（含终态之后的任何变更）
    if (!ALLOWED_TRANSITIONS[exchange.status].includes(status)) {
      throw new DomainError(
        409,
        `不允许将交换从「${STATUS_TEXT[exchange.status]}」变更为「${STATUS_TEXT[status]}」`
      );
    }

    exchange.status = status;
    exchange.updatedAt = now();

    const recipientId = exchange.requesterId === actorId ? exchange.ownerId : exchange.requesterId;
    const updater = findUser(actorId);
    const book = books.find((b) => b.id === exchange.bookId);
    const notification = pushNotification(
      actorId,
      recipientId,
      `${updater?.username || '有人'} ${STATUS_TEXT[status]}了您关于《${book?.title || '书籍'}》的交换请求`,
      'exchange_update',
      exchange
    );
    return { exchange, notification, changed: true };
  };

  const getExchangesForUser = (userId: string): Exchange[] =>
    exchanges.filter((e) => e.requesterId === userId || e.ownerId === userId);

  const getMessagesForUser = (userId: string): Message[] =>
    messages.filter((m) => m.receiverId === userId);

  // 未读计数永远由通知集合实时推导，不维护独立计数器，避免对不齐
  const getUnreadCount = (userId: string): number =>
    messages.filter((m) => m.receiverId === userId && !m.isRead).length;

  const getNotificationsForExchange = (exchangeId: string): Message[] =>
    messages.filter((m) => m.relatedExchangeId === exchangeId);

  const markMessageRead = (userId: string, messageId: string): Message => {
    const message = messages.find((m) => m.id === messageId && m.receiverId === userId);
    if (!message) {
      throw new DomainError(404, '消息不存在');
    }
    // 重复标记已读是幂等操作
    message.isRead = true;
    return message;
  };

  const markAllMessagesRead = (userId: string): number => {
    let affected = 0;
    messages.forEach((m) => {
      if (m.receiverId === userId && !m.isRead) {
        m.isRead = true;
        affected += 1;
      }
    });
    return affected;
  };

  return {
    createExchange,
    updateExchangeStatus,
    getExchangesForUser,
    getMessagesForUser,
    getUnreadCount,
    getNotificationsForExchange,
    markMessageRead,
    markAllMessagesRead,
    findExchange,
  };
};

export type ExchangeService = ReturnType<typeof createExchangeService>;
