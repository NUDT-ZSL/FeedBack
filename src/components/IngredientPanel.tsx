import { useState, useEffect } from 'react';
import type { Ingredient } from '../types';
import styles from './IngredientPanel.module.css';

interface IngredientPanelProps {
  ingredients: Ingredient[];
}

export default function IngredientPanel({ ingredients }: IngredientPanelProps) {
  const [shakingRows, setShakingRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    const lowStockIngredients = ingredients.filter(
      ing => {
        const remaining = ing.initialStock - ing.consumed;
        return remaining < ing.initialStock * 0.2;
      }
    );

    if (lowStockIngredients.length === 0) {
      setShakingRows(new Set());
      return;
    }

    const triggerShake = () => {
      setShakingRows(new Set(lowStockIngredients.map(i => i.id)));
      setTimeout(() => {
        setShakingRows(new Set());
      }, 300);
    };

    triggerShake();
    const interval = setInterval(triggerShake, 2000);
    return () => clearInterval(interval);
  }, [ingredients]);

  const lowStockCount = ingredients.filter(
    ing => (ing.initialStock - ing.consumed) < ing.initialStock * 0.2
  ).length;

  const totalConsumedValue = ingredients.reduce((sum, ing) => {
    if (ing.unit === 'g') {
      return sum + ing.consumed;
    }
    return sum;
  }, 0);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.panelIcon}>📦</div>
        <div>
          <div className={styles.panelTitle}>原料消耗统计</div>
        </div>
      </div>

      <table className={styles.table}>
        <thead className={styles.tableHeader}>
          <tr>
            <th>原料名称</th>
            <th>已消耗量</th>
            <th>剩余量</th>
          </tr>
        </thead>
        <tbody className={styles.tableBody}>
          {ingredients.map(ingredient => {
            const remaining = ingredient.initialStock - ingredient.consumed;
            const remainingPercent = (remaining / ingredient.initialStock) * 100;
            const isLowStock = remaining < ingredient.initialStock * 0.2;
            const isShaking = shakingRows.has(ingredient.id);

            return (
              <tr key={ingredient.id} className={isShaking ? styles.lowStock : ''}>
                <td className={`${styles.ingredientName} ${isLowStock ? styles.lowStock : ''}`}>
                  {ingredient.name}
                  {isLowStock && <span className={styles.warningBadge}>库存不足</span>}
                </td>
                <td className={isLowStock ? styles.lowStock : ''}>
                  {ingredient.consumed}{ingredient.unit}
                </td>
                <td className={isLowStock ? styles.lowStock : ''}>
                  {remaining}{ingredient.unit}
                  <div className={styles.stockBar}>
                    <div 
                      className={`${styles.stockFill} ${isLowStock ? styles.low : ''}`}
                      style={{ width: `${Math.max(0, remainingPercent)}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={styles.summary}>
        <div className={styles.summaryTitle}>📊 库存概览</div>
        <div className={styles.summaryText}>
          共 {ingredients.length} 种原料
          {lowStockCount > 0 && (
            <span style={{ color: '#E74C3C', fontWeight: 600 }}>
              ，{lowStockCount} 种原料库存低于20%，请及时补货
            </span>
          )}
          <br />
          已消耗原料总计：{totalConsumedValue.toFixed(0)}g
        </div>
      </div>
    </div>
  );
}
