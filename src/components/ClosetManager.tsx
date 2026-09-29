import React, { useState, useMemo } from 'react';
import { ClothingItem, ClothingCategory, StyleTag, COLOR_PALETTE, STYLE_TAGS, CATEGORY_LABELS, CATEGORY_COLORS } from '../types';
import { generateId } from '../hooks/useLocalStorage';
import { ClothingCard } from './ClothingCard';
import { VirtualScroll } from './VirtualScroll';
import { Plus, X, Filter, Search } from 'lucide-react';

interface ClosetManagerProps {
  items: ClothingItem[];
  onItemsChange: (items: ClothingItem[]) => void;
}

export const ClosetManager: React.FC<ClosetManagerProps> = ({ items, onItemsChange }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ClothingCategory | 'all'>('all');
  const [selectedStyle, setSelectedStyle] = useState<StyleTag | 'all'>('all');
  const [newItem, setNewItem] = useState({
    name: '',
    category: 'top' as ClothingCategory,
    color: COLOR_PALETTE[0],
    styleTags: [] as StyleTag[],
    photoUrl: '',
  });

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (selectedCategory !== 'all' && item.category !== selectedCategory) {
        return false;
      }
      if (selectedStyle !== 'all' && !item.styleTags.includes(selectedStyle)) {
        return false;
      }
      return true;
    });
  }, [items, searchQuery, selectedCategory, selectedStyle]);

  const handleAddItem = () => {
    if (!newItem.name.trim()) return;

    const item: ClothingItem = {
      id: generateId(),
      name: newItem.name.trim(),
      category: newItem.category,
      color: newItem.color,
      styleTags: [...newItem.styleTags],
      photoUrl: newItem.photoUrl.trim() || undefined,
      createdAt: Date.now(),
    };

    onItemsChange([item, ...items]);
    setShowAddModal(false);
    setNewItem({
      name: '',
      category: 'top',
      color: COLOR_PALETTE[0],
      styleTags: [],
      photoUrl: '',
    });
  };

  const handleDeleteItem = (id: string) => {
    onItemsChange(items.filter(item => item.id !== id));
  };

  const toggleStyleTag = (tag: StyleTag) => {
    setNewItem(prev => ({
      ...prev,
      styleTags: prev.styleTags.includes(tag)
        ? prev.styleTags.filter(t => t !== tag)
        : [...prev.styleTags, tag],
    }));
  };

  return (
    <div className="closet-manager fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="closet-header" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--color-text)' }}>
            我的衣柜
          </h2>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              backgroundColor: 'var(--color-accent)',
              color: 'white',
              borderRadius: 'var(--radius-md)',
              fontWeight: 500,
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <Plus size={18} />
            添加衣物
          </button>
        </div>

        <div className="filter-bar" style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: '16px',
          backgroundColor: 'var(--color-white)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-light)' }}>
            <Search size={18} />
            <input
              type="text"
              placeholder="搜索衣物..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                border: 'none',
                outline: 'none',
                fontSize: '14px',
                padding: '6px 0',
                width: '180px',
                backgroundColor: 'transparent',
              }}
            />
          </div>

          <div style={{ height: '24px', width: '1px', backgroundColor: 'var(--color-border)' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Filter size={18} style={{ color: 'var(--color-text-light)' }} />
            <span style={{ fontSize: '14px', color: 'var(--color-text-light)' }}>类别:</span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setSelectedCategory('all')}
                style={{
                  padding: '4px 12px',
                  borderRadius: '16px',
                  fontSize: '13px',
                  transition: 'all var(--transition-fast)',
                  backgroundColor: selectedCategory === 'all' ? 'var(--color-accent)' : 'var(--color-secondary)',
                  color: selectedCategory === 'all' ? 'white' : 'var(--color-text)',
                }}
              >
                全部
              </button>
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSelectedCategory(key as ClothingCategory)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '16px',
                    fontSize: '13px',
                    transition: 'all var(--transition-fast)',
                    backgroundColor: selectedCategory === key
                      ? CATEGORY_COLORS[key as ClothingCategory]
                      : 'var(--color-secondary)',
                    color: selectedCategory === key ? 'white' : 'var(--color-text)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px', color: 'var(--color-text-light)' }}>风格:</span>
            <select
              value={selectedStyle}
              onChange={(e) => setSelectedStyle(e.target.value as StyleTag | 'all')}
              style={{
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                fontSize: '13px',
                backgroundColor: 'white',
              }}
            >
              <option value="all">全部风格</option>
              {STYLE_TAGS.map(tag => (
                <option key={tag} value={tag}>{tag}</option>
              ))}
            </select>
          </div>

          <div style={{ marginLeft: 'auto', fontSize: '14px', color: 'var(--color-text-light)' }}>
            共 {filteredItems.length} 件衣物
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {filteredItems.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '300px',
            color: 'var(--color-text-light)',
          }}>
            <p style={{ marginBottom: '16px' }}>暂无衣物，点击"添加衣物"开始记录吧</p>
          </div>
        ) : (
          <VirtualScroll
            items={filteredItems}
            itemHeight={220}
            gap={16}
            columns={4}
            style={{ height: 'calc(100vh - 280px)', maxHeight: '600px' }}
            renderItem={(item) => (
              <ClothingCard
                item={item}
                onDelete={handleDeleteItem}
              />
            )}
          />
        )}
      </div>

      {showAddModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn var(--transition-fast) ease',
          }}
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="modal-content"
            style={{
              backgroundColor: 'var(--color-white)',
              borderRadius: 'var(--radius-lg)',
              padding: '32px',
              width: '90%',
              maxWidth: '500px',
              maxHeight: '90vh',
              overflowY: 'auto',
              animation: 'slideUp var(--transition-normal) ease',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: 600 }}>添加新衣物</h3>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-light)',
                  transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-secondary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
                  衣物名称
                </label>
                <input
                  type="text"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  placeholder="例如：白色T恤"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color var(--transition-fast)',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-accent)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
                  类别
                </label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setNewItem({ ...newItem, category: key as ClothingCategory })}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '14px',
                        fontWeight: 500,
                        transition: 'all var(--transition-fast)',
                        backgroundColor: newItem.category === key
                          ? CATEGORY_COLORS[key as ClothingCategory]
                          : 'var(--color-secondary)',
                        color: newItem.category === key ? 'white' : 'var(--color-text)',
                        transform: newItem.category === key ? 'scale(1.05)' : 'scale(1)',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
                  颜色
                </label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {COLOR_PALETTE.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewItem({ ...newItem, color })}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: color,
                        border: newItem.color === color
                          ? '3px solid var(--color-accent)'
                          : '2px solid var(--color-border)',
                        transition: 'all var(--transition-fast)',
                        transform: newItem.color === color ? 'scale(1.2)' : 'scale(1)',
                        boxShadow: newItem.color === color ? '0 0 0 2px rgba(192, 57, 43, 0.3)' : 'none',
                      }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
                  风格标签（可多选）
                </label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {STYLE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => toggleStyleTag(tag)}
                      style={{
                        padding: '6px 16px',
                        borderRadius: '20px',
                        fontSize: '14px',
                        fontWeight: 500,
                        transition: 'all 0.2s ease',
                        backgroundColor: newItem.styleTags.includes(tag)
                          ? 'var(--color-accent)'
                          : 'var(--color-secondary)',
                        color: newItem.styleTags.includes(tag) ? 'white' : 'var(--color-text)',
                        transform: newItem.styleTags.includes(tag) ? 'scale(1.05)' : 'scale(1)',
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>
                  照片URL（可选）
                </label>
                <input
                  type="text"
                  value={newItem.photoUrl}
                  onChange={(e) => setNewItem({ ...newItem, photoUrl: e.target.value })}
                  placeholder="https://example.com/photo.jpg"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color var(--transition-fast)',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-accent)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button
                  onClick={() => setShowAddModal(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '14px',
                    fontWeight: 500,
                    backgroundColor: 'var(--color-secondary)',
                    color: 'var(--color-text)',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1';
                  }}
                >
                  取消
                </button>
                <button
                  onClick={handleAddItem}
                  disabled={!newItem.name.trim()}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '14px',
                    fontWeight: 500,
                    backgroundColor: newItem.name.trim() ? 'var(--color-accent)' : 'var(--color-border)',
                    color: 'white',
                    transition: 'all var(--transition-fast)',
                    cursor: newItem.name.trim() ? 'pointer' : 'not-allowed',
                  }}
                  onMouseEnter={(e) => {
                    if (newItem.name.trim()) {
                      e.currentTarget.style.transform = 'scale(1.02)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  添加
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
