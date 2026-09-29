import React, { useState } from 'react';
import { Plus, Sprout, Leaf, Flower, TreePine, Droplets } from 'lucide-react';
import type { Plant, PlantCategory, Difficulty } from '../types';
import { categoryConfig, difficultyStars } from '../types';
import PlantCard from './PlantCard';
import ReminderBanner from './ReminderBanner';
import type { Reminder } from '../types';

interface HomePageProps {
  plants: Plant[];
  loading: boolean;
  addPlant: (data: {
    name: string;
    category: PlantCategory;
    purchaseDate: string;
    difficulty: Difficulty;
    nextWateringDate?: string;
    nextFertilizingDate?: string;
  }) => Promise<void>;
  fetchTodayReminders: () => Promise<Reminder[]>;
}

const categoryIcons: Record<PlantCategory, React.ReactNode> = {
  succulent: <Sprout size={20} />,
  green: <Leaf size={20} />,
  flowering: <Flower size={20} />,
  cactus: <TreePine size={20} />,
  fern: <Droplets size={20} />,
};

const HomePage: React.FC<HomePageProps> = ({ plants, loading, addPlant, fetchTodayReminders }) => {
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    category: 'green' as PlantCategory,
    purchaseDate: new Date().toISOString().split('T')[0],
    difficulty: 1 as Difficulty,
    nextWateringDate: '',
    nextFertilizingDate: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    await addPlant({
      name: formData.name.trim(),
      category: formData.category,
      purchaseDate: formData.purchaseDate,
      difficulty: formData.difficulty,
      nextWateringDate: formData.nextWateringDate || undefined,
      nextFertilizingDate: formData.nextFertilizingDate || undefined,
    });

    setFormData({
      name: '',
      category: 'green',
      purchaseDate: new Date().toISOString().split('T')[0],
      difficulty: 1,
      nextWateringDate: '',
      nextFertilizingDate: '',
    });
    setShowModal(false);
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <ReminderBanner fetchReminders={fetchTodayReminders} />

      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '32px 24px',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '32px',
        }}>
          <div>
            <h1 style={{
              fontSize: '32px',
              fontWeight: 700,
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              🌱 我的迷你植物园
            </h1>
            <p style={{
              fontSize: '14px',
              color: 'var(--color-text-light)',
            }}>
              共 {plants.length} 棵植物
            </p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 24px',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'var(--color-primary)',
              color: 'white',
              cursor: 'pointer',
              fontSize: '15px',
              fontWeight: 500,
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#45a049';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-primary)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <Plus size={20} />
            添加植物
          </button>
        </div>

        {loading ? (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '300px',
            fontSize: '16px',
            color: 'var(--color-text-light)',
          }}>
            加载中...
          </div>
        ) : plants.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '80px 20px',
          }}>
            <div style={{
              fontSize: '64px',
              marginBottom: '16px',
            }}>
              🌿
            </div>
            <h2 style={{
              fontSize: '24px',
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              还没有植物
            </h2>
            <p style={{
              fontSize: '14px',
              color: 'var(--color-text-light)',
              marginBottom: '24px',
            }}>
              点击上方按钮添加你的第一棵植物
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '24px',
            justifyItems: 'center',
          }}>
            {plants.map((plant, index) => (
              <div
                key={plant.id}
                style={{
                  animation: `slide-up 0.4s ease-out ${index * 0.05}s both`,
                }}
              >
                <PlantCard plant={plant} />
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <>
          <div
            onClick={() => setShowModal(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              zIndex: 1000,
              animation: 'fade-in 0.2s ease-out',
            }}
          />
          <div
            className="animate-scale-in"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'var(--color-card)',
              borderRadius: 'var(--radius-md)',
              padding: '32px',
              width: '90%',
              maxWidth: '500px',
              maxHeight: '90vh',
              overflowY: 'auto',
              zIndex: 1001,
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <h2 style={{
              fontSize: '24px',
              fontWeight: 600,
              color: 'var(--color-text)',
              marginBottom: '24px',
            }}>
              添加新植物
            </h2>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}>
                  植物名称 *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="给你的植物起个名字"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #E0E0E0',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '14px',
                    transition: 'border-color var(--transition-fast)',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'var(--color-primary)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#E0E0E0';
                  }}
                />
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}>
                  植物种类
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                  {(Object.keys(categoryConfig) as PlantCategory[]).map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, category: cat }))}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '12px 8px',
                        border: '2px solid',
                        borderColor: formData.category === cat ? categoryConfig[cat].color : 'transparent',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: formData.category === cat ? categoryConfig[cat].color + '20' : '#F5F5F5',
                        cursor: 'pointer',
                        transition: 'all var(--transition-fast)',
                        color: formData.category === cat ? categoryConfig[cat].color : 'var(--color-text)',
                      }}
                    >
                      <span style={{ color: categoryConfig[cat].color }}>
                        {categoryIcons[cat]}
                      </span>
                      <span style={{ fontSize: '12px' }}>
                        {categoryConfig[cat].label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}>
                  购买日期
                </label>
                <input
                  type="date"
                  value={formData.purchaseDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, purchaseDate: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #E0E0E0',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}>
                  养护难度
                </label>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {[1, 2, 3].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, difficulty: d as Difficulty }))}
                      style={{
                        flex: 1,
                        padding: '12px',
                        border: '2px solid',
                        borderColor: formData.difficulty === d ? 'var(--color-secondary)' : 'transparent',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: formData.difficulty === d ? '#FFF3E0' : '#F5F5F5',
                        cursor: 'pointer',
                        fontSize: '16px',
                        transition: 'all var(--transition-fast)',
                      }}
                    >
                      {difficultyStars[d as Difficulty]}
                    </button>
                  ))}
                </div>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-around',
                  fontSize: '12px',
                  color: 'var(--color-text-light)',
                  marginTop: '4px',
                }}>
                  <span>简单</span>
                  <span>中等</span>
                  <span>困难</span>
                </div>
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}>
                  下次浇水提醒 (可选)
                </label>
                <input
                  type="date"
                  value={formData.nextWateringDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, nextWateringDate: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #E0E0E0',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  marginBottom: '8px',
                }}>
                  下次施肥提醒 (可选)
                </label>
                <input
                  type="date"
                  value={formData.nextFertilizingDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, nextFertilizingDate: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #E0E0E0',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '12px 24px',
                    border: '1px solid #CCC',
                    borderRadius: 'var(--radius-lg)',
                    backgroundColor: 'white',
                    cursor: 'pointer',
                    fontSize: '14px',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!formData.name.trim()}
                  style={{
                    padding: '12px 24px',
                    border: 'none',
                    borderRadius: 'var(--radius-lg)',
                    backgroundColor: formData.name.trim() ? 'var(--color-primary)' : '#CCC',
                    color: 'white',
                    cursor: formData.name.trim() ? 'pointer' : 'not-allowed',
                    fontSize: '14px',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  添加
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
};

export default HomePage;
