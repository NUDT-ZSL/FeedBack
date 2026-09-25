import { useState, useEffect, useCallback, useRef } from 'react';
import MenuList from './MenuList';
import Cart from './Cart';

interface Category {
  id: string;
  name: string;
  icon: string;
}

interface Dish {
  id: string;
  categoryId: string;
  name: string;
  price: number;
  rating: number;
  description: string;
  image: string;
  isRecommended: boolean;
}

interface CartItem extends Dish {
  quantity: number;
}

interface Toast {
  id: number;
  message: string;
  visible: boolean;
  hiding: boolean;
}

function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('recommended');
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [cartOpen, setCartOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [menuAnimating, setMenuAnimating] = useState<boolean>(false);
  const [displayedDishes, setDisplayedDishes] = useState<Dish[]>([]);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideToastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const prevDishIds = useRef<string>('');
  const fadeOutTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setCartOpen(true);
      } else {
        setCartOpen(false);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    if (hideToastTimeoutRef.current) {
      clearTimeout(hideToastTimeoutRef.current);
    }
    
    const id = Date.now();
    setToast({ id, message, visible: true, hiding: false });
    
    toastTimeoutRef.current = setTimeout(() => {
      setToast(prev => (prev && prev.id === id ? { ...prev, hiding: true } : prev));
      hideToastTimeoutRef.current = setTimeout(() => {
        setToast(prev => (prev && prev.id === id ? null : prev));
      }, 300);
    }, 3000);
  }, []);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const res = await fetch('/api/categories');
        const data = await res.json();
        setCategories(data);
      } catch (error) {
        console.error('Failed to load categories:', error);
      }
    };
    loadCategories();
  }, []);

  const animateToDishes = useCallback((newDishes: Dish[]) => {
    const newIds = newDishes.map(d => d.id).sort().join(',');
    if (newIds === prevDishIds.current) {
      return;
    }
    
    if (fadeOutTimeoutRef.current) {
      clearTimeout(fadeOutTimeoutRef.current);
    }
    
    const hasCurrentItems = displayedDishes.length > 0;
    
    if (hasCurrentItems) {
      setMenuAnimating(true);
      
      fadeOutTimeoutRef.current = setTimeout(() => {
        setDisplayedDishes(newDishes);
        prevDishIds.current = newIds;
        requestAnimationFrame(() => {
          setMenuAnimating(false);
        });
        fadeOutTimeoutRef.current = null;
      }, 200);
    } else {
      setDisplayedDishes(newDishes);
      prevDishIds.current = newIds;
      setMenuAnimating(false);
    }
  }, [displayedDishes.length]);

  useEffect(() => {
    const loadDishes = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/dishes?categoryId=${activeCategory}`);
        const data = await res.json();
        setDishes(data);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load dishes:', error);
        setIsLoading(false);
      }
    };
    loadDishes();
  }, [activeCategory]);

  const filteredDishes = searchTerm.trim()
    ? dishes.filter(
        d =>
          d.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          d.description.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : dishes;

  useEffect(() => {
    if (isLoading) {
      return;
    }
    
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    
    const debounceTime = displayedDishes.length > 0 ? 120 : 0;
    searchDebounceRef.current = setTimeout(() => {
      animateToDishes(filteredDishes);
    }, debounceTime);
    
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [filteredDishes, isLoading, animateToDishes, displayedDishes.length]);

  const handleToggleFavorite = useCallback((dishId: string) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(dishId)) {
        newFavorites.delete(dishId);
      } else {
        newFavorites.add(dishId);
      }
      return newFavorites;
    });
  }, []);

  const handleAddToCart = useCallback((dish: Dish) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === dish.id);
      if (existing) {
        return prev.map(item =>
          item.id === dish.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...dish, quantity: 1 }];
    });
    showToast(`已添加 ${dish.name} 到购物车`);
  }, [showToast]);

  const handleUpdateQuantity = useCallback((dishId: string, delta: number) => {
    setCart(prev => {
      return prev.map(item =>
        item.id === dishId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
      );
    });
  }, []);

  const handleRemoveFromCart = useCallback((dishId: string) => {
    setCart(prev => prev.filter(item => item.id !== dishId));
  }, []);

  const handleSubmitOrder = useCallback(async () => {
    const validItems = cart.filter(item => item.quantity > 0);
    if (validItems.length === 0) {
      showToast('购物车为空，请先添加菜品');
      return;
    }

    const items = validItems.map(item => ({
      dishId: item.id,
      quantity: item.quantity
    }));

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ items })
      });

      if (res.ok) {
        const data = await res.json();
        showToast(`下单成功，订单号：${data.orderId}，等待时间：${data.waitTime}分钟`);
        setCart([]);
        setCartOpen(false);
      } else {
        const error = await res.json();
        showToast(error.error || '下单失败，请重试');
      }
    } catch (error) {
      showToast('网络错误，请稍后重试');
    }
  }, [cart, showToast]);

  const validCartItems = cart.filter(item => item.quantity > 0);
  const totalPrice = validCartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalCount = validCartItems.reduce((sum, item) => sum + item.quantity, 0);

  const handleCartSectionClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isMobile && e.target === e.currentTarget) {
      setCartOpen(false);
    }
  };

  return (
    <div className={`app ${isMobile ? 'mobile' : 'desktop'}`}>
      <nav className="navbar">
        <div className="navbar-content">
          <div className="logo">
            <span className="logo-icon">🍽️</span>
            <span className="logo-text">美食餐厅</span>
          </div>
          <div className="search-container">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              className="search-input"
              placeholder="搜索菜品..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <button
            className="cart-toggle-btn"
            onClick={() => setCartOpen(!cartOpen)}
          >
            🛒 {isMobile ? '购物车' : '购物车'}
            {totalCount > 0 && <span className="cart-badge">{totalCount}</span>}
          </button>
        </div>
      </nav>

      <div className="main-container">
        <main className={`menu-section ${menuAnimating ? 'menu-animating' : ''}`}>
          <div className="category-tabs">
            {categories.map(cat => (
              <button
                key={cat.id}
                className={`category-tab ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                <span className="tab-icon">{cat.icon}</span>
                <span className="tab-name">{cat.name}</span>
              </button>
            ))}
          </div>

          <div className={`menu-list-wrapper ${menuAnimating ? 'fade-out' : 'fade-in'}`}>
            <MenuList
              dishes={displayedDishes}
              favorites={favorites}
              onToggleFavorite={handleToggleFavorite}
              onAddToCart={handleAddToCart}
              isLoading={isLoading}
            />
          </div>
        </main>

        <aside 
          className={`cart-section ${cartOpen ? 'open' : ''} ${isMobile ? 'mobile-cart' : ''}`}
          onClick={handleCartSectionClick}
        >
          <Cart
            items={cart}
            totalPrice={totalPrice}
            onUpdateQuantity={handleUpdateQuantity}
            onRemove={handleRemoveFromCart}
            onSubmit={handleSubmitOrder}
            onClose={() => setCartOpen(false)}
          />
        </aside>
      </div>

      {toast && (
        <div className={`toast ${toast.visible && !toast.hiding ? 'visible' : ''} ${toast.hiding ? 'hiding' : ''}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
