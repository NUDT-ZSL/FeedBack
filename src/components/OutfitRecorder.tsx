import React, { useState, useMemo } from 'react';
import { ClothingItem, OutfitRecord, CATEGORY_COLORS, CATEGORY_LABELS, ClothingCategory } from '../types';
import { generateId } from '../hooks/useLocalStorage';
import { formatDate } from '../utils/styleUtils';
import { Star, Plus, X, Calendar } from 'lucide-react';

interface OutfitRecorderProps {
  items: ClothingItem[];
  records: OutfitRecord[];
  onRecordsChange: (records: OutfitRecord[]) => void;
}

export const OutfitRecorder: React.FC<OutfitRecorderProps> = ({
  items,
  records,
  onRecordsChange,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Record<ClothingCategory, string | null>>({
    top: null,
    bottom: null,
    outerwear: null,
    shoes: null,
    accessory: null,
  });
  const [selectedAccessories, setSelectedAccessories] = useState<string[]>([]);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [note, setNote] = useState('');
  const [animatingStar, setAnimatingStar] = useState<number | null>(null);

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [records]);

  const getItemById = (id: string | undefined) => items.find(item => item.id === id);

  const getItemsByCategory = (category: ClothingCategory) => {
    return items.filter(item => item.category === category);
  };

  const handleSelectItem = (category: ClothingCategory, itemId: string) => {
    if (category === 'accessory') {
      setSelectedAccessories(prev =>
        prev.includes(itemId)
          ? prev.filter(id => id !== itemId)
          : [...prev, itemId]
      );
    } else {
      setSelectedItems(prev => ({
        ...prev,
        [category]: prev[category] === itemId ? null : itemId,
      }));
    }
  };

  const handleRatingClick = (star: number) => {
    setRating(star);
    setAnimatingStar(star);
    setTimeout(() => setAnimatingStar(null), 200);
  };

  const handleSaveRecord = () => {
    if (!selectedItems.top && !selectedItems.bottom && !selectedItems.outerwear && !selectedItems.shoes && selectedAccessories.length === 0) {
      return;
    }

    const today = new Date().toISOString().split('T')[0];
    const newRecord: OutfitRecord = {
      id: generateId(),
      date: today,
      topId: selectedItems.top || undefined,
      bottomId: selectedItems.bottom || undefined,
      outerwearId: selectedItems.outerwear || undefined,
      shoesId: selectedItems.shoes || undefined,
      accessoryIds: [...selectedAccessories],
      rating,
      note: note.trim(),
      createdAt: Date.now(),
    };

    onRecordsChange([newRecord, ...records]);
    setShowModal(false);
    resetForm();
  };

  const resetForm = () => {
    setSelectedItems({
      top: null,
      bottom: null,
      outerwear: null,
      shoes: null,
      accessory: null,
    });
    setSelectedAccessories([]);
    setRating(0);
    setNote('');
  };

  const handleDeleteRecord = (id: string) => {
    onRecordsChange(records.filter(record => record.id !== id));
  };

  const renderStars = (ratingValue: number, interactive = false, size = 20) => {
    const displayRating = hoverRating && interactive ? hoverRating : ratingValue;
    
    return (
      <div style={{ display: 'flex', gap: '4px' }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => interactive && handleRatingClick(star)}
            onMouseEnter={() => interactive && setHoverRating(star)}
            onMouseLeave={() => interactive && setHoverRating(0)}
            style={{
              background: 'none',
              border: 'none',
              cursor: interactive ? 'pointer' : 'default',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              transition: 'transform 0.2s ease',
              transform: animatingStar === star ? 'scale(1.3)' : 'scale(1)',
            }}
          >
            <Star
              size={size}
              fill={star <= displayRating ? '#FFD700' : 'none'}
              color={star <= displayRating ? '#FFD700' : '#DDD'}
              style={{
                filter: animatingStar === star ? 'brightness(1.3) drop-shadow(0 0 4px #FFD700)' : 'none',
                transition: 'all 0.2s ease',
              }}
            />
          </button>
        ))}
      </div>
    );
  };

  const renderItemThumbnail = (item: ClothingItem | undefined, size: number = 48) => {
    if (!item) {
      return (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: '8px',
            backgroundColor: 'var(--color-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '10px',
            color: 'var(--color-text-light)',
          }}
        >
          无
        </div>
      );
    }

    if (item.photoUrl) {
      return (
        <img
          src={item.photoUrl}
          alt={item.name}
          style={{
            width: size,
            height: size,
            borderRadius: '8px',
            objectFit: 'cover',
            border: `2px solid ${CATEGORY_COLORS[item.category]}`,
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      );
    }

    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '8px',
          backgroundColor: item.color,
          border: `2px solid ${CATEGORY_COLORS[item.category]}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px',
          color: item.color === '#FFFFFF' || item.color === '#FFFF00' || item.color === '#FFD700' ? '#333' : 'white',
          fontWeight: 500,
        }}
      >
        {CATEGORY_LABELS[item.category].charAt(0)}
      </div>
    );
  };

  return (
    <div className="outfit-recorder fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--color-text)' }}>
          穿搭记录
        </h2>
        <button
          onClick={() => setShowModal(true)}
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
          记录穿搭
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {sortedRecords.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '300px',
            color: 'var(--color-text-light)',
          }}>
            <Calendar size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
            <p>还没有穿搭记录，开始记录你的每日穿搭吧</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {sortedRecords.map((record) => {
              const topItem = getItemById(record.topId);
              const bottomItem = getItemById(record.bottomId);
              const outerwearItem = getItemById(record.outerwearId);
              const shoesItem = getItemById(record.shoesId);
              const accessoryItems = record.accessoryIds.map(id => getItemById(id)).filter(Boolean) as ClothingItem[];

              const allItems = [topItem, bottomItem, outerwearItem, shoesItem, ...accessoryItems].filter(Boolean) as ClothingItem[];

              return (
                <div
                  key={record.id}
                  className="outfit-record-card"
                  style={{
                    backgroundColor: 'var(--color-white)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-sm)',
                    padding: '20px',
                    transition: 'all var(--transition-normal)',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-4px)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>
                        {formatDate(record.date)}
                      </h3>
                      {renderStars(record.rating, false, 16)}
                    </div>
                    <button
                      onClick={() => handleDeleteRecord(record.id)}
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-text-light)',
                        opacity: 0,
                        transition: 'all var(--transition-fast)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '1';
                        e.currentTarget.style.backgroundColor = 'var(--color-secondary)';
                        e.currentTarget.style.color = 'var(--color-accent)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '0';
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--color-text-light)';
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    {allItems.map((item) => (
                      <div key={item.id} style={{ textAlign: 'center' }}>
                        {renderItemThumbnail(item, 56)}
                        <p style={{ fontSize: '12px', marginTop: '6px', color: 'var(--color-text-light)' }}>
                          {item.name.length > 6 ? item.name.slice(0, 6) + '...' : item.name}
                        </p>
                      </div>
                    ))}
                  </div>

                  {record.note && (
                    <p style={{
                      fontSize: '14px',
                      color: 'var(--color-text-light)',
                      backgroundColor: 'var(--color-primary)',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                    }}>
                      {record.note}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
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
          onClick={() => setShowModal(false)}
        >
          <div
            className="modal-content"
            style={{
              backgroundColor: 'var(--color-white)',
              borderRadius: 'var(--radius-lg)',
              padding: '32px',
              width: '90%',
              maxWidth: '600px',
              maxHeight: '90vh',
              overflowY: 'auto',
              animation: 'slideUp var(--transition-normal) ease',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '20px', fontWeight: 600 }}>记录今日穿搭</h3>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-light)',
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
              {(['top', 'bottom', 'outerwear', 'shoes', 'accessory'] as ClothingCategory[]).map((category) => {
                const categoryItems = getItemsByCategory(category);
                const isAccessory = category === 'accessory';
                const selected = isAccessory
                  ? selectedAccessories
                  : selectedItems[category]
                    ? [selectedItems[category]]
                    : [];

                return (
                  <div key={category}>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '10px' }}>
                      {CATEGORY_LABELS[category]}
                      {!['top', 'bottom'].includes(category) && (
                        <span style={{ fontSize: '12px', color: 'var(--color-text-light)', marginLeft: '8px' }}>
                          （可选）
                        </span>
                      )}
                    </label>
                    {categoryItems.length === 0 ? (
                      <p style={{ fontSize: '13px', color: 'var(--color-text-light)' }}>
                        暂无{CATEGORY_LABELS[category]}，请先在衣柜中添加
                      </p>
                    ) : (
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {categoryItems.map((item) => {
                          const isSelected = selected.includes(item.id);
                          return (
                            <button
                              key={item.id}
                              onClick={() => handleSelectItem(category, item.id)}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                padding: '10px',
                                borderRadius: 'var(--radius-sm)',
                                border: `2px solid ${isSelected ? CATEGORY_COLORS[category] : 'transparent'}`,
                                backgroundColor: isSelected ? `${CATEGORY_COLORS[category]}15` : 'var(--color-secondary)',
                                transition: 'all var(--transition-fast)',
                                transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                              }}
                            >
                              {renderItemThumbnail(item, 48)}
                              <span style={{
                                fontSize: '12px',
                                marginTop: '6px',
                                color: isSelected ? CATEGORY_COLORS[category] : 'var(--color-text)',
                                fontWeight: isSelected ? 500 : 400,
                                maxWidth: '60px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}>
                                {item.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '10px' }}>
                  评分
                </label>
                {renderStars(rating, true, 28)}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '10px' }}>
                  穿搭说明（最多100字）
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 100))}
                  placeholder="今天的穿搭心得..."
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '14px',
                    outline: 'none',
                    resize: 'vertical',
                    minHeight: '80px',
                    transition: 'border-color var(--transition-fast)',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-accent)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                  }}
                />
                <p style={{ fontSize: '12px', color: 'var(--color-text-light)', marginTop: '4px', textAlign: 'right' }}>
                  {note.length}/100
                </p>
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button
                  onClick={() => setShowModal(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '14px',
                    fontWeight: 500,
                    backgroundColor: 'var(--color-secondary)',
                    color: 'var(--color-text)',
                  }}
                >
                  取消
                </button>
                <button
                  onClick={handleSaveRecord}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '14px',
                    fontWeight: 500,
                    backgroundColor: 'var(--color-accent)',
                    color: 'white',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.02)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  保存记录
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
