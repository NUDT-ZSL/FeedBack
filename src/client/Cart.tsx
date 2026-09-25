import { useState, useEffect, useRef, useCallback } from 'react';

interface Dish {
  id: string;
  name: string;
  price: number;
  image: string;
}

interface CartItem extends Dish {
  quantity: number;
}

interface CartProps {
  items: CartItem[];
  totalPrice: number;
  onUpdateQuantity: (dishId: string, delta: number) => void;
  onRemove: (dishId: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

function Cart({ items, totalPrice, onUpdateQuantity, onRemove, onSubmit, onClose }: CartProps) {
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [displayItems, setDisplayItems] = useState<CartItem[]>(items);
  const pendingRemoveRef = useRef<Set<string>>(new Set());
  const removeTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const triggerRemoveAnimation = useCallback((dishId: string) => {
    if (removingIds.has(dishId) || pendingRemoveRef.current.has(dishId)) {
      return;
    }
    
    pendingRemoveRef.current.add(dishId);
    setRemovingIds(prev => new Set(prev).add(dishId));
    
    if (removeTimersRef.current.has(dishId)) {
      clearTimeout(removeTimersRef.current.get(dishId)!);
    }
    
    const timer = setTimeout(() => {
      setDisplayItems(prev => prev.filter(i => i.id !== dishId));
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(dishId);
        return next;
      });
      pendingRemoveRef.current.delete(dishId);
      removeTimersRef.current.delete(dishId);
      onRemove(dishId);
    }, 300);
    
    removeTimersRef.current.set(dishId, timer);
  }, [removingIds, onRemove]);

  useEffect(() => {
    const validItems = items.filter(i => i.quantity > 0);
    const displayIds = new Set(displayItems.map(i => i.id));
    const validIds = new Set(validItems.map(i => i.id));
    
    const toAdd: CartItem[] = [];
    const toRemoveIds: string[] = [];
    
    validItems.forEach(item => {
      if (!displayIds.has(item.id) && !pendingRemoveRef.current.has(item.id)) {
        toAdd.push(item);
      }
    });
    
    displayItems.forEach(item => {
      if (!validIds.has(item.id) && !removingIds.has(item.id)) {
        toRemoveIds.push(item.id);
      }
    });
    
    if (toAdd.length > 0 || toRemoveIds.length > 0) {
      if (toRemoveIds.length > 0) {
        toRemoveIds.forEach(id => triggerRemoveAnimation(id));
      }
      if (toAdd.length > 0) {
        setDisplayItems(prev => {
          const existingIds = new Set(prev.map(i => i.id));
          const newItems = [...prev];
          toAdd.forEach(item => {
            if (!existingIds.has(item.id)) {
              newItems.push(item);
            }
          });
          return newItems;
        });
      }
    }
    
    setDisplayItems(prev => {
      const itemMap = new Map(validItems.map(i => [i.id, i]));
      return prev.map(item => {
        const updated = itemMap.get(item.id);
        if (updated && !removingIds.has(item.id)) {
          return updated;
        }
        return item;
      });
    });
  }, [items, triggerRemoveAnimation]);

  useEffect(() => {
    return () => {
      removeTimersRef.current.forEach(timer => clearTimeout(timer));
      removeTimersRef.current.clear();
    };
  }, []);

  const handleQuantityChange = (dishId: string, delta: number, currentQuantity: number) => {
    if (currentQuantity + delta <= 0) {
      triggerRemoveAnimation(dishId);
    } else {
      onUpdateQuantity(dishId, delta);
    }
  };

  const handleRemoveClick = (dishId: string) => {
    triggerRemoveAnimation(dishId);
  };

  return (
    <div className="cart-panel">
      <div className="cart-header">
        <h2>🛒 购物车</h2>
        <button className="cart-close-btn" onClick={onClose}>✕</button>
      </div>

      <div className="cart-items">
        {displayItems.length === 0 ? (
          <div className="cart-empty">
            <span className="cart-empty-icon">🍽️</span>
            <p>购物车是空的</p>
            <p className="cart-empty-hint">快去挑选美食吧~</p>
          </div>
        ) : (
          displayItems.map(item => (
            <div
              key={item.id}
              className={`cart-item ${removingIds.has(item.id) ? 'slide-out' : ''}`}
            >
              <img src={item.image} alt={item.name} className="cart-item-image" />
              <div className="cart-item-info">
                <h4 className="cart-item-name">{item.name}</h4>
                <span className="cart-item-price">¥{item.price}</span>
              </div>
              <div className="cart-item-controls">
                <button
                  className="qty-btn minus"
                  onClick={() => handleQuantityChange(item.id, -1, item.quantity)}
                >
                  −
                </button>
                <span className="qty-value">{item.quantity}</span>
                <button
                  className="qty-btn plus"
                  onClick={() => handleQuantityChange(item.id, 1, item.quantity)}
                >
                  +
                </button>
              </div>
              <button
                className="cart-item-remove"
                onClick={() => handleRemoveClick(item.id)}
                aria-label="删除"
              >
                🗑️
              </button>
              <span className="cart-item-subtotal">
                ¥{(item.price * item.quantity).toFixed(2)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="cart-footer">
        <div className="cart-total">
          <span>合计：</span>
          <span className="cart-total-price">¥{totalPrice.toFixed(2)}</span>
        </div>
        <button
          className="btn-submit-order"
          onClick={onSubmit}
          disabled={displayItems.filter(i => i.quantity > 0 && !removingIds.has(i.id)).length === 0}
        >
          下单
        </button>
      </div>
    </div>
  );
}

export default Cart;
