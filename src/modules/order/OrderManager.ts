import { BookManager } from '../book/BookManager';

export type OrderStatus = '待处理' | '已发货' | '已完成';

export interface OrderItem {
  bookId: string;
  bookTitle: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  items: OrderItem[];
  totalPrice: number;
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'bookstore_orders';

const seedOrders: Order[] = [
  {
    id: 'ord001',
    customerName: '张三',
    customerPhone: '13800138001',
    items: [
      { bookId: 'b1', bookTitle: '百年孤独', price: 55.0, quantity: 2 },
    ],
    totalPrice: 110.0,
    status: '已完成',
    createdAt: Date.now() - 86400000 * 6,
    updatedAt: Date.now() - 86400000 * 5,
  },
  {
    id: 'ord002',
    customerName: '李四',
    customerPhone: '13800138002',
    items: [
      { bookId: 'b3', bookTitle: '小王子', price: 32.0, quantity: 1 },
      { bookId: 'b7', bookTitle: '安徒生童话', price: 45.0, quantity: 1 },
    ],
    totalPrice: 77.0,
    status: '已发货',
    createdAt: Date.now() - 86400000 * 4,
    updatedAt: Date.now() - 86400000 * 3,
  },
  {
    id: 'ord003',
    customerName: '王五',
    customerPhone: '13800138003',
    items: [
      { bookId: 'b5', bookTitle: '活着', price: 39.0, quantity: 3 },
    ],
    totalPrice: 117.0,
    status: '待处理',
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 86400000 * 2,
  },
  {
    id: 'ord004',
    customerName: '赵六',
    customerPhone: '13800138004',
    items: [
      { bookId: 'b9', bookTitle: '三体', price: 23.0, quantity: 5 },
    ],
    totalPrice: 115.0,
    status: '已完成',
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000 / 2,
  },
  {
    id: 'ord005',
    customerName: '钱七',
    customerPhone: '13800138005',
    items: [
      { bookId: 'b2', bookTitle: '人类简史', price: 68.0, quantity: 1 },
      { bookId: 'b6', bookTitle: '思考，快与慢', price: 69.0, quantity: 1 },
    ],
    totalPrice: 137.0,
    status: '待处理',
    createdAt: Date.now() - 3600000 * 5,
    updatedAt: Date.now() - 3600000 * 5,
  },
  {
    id: 'ord006',
    customerName: '孙八',
    customerPhone: '13800138006',
    items: [
      { bookId: 'b4', bookTitle: '深入理解计算机系统', price: 139.0, quantity: 1 },
    ],
    totalPrice: 139.0,
    status: '已完成',
    createdAt: Date.now() - 3600000 * 2,
    updatedAt: Date.now() - 3600000 * 1,
  },
];

export class OrderManager {
  private orders: Order[] = [];
  private bookManager: BookManager;

  constructor(bookManager: BookManager) {
    this.bookManager = bookManager;
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        this.orders = JSON.parse(saved);
      } catch {
        this.orders = [...seedOrders];
        this.saveToStorage();
      }
    } else {
      this.orders = [...seedOrders];
      this.saveToStorage();
    }
  }

  private saveToStorage(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.orders));
  }

  private generateId(): string {
    const num = this.orders.length + 1;
    return 'ord' + num.toString().padStart(3, '0');
  }

  createOrder(data: {
    customerName: string;
    customerPhone: string;
    items: { bookId: string; quantity: number }[];
  }): { success: boolean; order?: Order; error?: string } {
    const orderItems: OrderItem[] = [];
    let totalPrice = 0;

    for (const item of data.items) {
      const book = this.bookManager.getBookById(item.bookId);
      if (!book) {
        return { success: false, error: `书籍不存在: ${item.bookId}` };
      }
      if (book.stock < item.quantity) {
        return { success: false, error: `库存不足: 《${book.title}》仅剩 ${book.stock} 本` };
      }
      orderItems.push({
        bookId: book.id,
        bookTitle: book.title,
        price: book.price,
        quantity: item.quantity,
      });
      totalPrice += book.price * item.quantity;
    }

    for (const item of data.items) {
      this.bookManager.updateStock(item.bookId, -item.quantity);
    }

    const now = Date.now();
    const order: Order = {
      id: this.generateId(),
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      items: orderItems,
      totalPrice: Math.round(totalPrice * 100) / 100,
      status: '待处理',
      createdAt: now,
      updatedAt: now,
    };

    this.orders.unshift(order);
    this.saveToStorage();

    return { success: true, order };
  }

  getOrderById(id: string): Order | undefined {
    return this.orders.find((o) => o.id === id);
  }

  getAllOrders(): Order[] {
    return [...this.orders];
  }

  updateStatus(id: string, status: OrderStatus): Order | undefined {
    const order = this.orders.find((o) => o.id === id);
    if (!order) return undefined;
    order.status = status;
    order.updatedAt = Date.now();
    this.saveToStorage();
    return { ...order };
  }

  filterByDateRange(startDate: Date, endDate: Date): Order[] {
    const start = startDate.getTime();
    const end = endDate.getTime();
    return this.orders.filter((o) => o.createdAt >= start && o.createdAt <= end);
  }

  getOrdersByStatus(status: OrderStatus): Order[] {
    return this.orders.filter((o) => o.status === status);
  }
}
