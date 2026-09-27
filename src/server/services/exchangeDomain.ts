import { Exchange, Message, ExchangeStatus } from '../types';

/**
 * 交换状态机：只允许 pending -> approved/rejected/cancelled，
 * approved -> completed/cancelled；终态不可再变更，杜绝状态回退。
 */
export const VALID_TRANSITIONS: Record<ExchangeStatus, ExchangeStatus[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['completed', 'cancelled'],
  rejected: [],
  completed: [],
  cancelled: [],
};

export interface ProcessResult {
  ok: boolean;
  /** 本次调用是否真正改变了状态（重复处理时为 false，幂等） */
  changed: boolean;
  error?: 'EXCHANGE_NOT_FOUND' | 'FORBIDDEN' | 'INVALID_TRANSITION' | 'DUPLICATE_PENDING';
  exchange?: Exchange;
  notification?: Message;
}

let idCounter = 0;
const defaultIdGen = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

/**
 * 交换记录与通知的内存领域存储。
 * 不变量：
 *  1. 任何 relatedExchangeId 指向的通知，其 exchangeStatus 始终等于交换记录当前 status；
 *  2. 未读数永远由通知集合实时派生，不存在可漂移的缓存计数；
 *  3. 单条通知的已读操作只作用于该 id，不影响同一申请下的其它通知。
 */
export class ExchangeNotificationStore {
  readonly exchanges: Exchange[] = [];
  readonly messages: Message[] = [];

  constructor(private idGen: (prefix: string) => string = defaultIdGen) {}

  findExchange(id: string): Exchange | undefined {
    return this.exchanges.find((e) => e.id === id);
  }

  getExchangesForUser(userId: string): Exchange[] {
    return this.exchanges.filter((e) => e.requesterId === userId || e.ownerId === userId);
  }

  createExchange(input: {
    bookId: string;
    requesterId: string;
    ownerId: string;
    message?: string;
    notificationContent?: string;
  }): ProcessResult {
    const duplicated = this.exchanges.some(
      (e) => e.bookId === input.bookId && e.requesterId === input.requesterId && e.status === 'pending'
    );
    if (duplicated) {
      return { ok: false, changed: false, error: 'DUPLICATE_PENDING' };
    }
    const now = new Date().toISOString();
    const exchange: Exchange = {
      id: this.idGen('ex'),
      bookId: input.bookId,
      requesterId: input.requesterId,
      ownerId: input.ownerId,
      status: 'pending',
      message: input.message || '',
      createdAt: now,
      updatedAt: now,
    };
    this.exchanges.push(exchange);
    const notification = this.appendMessage({
      senderId: input.requesterId,
      receiverId: input.ownerId,
      content: input.notificationContent || '',
      type: 'exchange_request',
      relatedExchangeId: exchange.id,
      exchangeStatus: 'pending',
    });
    return { ok: true, changed: true, exchange, notification };
  }

  /**
   * 处理交换申请状态流转。
   * - 目标状态与当前相同：幂等成功，不产生新通知（防重复处理造成重复通知）；
   * - 非法流转/状态回退：拒绝且不改动任何数据；
   * - 合法流转：更新交换记录，同步该申请全部通知的状态标记，再追加一条新通知。
   */
  processExchange(
    exchangeId: string,
    targetStatus: ExchangeStatus,
    actorId: string,
    notificationContent?: string
  ): ProcessResult {
    const exchange = this.findExchange(exchangeId);
    if (!exchange) {
      return { ok: false, changed: false, error: 'EXCHANGE_NOT_FOUND' };
    }
    if (exchange.requesterId !== actorId && exchange.ownerId !== actorId) {
      return { ok: false, changed: false, error: 'FORBIDDEN' };
    }
    if (exchange.status === targetStatus) {
      this.syncMarkers(exchange);
      return { ok: true, changed: false, exchange };
    }
    if (!VALID_TRANSITIONS[exchange.status].includes(targetStatus)) {
      return { ok: false, changed: false, error: 'INVALID_TRANSITION' };
    }
    exchange.status = targetStatus;
    exchange.updatedAt = new Date().toISOString();
    this.syncMarkers(exchange);
    const receiverId = actorId === exchange.requesterId ? exchange.ownerId : exchange.requesterId;
    const notification = this.appendMessage({
      senderId: actorId,
      receiverId,
      content: notificationContent || '',
      type: 'exchange_update',
      relatedExchangeId: exchange.id,
      exchangeStatus: targetStatus,
    });
    return { ok: true, changed: true, exchange, notification };
  }

  /** 重新拉取某用户的通知（返回副本，按时间倒序），不影响存储内部状态 */
  getMessagesForUser(userId: string): Message[] {
    return this.messages
      .filter((m) => m.receiverId === userId)
      .map((m) => ({ ...m }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** 未读数始终由通知集合实时派生 */
  getUnreadCount(userId: string): number {
    return this.messages.filter((m) => m.receiverId === userId && !m.isRead).length;
  }

  /** 只按 id 标记单条通知，不触碰同一申请下的其它通知 */
  markMessageRead(messageId: string, userId: string): Message | null {
    const message = this.messages.find((m) => m.id === messageId && m.receiverId === userId);
    if (!message) return null;
    message.isRead = true;
    return message;
  }

  /** 标记该用户全部通知为已读，返回本次新标记的数量 */
  markAllRead(userId: string): number {
    let marked = 0;
    for (const m of this.messages) {
      if (m.receiverId === userId && !m.isRead) {
        m.isRead = true;
        marked++;
      }
    }
    return marked;
  }

  private appendMessage(input: Omit<Message, 'id' | 'isRead' | 'createdAt'>): Message {
    const message: Message = {
      ...input,
      id: this.idGen('msg'),
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(message);
    return message;
  }

  /** 将某申请下所有通知的状态标记同步为交换记录当前状态 */
  private syncMarkers(exchange: Exchange): void {
    for (const m of this.messages) {
      if (m.relatedExchangeId === exchange.id) {
        m.exchangeStatus = exchange.status;
      }
    }
  }
}

/** 一致性校验：返回违规描述列表，空数组表示全部不变量成立 */
export function checkInvariants(store: ExchangeNotificationStore): string[] {
  const violations: string[] = [];
  const exchangeById = new Map(store.exchanges.map((e) => [e.id, e]));
  const seenExchangeIds = new Set<string>();
  for (const e of store.exchanges) {
    if (seenExchangeIds.has(e.id)) violations.push(`交换记录ID重复: ${e.id}`);
    seenExchangeIds.add(e.id);
  }
  const seenMessageIds = new Set<string>();
  for (const m of store.messages) {
    if (seenMessageIds.has(m.id)) violations.push(`通知ID重复: ${m.id}`);
    seenMessageIds.add(m.id);
    if (m.relatedExchangeId) {
      const ex = exchangeById.get(m.relatedExchangeId);
      if (!ex) {
        violations.push(`通知 ${m.id} 指向不存在的交换 ${m.relatedExchangeId}`);
      } else if (m.exchangeStatus !== ex.status) {
        violations.push(
          `通知 ${m.id} 状态标记(${m.exchangeStatus}) 与交换 ${ex.id} 当前状态(${ex.status}) 不一致`
        );
      }
    }
  }
  return violations;
}
