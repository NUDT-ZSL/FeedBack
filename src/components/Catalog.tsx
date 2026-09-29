import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Product, CatalogProps } from '../types';
import { products as allProducts } from '../data/products';
import toast from 'react-hot-toast';

const PAGE_SIZE = 12;

function ProductCard({
  product,
  isSelected,
  onAdd,
  index
}: {
  product: Product;
  isSelected: boolean;
  onAdd: () => void;
  index: number;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isGlowing, setIsGlowing] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleAdd = useCallback(() => {
    setIsGlowing(true);
    onAdd();
    toast.success(`已将「${product.name}」加入礼盒`, {
      duration: 1800,
      icon: '🍫',
      style: {
        background: '#FFF8E1',
        color: '#3E2723',
        border: '1px solid #D4A017',
        borderRadius: '12px',
        fontFamily: "'Noto Serif SC', serif"
      }
    });
    setTimeout(() => setIsGlowing(false), 500);
  }, [onAdd, product.name]);

  const isVisible = useIsInViewport(cardRef, index);

  return (
    <div
      ref={cardRef}
      className={`product-card ${isGlowing ? 'glowing' : ''} ${isSelected ? 'selected' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ animationDelay: `${(index % PAGE_SIZE) * 30}ms` }}
    >
      <div className="card-image-wrap">
        {isVisible && (
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            className={`card-image ${isHovered ? 'zoomed' : ''} ${imgLoaded ? 'loaded' : 'loading'}`}
          />
        )}
        {!imgLoaded && <div className="card-image-skeleton">🍫</div>}
        <div className={`card-overlay ${isHovered ? 'visible' : ''}`}>
          <button
            className={`add-btn ${isSelected ? 'added' : ''}`}
            onClick={handleAdd}
            disabled={isSelected}
          >
            {isSelected ? '✓ 已加入' : '+ 加入礼盒'}
          </button>
        </div>
        <span className="cocoa-badge">{product.cocoaContent}%</span>
      </div>
      <div className="card-content">
        <h3 className="card-name">{product.name}</h3>
        <p className="card-origin">
          <span className="origin-icon">📍</span>
          {product.origin}
        </p>
        <div className="flavor-tags">
          {product.flavorTags.map((tag, i) => (
            <span key={i} className="flavor-tag">{tag}</span>
          ))}
        </div>
        <p className="card-price">¥{product.price.toFixed(2)} <span>/ 块</span></p>
      </div>
    </div>
  );
}

function useIsInViewport(ref: React.RefObject<HTMLDivElement>, index: number): boolean {
  const [isVisible, setIsVisible] = useState(index < 20);

  useEffect(() => {
    if (index < 20) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, index]);

  return isVisible;
}

export default function Catalog({ onSelectProduct, selectedProductIds }: CatalogProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [cocoaFilter, setCocoaFilter] = useState<number | null>(null);
  const [containerRef] = useState(() => document.createElement('div'));

  const filteredProducts = useMemo(() => {
    return allProducts.filter(p => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        if (!p.name.toLowerCase().includes(term) &&
            !p.origin.toLowerCase().includes(term) &&
            !p.flavorTags.some(t => t.toLowerCase().includes(term))) {
          return false;
        }
      }
      if (cocoaFilter !== null) {
        if (cocoaFilter === 70 && p.cocoaContent < 70) return false;
        if (cocoaFilter === 80 && (p.cocoaContent < 80 || p.cocoaContent >= 90)) return false;
        if (cocoaFilter === 90 && p.cocoaContent < 90) return false;
        if (cocoaFilter === 0 && p.cocoaContent >= 70) return false;
      }
      return true;
    });
  }, [searchTerm, cocoaFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedProducts = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, cocoaFilter]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void containerRef;
  }, [currentPage, containerRef]);

  return (
    <div className="catalog-page fade-in">
      <div className="catalog-header">
        <h1 className="catalog-title">精品巧克力目录</h1>
        <p className="catalog-subtitle">精选全球单一产区可可豆，每一款都是独一无二的味觉旅程</p>
      </div>

      <div className="catalog-filters">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="搜索名称、产地或风味..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="filter-group">
          <span className="filter-label">可可含量：</span>
          {[
            { v: null, label: '全部' },
            { v: 0, label: '<70% 温和' },
            { v: 70, label: '≥70% 浓郁' },
            { v: 80, label: '80%-90% 醇厚' },
            { v: 90, label: '≥90% 极致' }
          ].map(opt => (
            <button
              key={opt.label}
              className={`filter-btn ${cocoaFilter === opt.v ? 'active' : ''}`}
              onClick={() => setCocoaFilter(opt.v)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="results-bar">
        <span>共找到 <strong>{filteredProducts.length}</strong> 款巧克力</span>
        <span className="selection-info">已选 {selectedProductIds.size}/6 款</span>
      </div>

      <div className="product-grid">
        {paginatedProducts.map((product, idx) => (
          <ProductCard
            key={product.id}
            product={product}
            isSelected={selectedProductIds.has(product.id)}
            onAdd={() => onSelectProduct(product.id)}
            index={(safePage - 1) * PAGE_SIZE + idx}
          />
        ))}
      </div>

      {paginatedProducts.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <p className="empty-text">未找到匹配的巧克力，试试其他关键词吧~</p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="page-btn"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={safePage === 1}
          >
            ← 上一页
          </button>
          <div className="page-numbers">
            {Array.from({ length: totalPages }, (_, i) => i + 1).slice(
              Math.max(0, safePage - 3),
              Math.min(totalPages, safePage + 2)
            ).map(page => (
              <button
                key={page}
                className={`page-num ${page === safePage ? 'active' : ''}`}
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </button>
            ))}
          </div>
          <button
            className="page-btn"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
          >
            下一页 →
          </button>
        </div>
      )}
    </div>
  );
}
