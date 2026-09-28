import { OrderManager, Order } from '../order/OrderManager';

export interface DailySalesData {
  date: string;
  sales: number;
  orders: number;
}

export interface PeriodSales {
  today: number;
  week: number;
  month: number;
}

export interface BarChartItem {
  name: string;
  销售额: number;
}

export interface LineChartItem {
  name: string;
  销量: number;
}

const PROFIT_RATE = 0.3;

export class ReportGenerator {
  private orderManager: OrderManager;

  constructor(orderManager: OrderManager) {
    this.orderManager = orderManager;
  }

  private formatDate(date: Date): string {
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${m}-${d}`;
  }

  private getTodayRange(): { start: Date; end: Date } {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    return { start, end };
  }

  private getWeekRange(): { start: Date; end: Date } {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    return { start, end };
  }

  private getMonthRange(): { start: Date; end: Date } {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    return { start, end };
  }

  getSalesAmount(): PeriodSales {
    const { start: todayStart, end: todayEnd } = this.getTodayRange();
    const { start: weekStart, end: weekEnd } = this.getWeekRange();
    const { start: monthStart, end: monthEnd } = this.getMonthRange();

    const todayOrders = this.orderManager.filterByDateRange(todayStart, todayEnd);
    const weekOrders = this.orderManager.filterByDateRange(weekStart, weekEnd);
    const monthOrders = this.orderManager.filterByDateRange(monthStart, monthEnd);

    return {
      today: this.calculateTotal(todayOrders),
      week: this.calculateTotal(weekOrders),
      month: this.calculateTotal(monthOrders),
    };
  }

  private calculateTotal(orders: Order[]): number {
    return orders.reduce((sum, o) => sum + o.totalPrice, 0);
  }

  getTodayOrderCount(): number {
    const { start, end } = this.getTodayRange();
    return this.orderManager.filterByDateRange(start, end).length;
  }

  getMonthRevenue(): number {
    const { start, end } = this.getMonthRange();
    const orders = this.orderManager.filterByDateRange(start, end);
    return this.calculateTotal(orders);
  }

  getMonthProfit(): number {
    return Math.round(this.getMonthRevenue() * PROFIT_RATE * 100) / 100;
  }

  getPeriodBarChartData(): BarChartItem[] {
    const sales = this.getSalesAmount();
    return [
      { name: '今日', 销售额: Math.round(sales.today * 100) / 100 },
      { name: '本周', 销售额: Math.round(sales.week * 100) / 100 },
      { name: '本月', 销售额: Math.round(sales.month * 100) / 100 },
    ];
  }

  getLast7DaysTrend(): LineChartItem[] {
    const result: LineChartItem[] = [];
    const today = new Date();

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
      const orders = this.orderManager.filterByDateRange(start, end);
      const totalQuantity = orders.reduce((sum, o) => {
        const qty = o.items.reduce((s, item) => s + item.quantity, 0);
        return sum + qty;
      }, 0);
      result.push({
        name: this.formatDate(date),
        销量: totalQuantity,
      });
    }

    return result;
  }
}
