import React, { useReducer, useEffect, useCallback, useMemo, useState } from 'react';
import {
  AppState,
  AppAction,
  CoffeeBean,
  BrewRecord,
  FlavorProfile,
  PageType,
  ProcessMethod,
  RoastLevel,
  generateMockData,
  calculateAverageScore,
  getScoreColor,
  FLAVOR_DIMENSIONS,
} from './types';
import BeanCard from './components/BeanCard';
import FlavorRadar from './components/FlavorRadar';
import BrewForm from './components/BrewForm';

const initialState: AppState = {
  beans: [],
  records: [],
  currentPage: 'library',
  selectedBeanId: null,
};

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_PAGE':
      return { ...state, currentPage: action.payload };
    case 'SELECT_BEAN':
      return { ...state, selectedBeanId: action.payload };
    case 'ADD_BEAN':
      return { ...state, beans: [...state.beans, action.payload] };
    case 'ADD_RECORD':
      return { ...state, records: [...state.records, action.payload] };
    case 'LOAD_DATA':
      return { ...state, beans: action.payload.beans, records: action.payload.records };
    default:
      return state;
  }
};

const App: React.FC = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [showAddBean, setShowAddBean] = useState(false);
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [showBeanDetail, setShowBeanDetail] = useState(false);
  const [selectedDimension, setSelectedDimension] = useState<keyof FlavorProfile | null>(null);
  const [newBean, setNewBean] = useState({
    name: '',
    origin: '',
    processMethod: '日晒' as ProcessMethod,
    roastLevel: '中' as RoastLevel,
  });

  useEffect(() => {
    const mockData = generateMockData();
    dispatch({ type: 'LOAD_DATA', payload: mockData });
  }, []);

  const handleAddBean = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const bean: CoffeeBean = {
      id: Math.random().toString(36).substring(2, 11),
      ...newBean,
      createdAt: Date.now(),
    };
    dispatch({ type: 'ADD_BEAN', payload: bean });
    setShowAddBean(false);
    setNewBean({ name: '', origin: '', processMethod: '日晒', roastLevel: '中' });
  }, [newBean]);

  const handleAddRecord = useCallback((record: BrewRecord) => {
    dispatch({ type: 'ADD_RECORD', payload: record });
    setShowAddRecord(false);
  }, []);

  const averageFlavor = useMemo((): FlavorProfile => {
    if (state.records.length === 0) {
      return { acidity: 0, sweetness: 0, bitterness: 0, body: 0, aftertaste: 0, cleanliness: 0 };
    }
    const sum: FlavorProfile = { acidity: 0, sweetness: 0, bitterness: 0, body: 0, aftertaste: 0, cleanliness: 0 };
    state.records.forEach((record) => {
      Object.keys(record.flavor).forEach((key) => {
        sum[key as keyof FlavorProfile] += record.flavor[key as keyof FlavorProfile];
      });
    });
    Object.keys(sum).forEach((key) => {
      sum[key as keyof FlavorProfile] = Number((sum[key as keyof FlavorProfile] / state.records.length).toFixed(1));
    });
    return sum;
  }, [state.records]);

  const bestRecord = useMemo((): BrewRecord | null => {
    if (state.records.length === 0) return null;
    return [...state.records].sort((a, b) => calculateAverageScore(b.flavor) - calculateAverageScore(a.flavor))[0];
  }, [state.records]);

  const topRecordsForDimension = useMemo((): BrewRecord[] => {
    if (!selectedDimension) return [];
    return [...state.records]
      .sort((a, b) => b.flavor[selectedDimension] - a.flavor[selectedDimension])
      .slice(0, 3);
  }, [state.records, selectedDimension]);

  const sortedRecords = useMemo(() => {
    return [...state.records].sort((a, b) => b.createdAt - a.createdAt);
  }, [state.records]);

  const getBeanById = useCallback((id: string): CoffeeBean | undefined => {
    return state.beans.find((b) => b.id === id);
  }, [state.beans]);

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  const NavButton: React.FC<{ page: PageType; label: string }> = ({ page, label }) => (
    <button
      onClick={() => dispatch({ type: 'SET_PAGE', payload: page })}
      className="nav-tab"
      style={{
        padding: '10px 20px',
        border: 'none',
        borderRadius: '8px',
        backgroundColor: state.currentPage === page ? '#6F4E37' : 'transparent',
        color: state.currentPage === page ? 'white' : '#6F4E37',
        fontSize: '14px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.95)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {label}
    </button>
  );

  const renderBeanLibrary = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ color: '#6F4E37', fontSize: '24px' }}>我的豆库</h2>
        <button
          onClick={() => setShowAddBean(true)}
          style={{
            padding: '10px 20px',
            backgroundColor: '#6F4E37',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'transform 0.2s ease',
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.95)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          + 添加咖啡豆
        </button>
      </div>

      {showAddBean && (
        <form onSubmit={handleAddBean} style={{
          backgroundColor: 'white',
          padding: '24px',
          borderRadius: '12px',
          marginBottom: '24px',
          border: '1px solid #D2B48C',
        }}>
          <h3 style={{ marginTop: 0, color: '#6F4E37', marginBottom: '16px' }}>添加新咖啡豆</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <input
              type="text"
              placeholder="豆子名称"
              value={newBean.name}
              onChange={(e) => setNewBean({ ...newBean, name: e.target.value })}
              required
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #D2B48C',
                fontSize: '14px',
              }}
            />
            <input
              type="text"
              placeholder="产地"
              value={newBean.origin}
              onChange={(e) => setNewBean({ ...newBean, origin: e.target.value })}
              required
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #D2B48C',
                fontSize: '14px',
              }}
            />
            <select
              value={newBean.processMethod}
              onChange={(e) => setNewBean({ ...newBean, processMethod: e.target.value as ProcessMethod })}
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #D2B48C',
                fontSize: '14px',
                backgroundColor: 'white',
              }}
            >
              <option value="日晒">日晒</option>
              <option value="水洗">水洗</option>
              <option value="蜜处理">蜜处理</option>
              <option value="厌氧">厌氧</option>
            </select>
            <select
              value={newBean.roastLevel}
              onChange={(e) => setNewBean({ ...newBean, roastLevel: e.target.value as RoastLevel })}
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #D2B48C',
                fontSize: '14px',
                backgroundColor: 'white',
              }}
            >
              <option value="浅">浅焙</option>
              <option value="中浅">中浅焙</option>
              <option value="中">中焙</option>
              <option value="中深">中深焙</option>
              <option value="深">深焙</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            <button
              type="submit"
              style={{
                padding: '10px 24px',
                backgroundColor: '#6F4E37',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'transform 0.2s ease',
              }}
            >
              添加
            </button>
            <button
              type="button"
              onClick={() => setShowAddBean(false)}
              style={{
                padding: '10px 24px',
                backgroundColor: 'transparent',
                color: '#6F4E37',
                border: '1px solid #D2B48C',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'transform 0.2s ease',
              }}
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div
        className="bean-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '20px',
        }}
      >
        {state.beans.map((bean) => (
          <BeanCard
            key={bean.id}
            bean={bean}
            onClick={() => {
              dispatch({ type: 'SELECT_BEAN', payload: bean.id });
              setShowBeanDetail(true);
            }}
          />
        ))}
      </div>

      {showBeanDetail && state.selectedBeanId && (
        <BeanDetailModal
          bean={getBeanById(state.selectedBeanId)!}
          records={state.records.filter((r) => r.beanId === state.selectedBeanId)}
          onClose={() => {
            setShowBeanDetail(false);
            dispatch({ type: 'SELECT_BEAN', payload: null });
          }}
          onAddRecord={() => {
            setShowBeanDetail(false);
            setShowAddRecord(true);
          }}
          formatDate={formatDate}
        />
      )}
    </div>
  );

  const renderRecords = () => (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ color: '#6F4E37', fontSize: '24px' }}>冲煮记录</h2>
        {state.beans.length > 0 && !showAddRecord && (
          <button
            onClick={() => setShowAddRecord(true)}
            style={{
              padding: '10px 20px',
              backgroundColor: '#6F4E37',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'transform 0.2s ease',
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.95)';
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            + 添加记录
          </button>
        )}
      </div>

      {showAddRecord && state.selectedBeanId && (
        <BrewForm
          beanId={state.selectedBeanId}
          onSubmit={handleAddRecord}
          onCancel={() => {
            setShowAddRecord(false);
            dispatch({ type: 'SELECT_BEAN', payload: null });
          }}
        />
      )}

      {showAddRecord && !state.selectedBeanId && (
        <div style={{
          backgroundColor: 'white',
          padding: '24px',
          borderRadius: '12px',
          marginBottom: '24px',
          border: '1px solid #D2B48C',
        }}>
          <h3 style={{ color: '#6F4E37', marginBottom: '16px' }}>选择咖啡豆</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            {state.beans.map((bean) => (
              <button
                key={bean.id}
                onClick={() => dispatch({ type: 'SELECT_BEAN', payload: bean.id })}
                style={{
                  padding: '12px',
                  border: '1px solid #D2B48C',
                  borderRadius: '8px',
                  backgroundColor: state.selectedBeanId === bean.id ? '#D2B48C' : 'white',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'transform 0.2s ease',
                }}
              >
                <div style={{ fontWeight: 600, color: '#6F4E37' }}>{bean.name}</div>
                <div style={{ fontSize: '12px', color: '#8D6E63' }}>{bean.origin}</div>
              </button>
            ))}
          </div>
          <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
            <button
              onClick={() => setShowAddRecord(false)}
              style={{
                padding: '10px 24px',
                backgroundColor: 'transparent',
                color: '#6F4E37',
                border: '1px solid #D2B48C',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#D2B48C' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#3E2723', borderRadius: '8px 0 0 0' }}>日期</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#3E2723' }}>咖啡豆</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#3E2723' }}>粉量</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#3E2723' }}>水温</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#3E2723' }}>研磨度</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#3E2723' }}>注水方式</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#3E2723' }}>时长</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', color: '#3E2723', borderRadius: '0 8px 0 0' }}>综合评分</th>
            </tr>
          </thead>
          <tbody>
            {sortedRecords.map((record, index) => {
              const bean = getBeanById(record.beanId);
              const avgScore = calculateAverageScore(record.flavor);
              return (
                <tr
                  key={record.id}
                  style={{
                    backgroundColor: index % 2 === 0 ? 'white' : '#FFFBF5',
                    borderBottom: '1px solid #EFEBE9',
                  }}
                >
                  <td style={{ padding: '12px 16px', position: 'relative' }}>
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: '6px',
                      backgroundColor: getScoreColor(avgScore),
                    }} />
                    <span style={{ marginLeft: '8px' }}>{formatDate(record.createdAt)}</span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#6F4E37' }}>{bean?.name || '-'}</td>
                  <td style={{ padding: '12px 16px', color: '#5D4037' }}>{record.coffeeAmount}g</td>
                  <td style={{ padding: '12px 16px', color: '#5D4037' }}>{record.waterTemp}℃</td>
                  <td style={{ padding: '12px 16px', color: '#5D4037' }}>{record.grindSize}刻度</td>
                  <td style={{ padding: '12px 16px', color: '#5D4037' }}>{record.pourMethod}</td>
                  <td style={{ padding: '12px 16px', color: '#5D4037' }}>{record.totalTime}s</td>
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: getScoreColor(avgScore) }}>
                    {avgScore.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sortedRecords.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#8D6E63' }}>
          <p style={{ fontSize: '16px' }}>暂无冲煮记录</p>
          <p style={{ fontSize: '14px', marginTop: '8px' }}>点击"添加记录"开始记录你的第一杯手冲咖啡吧</p>
        </div>
      )}
    </div>
  );

  const renderRadar = () => (
    <div>
      <h2 style={{ color: '#6F4E37', fontSize: '24px', marginBottom: '24px' }}>风味偏好分析</h2>

      <div style={{
        backgroundColor: 'white',
        padding: '24px',
        borderRadius: '12px',
        border: '1px solid #D2B48C',
        marginBottom: '24px',
      }}>
        <p style={{ textAlign: 'center', color: '#8D6E63', marginBottom: '8px', fontSize: '14px' }}>
          点击各维度顶点查看该维度评分最高的记录
        </p>
        <FlavorRadar
          data={averageFlavor}
          onDimensionClick={(dim) => {
            setSelectedDimension(selectedDimension === dim ? null : dim);
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', marginTop: '16px' }}>
          {FLAVOR_DIMENSIONS.map((dim) => (
            <div key={dim.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: dim.color,
              }} />
              <span style={{ fontSize: '12px', color: '#6F4E37' }}>{dim.label}</span>
            </div>
          ))}
        </div>
      </div>

      {selectedDimension && (
        <div style={{
          backgroundColor: 'white',
          padding: '24px',
          borderRadius: '12px',
          border: '1px solid #D2B48C',
          marginBottom: '24px',
        }}>
          <h3 style={{ color: '#6F4E37', marginTop: 0, marginBottom: '16px' }}>
            {FLAVOR_DIMENSIONS.find((d) => d.key === selectedDimension)?.label}最高的三条记录
          </h3>
          <div style={{ display: 'grid', gap: '12px' }}>
            {topRecordsForDimension.map((record, index) => {
              const bean = getBeanById(record.beanId);
              return (
                <div key={record.id} style={{
                  padding: '16px',
                  backgroundColor: '#FFFBF5',
                  borderRadius: '8px',
                  border: '1px solid #EFEBE9',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 600, color: '#6F4E37' }}>
                      #{index + 1} {bean?.name}
                    </span>
                    <span style={{
                      color: FLAVOR_DIMENSIONS.find((d) => d.key === selectedDimension)?.color,
                      fontWeight: 600,
                    }}>
                      {record.flavor[selectedDimension]}/10
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: '#8D6E63', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '4px' }}>
                    <span>粉量: {record.coffeeAmount}g</span>
                    <span>水温: {record.waterTemp}℃</span>
                    <span>研磨: {record.grindSize}刻度</span>
                    <span>方式: {record.pourMethod}</span>
                    <span>时长: {record.totalTime}s</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bestRecord && (
        <div style={{
          backgroundColor: 'white',
          padding: '24px',
          borderRadius: '12px',
          border: '1px solid #D2B48C',
        }}>
          <h3 style={{ color: '#6F4E37', marginTop: 0, marginBottom: '16px' }}>
            🏆 最佳冲煮方案推荐
          </h3>
          <div style={{
            backgroundColor: '#FFFBF5',
            padding: '20px',
            borderRadius: '8px',
            border: '1px solid #EFEBE9',
          }}>
            <div style={{ marginBottom: '12px' }}>
              <span style={{ fontWeight: 600, color: '#6F4E37', fontSize: '18px' }}>
                {getBeanById(bestRecord.beanId)?.name}
              </span>
              <span style={{
                marginLeft: '12px',
                padding: '4px 10px',
                backgroundColor: getScoreColor(calculateAverageScore(bestRecord.flavor)),
                color: 'white',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 600,
              }}>
                综合评分 {calculateAverageScore(bestRecord.flavor).toFixed(1)}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginTop: '16px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#8D6E63' }}>粉量</div>
                <div style={{ fontWeight: 600, color: '#6F4E37' }}>{bestRecord.coffeeAmount}g</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#8D6E63' }}>水温</div>
                <div style={{ fontWeight: 600, color: '#6F4E37' }}>{bestRecord.waterTemp}℃</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#8D6E63' }}>研磨度</div>
                <div style={{ fontWeight: 600, color: '#6F4E37' }}>{bestRecord.grindSize}刻度</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#8D6E63' }}>注水方式</div>
                <div style={{ fontWeight: 600, color: '#6F4E37' }}>{bestRecord.pourMethod}</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#8D6E63' }}>总时长</div>
                <div style={{ fontWeight: 600, color: '#6F4E37' }}>{bestRecord.totalTime}秒</div>
              </div>
            </div>
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #EFEBE9' }}>
              <div style={{ fontSize: '12px', color: '#8D6E63', marginBottom: '8px' }}>风味评分</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '8px' }}>
                {FLAVOR_DIMENSIONS.map((dim) => (
                  <div key={dim.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: dim.color,
                    }} />
                    <span style={{ fontSize: '12px', color: '#8D6E63' }}>{dim.label}:</span>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: dim.color }}>
                      {bestRecord.flavor[dim.key]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#FFF8F0' }}>
      <nav style={{
        backgroundColor: '#6F4E37',
        padding: '16px 24px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              backgroundColor: '#D2B48C',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
            }}>
              ☕
            </div>
            <h1 style={{ color: 'white', fontSize: '20px', margin: 0, fontWeight: 600 }}>
              手冲咖啡配方管理器
            </h1>
          </div>
          <div className="nav-tabs" style={{ display: 'flex', gap: '12px' }}>
            <NavButton page="library" label="豆库" />
            <NavButton page="records" label="记录" />
            <NavButton page="radar" label="风味分析" />
          </div>
        </div>
      </nav>

      <main style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '32px 24px',
      }}>
        {state.currentPage === 'library' && renderBeanLibrary()}
        {state.currentPage === 'records' && renderRecords()}
        {state.currentPage === 'radar' && renderRadar()}
      </main>
    </div>
  );
};

interface BeanDetailModalProps {
  bean: CoffeeBean;
  records: BrewRecord[];
  onClose: () => void;
  onAddRecord: () => void;
  formatDate: (timestamp: number) => string;
}

const BeanDetailModal: React.FC<BeanDetailModalProps> = ({ bean, records, onClose, onAddRecord, formatDate }) => {
  return (
    <div style={{
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
      padding: '20px',
    }} onClick={onClose}>
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '32px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          animation: 'modalIn 0.3s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <h2 style={{ marginTop: 0, color: '#6F4E37', fontSize: '24px' }}>{bean.name}</h2>
            <p style={{ color: '#8D6E63', margin: '4px 0 0 0' }}>{bean.origin}</p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '24px',
              color: '#8D6E63',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <span style={{
            padding: '6px 12px',
            backgroundColor: '#D2B48C',
            borderRadius: '12px',
            fontSize: '13px',
            color: '#3E2723',
          }}>
            {bean.processMethod}
          </span>
          <span style={{
            padding: '6px 12px',
            backgroundColor: '#D2B48C',
            borderRadius: '12px',
            fontSize: '13px',
            color: '#3E2723',
          }}>
            {bean.roastLevel}焙
          </span>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ color: '#6F4E37', fontSize: '16px', marginBottom: '12px' }}>
            冲煮记录 ({records.length})
          </h3>
          {records.length > 0 ? (
            <div style={{ display: 'grid', gap: '8px' }}>
              {records.map((record) => (
                <div key={record.id} style={{
                  padding: '12px',
                  backgroundColor: '#FFFBF5',
                  borderRadius: '8px',
                  border: '1px solid #EFEBE9',
                  fontSize: '13px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#8D6E63' }}>{formatDate(record.createdAt)}</span>
                    <span style={{ fontWeight: 600, color: getScoreColor(calculateAverageScore(record.flavor)) }}>
                      {calculateAverageScore(record.flavor).toFixed(1)}
                    </span>
                  </div>
                  <div style={{ color: '#6F4E37', marginTop: '4px' }}>
                    {record.coffeeAmount}g · {record.waterTemp}℃ · {record.pourMethod} · {record.totalTime}s
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#8D6E63', fontSize: '14px' }}>暂无冲煮记录</p>
          )}
        </div>

        <button
          onClick={onAddRecord}
          style={{
            width: '100%',
            padding: '12px',
            backgroundColor: '#6F4E37',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'transform 0.2s ease',
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.95)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          + 添加冲煮记录
        </button>
      </div>
    </div>
  );
};

export default App;
