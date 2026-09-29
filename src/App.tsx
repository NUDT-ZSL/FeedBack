import { useState, useCallback, useMemo } from 'react';
import type { Order, Ingredient, CakeSize, CakeFlavor, IngredientName } from './types';
import { initialOrders, initialIngredients, calculateIngredients, calculateDuration, generateId } from './data';
import OrderCard from './components/OrderCard';
import IngredientPanel from './components/IngredientPanel';
import styles from './App.module.css';

export default function App() {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients);
  const [flashingOrderId, setFlashingOrderId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    size: 8 as CakeSize,
    layers: 1,
    flavor: '原味' as CakeFlavor,
    decorationNote: '',
  });

  const sortedOrders = useMemo(() => {
    return [...orders].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  }, [orders]);

  const stats = useMemo(() => {
    const pending = orders.filter(o => o.status === 'pending').length;
    const inProgress = orders.filter(o => o.status === 'in-progress').length;
    const completed = orders.filter(o => o.status === 'completed').length;
    return { pending, inProgress, completed };
  }, [orders]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    const newOrder: Order = {
      id: generateId(),
      size: formData.size,
      layers: formData.layers,
      flavor: formData.flavor,
      decorationNote: formData.decorationNote,
      status: 'pending',
      submittedAt: new Date(),
    };
    
    setOrders(prev => [...prev, newOrder]);
    setFormData({
      size: 8,
      layers: 1,
      flavor: '原味',
      decorationNote: '',
    });
  }, [formData]);

  const handleStartMaking = useCallback((orderId: string) => {
    setOrders(prev => prev.map(order => {
      if (order.id === orderId && order.status === 'pending') {
        return {
          ...order,
          status: 'in-progress',
          startedAt: new Date(),
          estimatedDuration: calculateDuration(order.layers),
        };
      }
      return order;
    }));
  }, []);

  const handleComplete = useCallback((orderId: string) => {
    setOrders(prev => {
      const order = prev.find(o => o.id === orderId);
      if (!order || order.status === 'completed') return prev;

      if (order.status === 'in-progress') {
        const consumption = calculateIngredients(order.size, order.flavor);
        setIngredients(prevIngredients => prevIngredients.map(ing => {
          const amount = consumption[ing.name as IngredientName];
          if (amount !== undefined) {
            return { ...ing, consumed: ing.consumed + amount };
          }
          return ing;
        }));
      }

      setFlashingOrderId(orderId);
      setTimeout(() => setFlashingOrderId(null), 1000);

      return prev.map(o => 
        o.id === orderId ? { ...o, status: 'completed' as const } : o
      );
    });
  }, []);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.logo}>
            <div className={styles.logoIcon}>🎂</div>
            <div>
              <div className={styles.logoText}>甜蜜烘焙工作室</div>
              <div className={styles.logoSubtitle}>订单管理与原料消耗预测系统</div>
            </div>
          </div>
          <div className={styles.stats}>
            <div className={styles.statItem}>
              <div className={styles.statValue}>{stats.pending}</div>
              <div className={styles.statLabel}>待处理</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statValue}>{stats.inProgress}</div>
              <div className={styles.statLabel}>制作中</div>
            </div>
            <div className={styles.statItem}>
              <div className={styles.statValue}>{stats.completed}</div>
              <div className={styles.statLabel}>已完成</div>
            </div>
          </div>
        </div>
      </header>

      <main className={styles.mainContent}>
        <div className={styles.leftColumn}>
          <form className={styles.orderForm} onSubmit={handleSubmit}>
            <div className={styles.sectionTitle}>
              <div className={styles.sectionIcon}>📝</div>
              提交蛋糕定制订单
            </div>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>蛋糕尺寸</label>
                <select 
                  className={styles.formSelect}
                  value={formData.size}
                  onChange={(e) => setFormData(prev => ({ ...prev, size: Number(e.target.value) as CakeSize }))}
                >
                  <option value={6}>6 英寸</option>
                  <option value={8}>8 英寸</option>
                  <option value={10}>10 英寸</option>
                  <option value={12}>12 英寸</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>层数</label>
                <select 
                  className={styles.formSelect}
                  value={formData.layers}
                  onChange={(e) => setFormData(prev => ({ ...prev, layers: Number(e.target.value) }))}
                >
                  <option value={1}>1 层</option>
                  <option value={2}>2 层</option>
                  <option value={3}>3 层</option>
                </select>
              </div>
              <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                <label className={styles.formLabel}>口味</label>
                <select 
                  className={styles.formSelect}
                  value={formData.flavor}
                  onChange={(e) => setFormData(prev => ({ ...prev, flavor: e.target.value as CakeFlavor }))}
                >
                  <option value="原味">原味</option>
                  <option value="巧克力">巧克力</option>
                  <option value="抹茶">抹茶</option>
                  <option value="红丝绒">红丝绒</option>
                  <option value="芒果">芒果</option>
                </select>
              </div>
              <div className={styles.formGroup} style={{ gridColumn: '1 / -1' }}>
                <label className={styles.formLabel}>装饰备注</label>
                <textarea 
                  className={styles.formTextarea}
                  value={formData.decorationNote}
                  onChange={(e) => setFormData(prev => ({ ...prev, decorationNote: e.target.value.slice(0, 100) }))}
                  placeholder="请输入装饰要求，最多100字..."
                  maxLength={100}
                />
                <div className={styles.charCount}>{formData.decorationNote.length}/100</div>
              </div>
              <button type="submit" className={styles.submitBtn}>
                ✨ 提交订单
              </button>
            </div>
          </form>

          <div>
            <div className={styles.sectionTitle}>
              <div className={styles.sectionIcon}>📋</div>
              订单列表
            </div>
            {sortedOrders.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>🍰</div>
                <div className={styles.emptyText}>暂无订单，快去提交第一个吧！</div>
              </div>
            ) : (
              sortedOrders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onStartMaking={handleStartMaking}
                  onComplete={handleComplete}
                  isFlashing={flashingOrderId === order.id}
                />
              ))
            )}
          </div>
        </div>

        <div className={styles.rightColumn}>
          <IngredientPanel ingredients={ingredients} />
        </div>
      </main>
    </div>
  );
}
