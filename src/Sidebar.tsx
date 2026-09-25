import { useState } from 'react';
import type { Product, FilterState } from './types';
import { AVAILABLE_COLORS, AVAILABLE_MATERIALS, COLOR_MAP } from './types';

interface SidebarProps {
  products: Product[];
  selectedProducts: Product[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onResetFilters: () => void;
  onSelectProduct: (id: string) => void;
}

const ProgressBar: React.FC<{ value: number; max: number; color: string }> = ({ value, max, color }) => {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{
      width: '100%',
      height: '8px',
      backgroundColor: '#2a2a3e',
      borderRadius: '4px',
      overflow: 'hidden'
    }}>
      <div style={{
        width: `${percent}%`,
        height: '100%',
        backgroundColor: color,
        borderRadius: '4px',
        transition: 'width 0.5s ease-in-out'
      }} />
    </div>
  );
};

const RangeSlider: React.FC<{
  label: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  unit?: string;
  onChange: (value: [number, number]) => void;
}> = ({ label, min, max, step, value, unit = '', onChange }) => {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '8px',
        color: '#ffffff',
        fontSize: '13px'
      }}>
        <span>{label}</span>
        <span style={{ color: '#00d2ff' }}>
          {value[0]}{unit} - {value[1]}{unit}
        </span>
      </div>
      <div style={{ position: 'relative', height: '32px', padding: '0 8px' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value[0]}
          onChange={(e) => onChange([Math.min(Number(e.target.value), value[1] - step), value[1]])}
          style={{
            position: 'absolute',
            width: '100%',
            left: 0,
            top: '12px',
            height: '8px',
            appearance: 'none',
            background: 'transparent',
            pointerEvents: 'none',
            zIndex: 3
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value[1]}
          onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0] + step)])}
          style={{
            position: 'absolute',
            width: '100%',
            left: 0,
            top: '12px',
            height: '8px',
            appearance: 'none',
            background: 'transparent',
            pointerEvents: 'none',
            zIndex: 4
          }}
        />
        <div style={{
          position: 'absolute',
          left: '8px',
          right: '8px',
          top: '16px',
          height: '4px',
          backgroundColor: '#2a2a3e',
          borderRadius: '2px'
        }} />
        <div style={{
          position: 'absolute',
          left: `${8 + ((value[0] - min) / (max - min)) * (100 - 16)}%`,
          right: `${100 - 8 - ((value[1] - min) / (max - min)) * (100 - 16)}%`,
          top: '16px',
          height: '4px',
          backgroundColor: '#00d2ff',
          borderRadius: '2px'
        }} />
      </div>
      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #00d2ff;
          cursor: pointer;
          pointer-events: auto;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 6px rgba(0, 210, 255, 0.5);
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #00d2ff;
          cursor: pointer;
          pointer-events: auto;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 6px rgba(0, 210, 255, 0.5);
        }
      `}</style>
    </div>
  );
};

const CheckboxGroup: React.FC<{
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  isColor?: boolean;
}> = ({ label, options, selected, onChange, isColor = false }) => {
  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter(o => o !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ color: '#ffffff', fontSize: '13px', marginBottom: '8px' }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {options.map(option => (
          <button
            key={option}
            onClick={() => toggleOption(option)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '8px',
              border: selected.includes(option) ? '1px solid #00d2ff' : '1px solid #3a3a4e',
              backgroundColor: selected.includes(option) ? 'rgba(0, 210, 255, 0.15)' : 'transparent',
              color: selected.includes(option) ? '#00d2ff' : '#aaaaaa',
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out'
            }}
          >
            {isColor && (
              <span style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: COLOR_MAP[option] || '#888',
                border: '1px solid rgba(255,255,255,0.2)'
              }} />
            )}
            {option}
          </button>
        ))}
      </div>
    </div>
  );
};

const ProductDetailCard: React.FC<{
  product: Product;
  isSelected: boolean;
  onSelect: (id: string) => void;
}> = ({ product, isSelected, onSelect }) => {
  const pricePercent = (product.price / 5000) * 100;
  const stockPercent = (product.stock / product.maxStock) * 100;

  return (
    <div
      onClick={() => onSelect(product.id)}
      style={{
        padding: '12px',
        backgroundColor: isSelected ? 'rgba(0, 210, 255, 0.1)' : (product.id.charCodeAt(1) % 2 === 0 ? '#2a2a3e' : '#1e1e2e'),
        borderRadius: '8px',
        marginBottom: '8px',
        cursor: 'pointer',
        border: isSelected ? '1px solid #00d2ff' : '1px solid transparent',
        transition: 'all 0.3s ease-in-out'
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px'
      }}>
        <span style={{ color: '#ffffff', fontWeight: 'bold', fontSize: '14px' }}>
          {product.name}
        </span>
        <span style={{ color: '#ffd700', fontWeight: 'bold' }}>¥{product.price}</span>
      </div>
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
        {product.description}
      </div>
      <div style={{ marginBottom: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#aaa', marginBottom: '3px' }}>
          <span>价格占比</span>
          <span>{pricePercent.toFixed(1)}%</span>
        </div>
        <ProgressBar value={product.price} max={5000} color="#e94560" />
      </div>
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#aaa', marginBottom: '3px' }}>
          <span>库存比例</span>
          <span>{stockPercent.toFixed(1)}%</span>
        </div>
        <ProgressBar value={product.stock} max={product.maxStock} color="#4ade80" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px' }}>
        <div style={{ color: '#888' }}>尺寸: <span style={{ color: '#fff' }}>{product.size}cm</span></div>
        <div style={{ color: '#888' }}>颜色: <span style={{ color: COLOR_MAP[product.color] || '#fff' }}>{product.color}</span></div>
        <div style={{ color: '#888' }}>材质: <span style={{ color: '#fff' }}>{product.material}</span></div>
        <div style={{ color: '#888' }}>库存: <span style={{ color: '#fff' }}>{product.stock}</span></div>
      </div>
    </div>
  );
};

const ComparisonTable: React.FC<{ products: Product[] }> = ({ products }) => {
  const params = [
    { key: 'price', label: '价格', unit: '¥', color: '#e94560' },
    { key: 'size', label: '尺寸', unit: 'cm', color: '#4a90d9' },
    { key: 'color', label: '颜色', unit: '', color: '#4ade80' },
    { key: 'material', label: '材质', unit: '', color: '#ffa500' },
    { key: 'stock', label: '库存', unit: '', color: '#a855f7' }
  ];

  return (
    <div style={{
      border: '1px solid rgba(0, 210, 255, 0.3)',
      borderRadius: '8px',
      overflow: 'hidden',
      marginBottom: '16px'
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ backgroundColor: 'rgba(0, 210, 255, 0.1)' }}>
            <th style={{ padding: '10px', textAlign: 'left', color: '#00d2ff', fontWeight: 'bold' }}>参数</th>
            {products.map(p => (
              <th key={p.id} style={{ padding: '10px', textAlign: 'center', color: '#fff', fontWeight: 'bold' }}>
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {params.map((param, idx) => (
            <tr key={param.key} style={{ backgroundColor: idx % 2 === 0 ? '#2a2a3e' : '#1e1e2e' }}>
              <td style={{ padding: '10px', color: param.color, fontWeight: 'bold' }}>{param.label}</td>
              {products.map(p => {
                const value = (p as any)[param.key];
                const displayValue = param.key === 'color'
                  ? <span style={{ color: COLOR_MAP[value] || '#fff' }}>{value}</span>
                  : `${value}${param.unit}`;
                return (
                  <td key={p.id} style={{ padding: '10px', textAlign: 'center', color: '#ffffff' }}>
                    {displayValue}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Sidebar: React.FC<SidebarProps> = ({
  products,
  selectedProducts,
  filters,
  onFiltersChange,
  onResetFilters,
  onSelectProduct
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="sidebar"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: '320px',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderRight: '1px solid rgba(255, 255, 255, 0.1)',
        overflowY: 'auto',
        overflowX: 'hidden',
        zIndex: 10,
        transition: 'all 0.3s ease-in-out',
        height: isExpanded ? '100vh' : undefined
      }}
    >
      <div style={{ padding: '20px 16px' }}>
        <div style={{
          fontSize: '18px',
          fontWeight: 'bold',
          color: '#ffffff',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span style={{ color: '#00d2ff' }}>◆</span>
          3D 商品对比工具
        </div>

        {selectedProducts.length >= 2 && (
          <>
            <div style={{
              fontSize: '14px',
              fontWeight: 'bold',
              color: '#00d2ff',
              marginBottom: '12px'
            }}>
              📊 参数对比 ({selectedProducts.length}/4)
            </div>
            <ComparisonTable products={selectedProducts} />
          </>
        )}

        <div style={{
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#ffffff',
          marginBottom: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>🔍 筛选条件</span>
          <button
            onClick={onResetFilters}
            style={{
              padding: '4px 12px',
              fontSize: '11px',
              backgroundColor: 'rgba(233, 69, 96, 0.2)',
              color: '#e94560',
              border: '1px solid #e94560',
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out'
            }}
          >
            重置筛选
          </button>
        </div>

        <RangeSlider
          label="价格范围"
          min={0}
          max={5000}
          step={50}
          value={filters.priceRange}
          unit="元"
          onChange={(value) => onFiltersChange({ ...filters, priceRange: value })}
        />

        <RangeSlider
          label="尺寸范围"
          min={10}
          max={100}
          step={5}
          value={filters.sizeRange}
          unit="cm"
          onChange={(value) => onFiltersChange({ ...filters, sizeRange: value })}
        />

        <CheckboxGroup
          label="颜色筛选"
          options={AVAILABLE_COLORS}
          selected={filters.colors}
          onChange={(selected) => onFiltersChange({ ...filters, colors: selected })}
          isColor
        />

        <CheckboxGroup
          label="材质筛选"
          options={AVAILABLE_MATERIALS}
          selected={filters.materials}
          onChange={(selected) => onFiltersChange({ ...filters, materials: selected })}
        />

        <div style={{
          fontSize: '14px',
          fontWeight: 'bold',
          color: '#ffffff',
          marginTop: '20px',
          marginBottom: '12px'
        }}>
          {selectedProducts.length > 0 ? '✅ 已选商品' : '🎯 商品列表'}
          {selectedProducts.length > 0 && (
            <span style={{ color: '#00d2ff', fontSize: '12px', marginLeft: '8px' }}>
              ({selectedProducts.length}/4，点击取消)
            </span>
          )}
        </div>

        {selectedProducts.length > 0
          ? selectedProducts.map(product => (
              <ProductDetailCard
                key={product.id}
                product={product}
                isSelected={true}
                onSelect={onSelectProduct}
              />
            ))
          : products.map(product => (
              <ProductDetailCard
                key={product.id}
                product={product}
                isSelected={false}
                onSelect={onSelectProduct}
              />
            ))
        }

        {selectedProducts.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '20px',
            color: '#666',
            fontSize: '12px'
          }}>
            💡 点击3D场景中的卡片或上方商品<br />可选择2-4个进行参数对比
          </div>
        )}
      </div>

      {isExpanded && (
        <div
          onClick={() => setIsExpanded(false)}
          style={{
            position: 'absolute',
            top: 0,
            right: '-30px',
            width: '30px',
            height: '60px',
            backgroundColor: 'rgba(255,255,255,0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#00d2ff',
            borderRadius: '0 8px 8px 0'
          }}
        >
          ◀
        </div>
      )}
    </div>
  );
};

export default Sidebar;
