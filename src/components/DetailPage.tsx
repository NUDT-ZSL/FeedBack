import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Droplets, Leaf, Scissors, RefreshCw, MoreHorizontal, Plus } from 'lucide-react';
import type { Plant, CareRecord, CareType } from '../types';
import { categoryConfig, difficultyStars, careTypeConfig } from '../types';
import { formatDate, getDaysSince } from '../utils';
import HealthGauge from './HealthGauge';

interface DetailPageProps {
  fetchPlantById: (id: string) => Promise<Plant | null>;
  fetchRecords: (plantId: string) => Promise<CareRecord[]>;
  addRecord: (plantId: string, data: { type: CareType; note?: string }) => Promise<{ record: CareRecord; healthScore: number } | null>;
}

const careTypeIcons: Record<CareType, React.ReactNode> = {
  water: <Droplets size={16} />,
  fertilize: <Leaf size={16} />,
  prune: <Scissors size={16} />,
  repot: <RefreshCw size={16} />,
  other: <MoreHorizontal size={16} />,
};

const DetailPage: React.FC<DetailPageProps> = ({ fetchPlantById, fetchRecords, addRecord }) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [plant, setPlant] = useState<Plant | null>(null);
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newType, setNewType] = useState<CareType>('water');
  const [newNote, setNewNote] = useState('');
  const [newRecordId, setNewRecordId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [plantData, recordsData] = await Promise.all([
      fetchPlantById(id),
      fetchRecords(id),
    ]);
    setPlant(plantData);
    setRecords(recordsData);
    setLoading(false);
  }, [id, fetchPlantById, fetchRecords]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;

    const result = await addRecord(id, {
      type: newType,
      note: newNote.trim() || undefined,
    });

    if (result) {
      setRecords(prev => [result.record, ...prev]);
      setNewRecordId(result.record.id);
      setPlant(prev => prev ? { ...prev, healthScore: result.healthScore } : null);
      setNewNote('');
      setShowForm(false);

      setTimeout(() => setNewRecordId(null), 300);
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ fontSize: '16px', color: 'var(--color-text-light)' }}>加载中...</div>
      </div>
    );
  }

  if (!plant) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ fontSize: '16px', color: 'var(--color-text-light)' }}>植物不存在</div>
      </div>
    );
  }

  const config = categoryConfig[plant.category];
  const daysOwned = getDaysSince(plant.purchaseDate);

  return (
    <div
      className="animate-scale-in"
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--color-background)',
        padding: '24px',
        maxWidth: '800px',
        margin: '0 auto',
      }}
    >
      <button
        onClick={() => navigate(-1)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          border: 'none',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--color-primary)',
          color: 'white',
          cursor: 'pointer',
          fontSize: '14px',
          marginBottom: '24px',
          transition: 'all var(--transition-fast)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = '#45a049';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--color-primary)';
        }}
      >
        <ArrowLeft size={18} />
        返回
      </button>

      <div style={{
        backgroundColor: 'var(--color-card)',
        borderRadius: 'var(--radius-md)',
        padding: '32px',
        boxShadow: 'var(--shadow-sm)',
        marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '24px' }}>
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: config.color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '40px',
            }}
          >
            {config.icon}
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{
              fontSize: '28px',
              fontWeight: 700,
              color: 'var(--color-text)',
              marginBottom: '8px',
            }}>
              {plant.name}
            </h1>
            <div style={{
              display: 'flex',
              gap: '16px',
              alignItems: 'center',
              color: 'var(--color-text-light)',
              fontSize: '14px',
            }}>
              <span>{config.label}</span>
              <span>养护 {daysOwned} 天</span>
              <span>{difficultyStars[plant.difficulty]}</span>
            </div>
          </div>
        </div>

        {plant.healthScore !== undefined && (
          <HealthGauge score={plant.healthScore} />
        )}

        {(plant.nextWateringDate || plant.nextFertilizingDate) && (
          <div style={{
            display: 'flex',
            gap: '16px',
            justifyContent: 'center',
            marginTop: '24px',
            flexWrap: 'wrap',
          }}>
            {plant.nextWateringDate && (
              <div style={{
                padding: '8px 16px',
                backgroundColor: '#E3F2FD',
                borderRadius: 'var(--radius-lg)',
                fontSize: '14px',
                color: '#1976D2',
              }}>
                下次浇水: {formatDate(plant.nextWateringDate)}
              </div>
            )}
            {plant.nextFertilizingDate && (
              <div style={{
                padding: '8px 16px',
                backgroundColor: '#FFF3E0',
                borderRadius: 'var(--radius-lg)',
                fontSize: '14px',
                color: '#F57C00',
              }}>
                下次施肥: {formatDate(plant.nextFertilizingDate)}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{
        backgroundColor: 'var(--color-card)',
        borderRadius: 'var(--radius-md)',
        padding: '24px',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: 600,
            color: 'var(--color-text)',
          }}>
            养护记录
          </h2>
          <button
            onClick={() => setShowForm(!showForm)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'var(--color-secondary)',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#F57C00';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--color-secondary)';
            }}
          >
            <Plus size={16} />
            添加记录
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleAddRecord} style={{
            backgroundColor: '#F5F5F5',
            borderRadius: 'var(--radius-md)',
            padding: '16px',
            marginBottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            animation: 'slide-down 0.3s ease-out',
          }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                color: 'var(--color-text)',
                marginBottom: '8px',
              }}>
                操作类型
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(Object.keys(careTypeConfig) as CareType[]).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setNewType(type)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '8px 12px',
                      border: '2px solid',
                      borderColor: newType === type ? careTypeConfig[type].color : 'transparent',
                      borderRadius: 'var(--radius-lg)',
                      backgroundColor: newType === type ? careTypeConfig[type].color + '20' : 'white',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: 'var(--color-text)',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    {careTypeIcons[type]}
                    {careTypeConfig[type].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                color: 'var(--color-text)',
                marginBottom: '8px',
              }}>
                备注 (最多150字)
              </label>
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value.slice(0, 150))}
                placeholder="记录养护详情..."
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #E0E0E0',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '14px',
                  resize: 'vertical',
                  minHeight: '80px',
                  fontFamily: 'inherit',
                }}
              />
              <div style={{
                fontSize: '12px',
                color: 'var(--color-text-light)',
                textAlign: 'right',
                marginTop: '4px',
              }}>
                {newNote.length}/150
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                style={{
                  padding: '10px 20px',
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
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: 'var(--radius-lg)',
                  backgroundColor: 'var(--color-primary)',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all var(--transition-fast)',
                }}
              >
                保存
              </button>
            </div>
          </form>
        )}

        <div style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute',
            left: '11px',
            top: '0',
            bottom: '0',
            width: '2px',
            backgroundColor: '#E0E0E0',
          }} />

          {records.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '40px',
              color: 'var(--color-text-light)',
            }}>
              暂无养护记录，点击上方按钮添加第一条记录
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {records.map((record, index) => {
                const typeConfig = careTypeConfig[record.type];
                const isNew = record.id === newRecordId;
                return (
                  <div
                    key={record.id}
                    className={isNew ? 'animate-slide-up' : ''}
                    style={{
                      display: 'flex',
                      gap: '16px',
                      position: 'relative',
                      animationDelay: `${index * 0.05}s`,
                    }}
                  >
                    <div
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: typeConfig.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        flexShrink: 0,
                        zIndex: 1,
                      }}
                    >
                      {careTypeIcons[record.type]}
                    </div>
                    <div style={{
                      flex: 1,
                      backgroundColor: '#FAFAFA',
                      borderRadius: 'var(--radius-md)',
                      padding: '12px 16px',
                    }}>
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '4px',
                      }}>
                        <span style={{
                          fontWeight: 600,
                          color: typeConfig.color,
                          fontSize: '14px',
                        }}>
                          {typeConfig.label}
                        </span>
                        <span style={{
                          fontSize: '12px',
                          color: 'var(--color-text-light)',
                        }}>
                          {formatDate(record.date)}
                        </span>
                      </div>
                      {record.note && (
                        <p style={{
                          fontSize: '14px',
                          color: 'var(--color-text)',
                          lineHeight: 1.5,
                        }}>
                          {record.note}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DetailPage;
