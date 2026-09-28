import { useState, useEffect, useRef } from 'react';
import { Chart, ArcElement, Tooltip, Legend, PieController } from 'chart.js';
import TripPlanner from './TripPlanner';
import BudgetDashboard from './BudgetDashboard';
import type { Trip, TripReport, ExpenseCategory } from '../types';

Chart.register(ArcElement, Tooltip, Legend, PieController);

const categoryColors: Record<ExpenseCategory, string> = {
  transport: '#1E88E5',
  accommodation: '#9C27B0',
  food: '#FF9800',
  ticket: '#4CAF50',
  other: '#607D8B'
};

type TabType = 'trips' | 'planner' | 'report';

const categoryLabels: Record<ExpenseCategory, string> = {
  transport: '交通',
  accommodation: '住宿',
  food: '餐饮',
  ticket: '门票',
  other: '其他'
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function getDayOfWeek(dateStr: string): string {
  const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return days[new Date(dateStr).getDay()];
}

export default function App() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [currentTrip, setCurrentTrip] = useState<Trip | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('trips');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [report, setReport] = useState<TripReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportEmpty, setReportEmpty] = useState(false);
  const reportCacheRef = useRef<Map<string, TripReport>>(new Map());
  const reportChartRef = useRef<HTMLCanvasElement | null>(null);
  const reportChartInstance = useRef<Chart | null>(null);

  const [createForm, setCreateForm] = useState({
    destination: '',
    startDate: '',
    endDate: '',
    totalBudget: 5000
  });

  useEffect(() => {
    loadTrips();
  }, []);

  useEffect(() => {
    if (activeTab === 'report' && currentTrip) {
      generateReport();
    }
  }, [activeTab, currentTrip]);

  async function loadTrips() {
    try {
      const res = await fetch('/api/trips');
      if (res.ok) {
        const data = await res.json();
        setTrips(data);
      }
    } catch (err) {
      console.error('加载旅行列表失败', err);
    }
  }

  async function createTrip() {
    if (!createForm.destination || !createForm.startDate || !createForm.endDate) {
      alert('请填写完整信息');
      return;
    }

    if (new Date(createForm.endDate) < new Date(createForm.startDate)) {
      alert('结束日期不能早于开始日期');
      return;
    }

    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm)
      });

      if (res.ok) {
        const newTrip = await res.json();
        setTrips(prev => [...prev, newTrip]);
        setCurrentTrip(newTrip);
        setShowCreateModal(false);
        setActiveTab('planner');
        setCreateForm({ destination: '', startDate: '', endDate: '', totalBudget: 5000 });
      }
    } catch (err) {
      console.error('创建旅行失败', err);
    }
  }

  async function updateTrip(updatedTrip: Trip) {
    try {
      const res = await fetch(`/api/trips/${updatedTrip.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedTrip)
      });

      if (res.ok) {
        const data = await res.json();
        setCurrentTrip(data);
        setTrips(prev => prev.map(t => t.id === data.id ? data : t));
      }
    } catch (err) {
      console.error('更新旅行失败', err);
    }
  }

  async function selectTrip(trip: Trip) {
    setCurrentTrip(trip);
    setActiveTab('planner');
  }

  async function generateReport(forceRefresh: boolean = false) {
    if (!currentTrip) return;

    setReportError(null);
    setReportEmpty(false);
    setIsLoading(true);

    try {
      if (!forceRefresh && reportCacheRef.current.has(currentTrip.id)) {
        const cachedData = reportCacheRef.current.get(currentTrip.id)!;
        setReport(cachedData);
        const allCategoryZero = Object.values(cachedData.categoryBreakdown).every(v => v === 0);
        setReportEmpty(cachedData.totalSpent === 0 && allCategoryZero);
        setIsLoading(false);
        return;
      }

      const res = await fetch(`/api/trips/${currentTrip.id}/report`);
      if (!res.ok) {
        throw new Error(`请求失败: ${res.status} ${res.statusText}`);
      }
      const data: TripReport = await res.json();
      setReport(data);
      reportCacheRef.current.set(currentTrip.id, data);

      const allCategoryZero = Object.values(data.categoryBreakdown).every(v => v === 0);
      setReportEmpty(data.totalSpent === 0 && allCategoryZero);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '生成报告失败，请稍后重试';
      setReportError(errorMsg);
      setReport(null);
      console.error('生成报告失败', err);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!report || !reportChartRef.current || activeTab !== 'report') return;

    const ctx = reportChartRef.current.getContext('2d');
    if (!ctx) return;

    const labels = Object.entries(report.categoryBreakdown)
      .filter(([, value]) => value > 0)
      .map(([key]) => categoryLabels[key as ExpenseCategory]);

    const data = Object.entries(report.categoryBreakdown)
      .filter(([, value]) => value > 0)
      .map(([key]) => report.categoryBreakdown[key as ExpenseCategory]);

    const colors = Object.entries(report.categoryBreakdown)
      .filter(([, value]) => value > 0)
      .map(([key]) => categoryColors[key as ExpenseCategory]);

    if (reportChartInstance.current) {
      reportChartInstance.current.data.labels = labels;
      reportChartInstance.current.data.datasets[0].data = data;
      reportChartInstance.current.data.datasets[0].backgroundColor = colors;
      reportChartInstance.current.update();
    } else {
      reportChartInstance.current = new Chart(ctx, {
        type: 'pie',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: '#fff'
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                padding: 15,
                usePointStyle: true,
                font: { size: 12 }
              }
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                  const value = context.raw as number;
                  const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                  return `${context.label}: ¥${value.toLocaleString()} (${percentage}%)`;
                }
              }
            }
          }
        }
      });
    }

    return () => {
      if (reportChartInstance.current) {
        reportChartInstance.current.destroy();
        reportChartInstance.current = null;
      }
    };
  }, [report, activeTab]);

  function printReport() {
    window.print();
  }

  function copyReport() {
    if (!report) return;

    let text = `旅行报告 - ${report.trip.destination}\n`;
    text += `${'='.repeat(40)}\n\n`;
    text += `日期: ${formatDate(report.trip.startDate)} 至 ${formatDate(report.trip.endDate)}\n`;
    text += `总预算: ¥${report.trip.totalBudget.toLocaleString()}\n`;
    text += `总花费: ¥${report.totalSpent.toLocaleString()}\n`;
    text += `剩余: ¥${(report.trip.totalBudget - report.totalSpent).toLocaleString()}\n\n`;

    text += `花费分类:\n`;
    Object.entries(report.categoryBreakdown).forEach(([key, value]) => {
      if (value > 0) {
        text += `  ${categoryLabels[key as ExpenseCategory]}: ¥${value.toLocaleString()}\n`;
      }
    });
    text += '\n';

    text += `行程明细:\n`;
    text += `${'-'.repeat(40)}\n`;

    report.trip.days.forEach((day, index) => {
      text += `\n第 ${index + 1} 天 (${day.date} ${getDayOfWeek(day.date)}):\n`;
      if (day.activities.length === 0) {
        text += `  (无安排)\n`;
      } else {
        day.activities.forEach(act => {
          text += `  ${act.time} - ${act.location}\n`;
          if (act.description) {
            text += `    ${act.description}\n`;
          }
          text += `    花费: ¥${act.cost.toLocaleString()}\n`;
        });
      }
    });

    navigator.clipboard.writeText(text).then(() => {
      alert('报告已复制到剪贴板！');
    }).catch(() => {
      alert('复制失败，请手动复制');
    });
  }

  function deleteTrip(tripId: string) {
    if (!confirm('确定要删除这个旅行计划吗？')) return;
    // 这里可以添加 DELETE API 调用
    setTrips(prev => prev.filter(t => t.id !== tripId));
    if (currentTrip?.id === tripId) {
      setCurrentTrip(null);
      setActiveTab('trips');
    }
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>✈️ 旅行规划助手</h1>
        <p>轻松规划你的完美旅程</p>
      </header>

      <nav className="nav-tabs">
        <button
          className={`nav-tab ${activeTab === 'trips' ? 'active' : ''}`}
          onClick={() => setActiveTab('trips')}
        >
          📋 我的旅行
        </button>
        <button
          className={`nav-tab ${activeTab === 'planner' ? 'active' : ''}`}
          onClick={() => currentTrip && setActiveTab('planner')}
          disabled={!currentTrip}
          style={{ opacity: currentTrip ? 1 : 0.5, cursor: currentTrip ? 'pointer' : 'not-allowed' }}
        >
          🗺️ 行程规划
        </button>
        <button
          className={`nav-tab ${activeTab === 'report' ? 'active' : ''}`}
          onClick={() => currentTrip && setActiveTab('report')}
          disabled={!currentTrip}
          style={{ opacity: currentTrip ? 1 : 0.5, cursor: currentTrip ? 'pointer' : 'not-allowed' }}
        >
          📊 旅行报告
        </button>
      </nav>

      {activeTab === 'trips' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '20px', color: '#333' }}>我的旅行计划</h2>
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              + 创建新旅行
            </button>
          </div>

          {trips.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🧳</div>
              <p>还没有旅行计划，开始创建你的第一次旅行吧！</p>
            </div>
          ) : (
            <div className="trip-list">
              {trips.map(trip => (
                <div
                  key={trip.id}
                  className="card trip-card"
                  onClick={() => selectTrip(trip)}
                >
                  <h3>{trip.destination}</h3>
                  <p className="trip-dates">
                    {trip.startDate} 至 {trip.endDate}
                  </p>
                  <p className="trip-budget">预算: ¥{trip.totalBudget.toLocaleString()}</p>
                  <p style={{ fontSize: '13px', color: '#999', marginTop: '8px' }}>
                    共 {trip.days.length} 天 · {trip.days.reduce((sum, d) => sum + d.activities.length, 0)} 个行程
                  </p>
                  <button
                    className="btn btn-sm btn-danger"
                    style={{ marginTop: '10px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteTrip(trip.id);
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'planner' && currentTrip && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '20px', color: '#333' }}>
              {currentTrip.destination} - 行程规划
            </h2>
          </div>

          <BudgetDashboard trip={currentTrip} />
          <TripPlanner trip={currentTrip} onUpdate={updateTrip} />
        </div>
      )}

      {activeTab === 'report' && isLoading && (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>📊</div>
          <p style={{ color: '#666', fontSize: '16px' }}>正在加载报告数据...</p>
        </div>
      )}

      {activeTab === 'report' && !isLoading && reportError && (
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>❌</div>
          <p style={{ color: '#ef4444', fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>加载失败</p>
          <p style={{ color: '#666', fontSize: '14px', marginBottom: '24px' }}>{reportError}</p>
          <button className="btn btn-primary" onClick={() => generateReport()}>
            🔄 重试
          </button>
        </div>
      )}

      {activeTab === 'report' && !isLoading && !reportError && report && !reportEmpty && (
        <div className="report-container" id="report-content">
          <div className="report-header">
            <h2>✈️ {report.trip.destination} 旅行报告</h2>
            <p className="report-subtitle">
              {formatDate(report.trip.startDate)} - {formatDate(report.trip.endDate)}
              &nbsp;·&nbsp; 共 {report.trip.days.length} 天
            </p>
            <button
              className="btn btn-secondary"
              style={{ marginTop: '12px', fontSize: '13px', padding: '6px 14px' }}
              onClick={() => generateReport(true)}
            >
              🔄 重新加载
            </button>
          </div>

          <div className="report-summary">
            <div className="summary-item">
              <div className="summary-label">总预算</div>
              <div className="summary-value">¥{report.trip.totalBudget.toLocaleString()}</div>
            </div>
            <div className="summary-item">
              <div className="summary-label">已花费</div>
              <div className="summary-value" style={{ color: report.totalSpent > report.trip.totalBudget ? '#ef4444' : '#f59e0b' }}>
                ¥{report.totalSpent.toLocaleString()}
              </div>
            </div>
            <div className="summary-item">
              <div className="summary-label">剩余</div>
              <div className="summary-value" style={{ color: report.trip.totalBudget - report.totalSpent >= 0 ? '#22c55e' : '#ef4444' }}>
                ¥{(report.trip.totalBudget - report.totalSpent).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="timeline">
            <h3>📅 每日行程</h3>
            {report.trip.days.map((day, dayIndex) => (
              <div key={day.date} className="timeline-day">
                <div className="day-title">
                  第 {dayIndex + 1} 天 · {day.date} {getDayOfWeek(day.date)}
                </div>
                {day.activities.length === 0 ? (
                  <p style={{ color: '#999', fontSize: '14px' }}>暂无安排</p>
                ) : (
                  day.activities.map(act => (
                    <div key={act.id} className="timeline-activity">
                      <div className="activity-time">🕐 {act.time}</div>
                      <div className="activity-name">
                        📍 <strong>{act.location}</strong>
                      </div>
                      {act.description && (
                        <div style={{ fontSize: '13px', color: '#666', margin: '4px 0' }}>
                          {act.description}
                        </div>
                      )}
                      <div className="activity-cost">💰 ¥{act.cost.toLocaleString()}</div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>

          <div className="chart-section">
            <h3>📊 花费分类占比</h3>
            <div className="chart-container">
              <canvas ref={reportChartRef} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginTop: '20px' }}>
              {Object.entries(report.categoryBreakdown).map(([key, value]) => {
                const percentage = report.totalSpent > 0
                  ? ((value / report.totalSpent) * 100).toFixed(1)
                  : '0';
                return (
                  <div key={key} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 14px',
                    background: '#f8f9fa',
                    borderRadius: '8px'
                  }}>
                    <span style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: categoryColors[key as ExpenseCategory]
                    }} />
                    <span style={{ flex: 1, fontWeight: '500' }}>
                      {categoryLabels[key as ExpenseCategory]}
                    </span>
                    <span style={{ width: '80px', textAlign: 'right', color: '#666', fontSize: '13px' }}>
                      {percentage}%
                    </span>
                    <span style={{ width: '100px', textAlign: 'right', fontWeight: '600', color: '#1E88E5' }}>
                      ¥{value.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="report-actions">
            <button className="btn btn-secondary" onClick={copyReport}>
              📋 复制文本
            </button>
            <button className="btn btn-primary" onClick={printReport}>
              🖨️ 打印报告
            </button>
          </div>
        </div>
      )}

      {activeTab === 'report' && !isLoading && !reportError && report && reportEmpty && (
        <div className="report-container" id="report-content">
          <div className="report-header">
            <h2>✈️ {report.trip.destination} 旅行报告</h2>
            <p className="report-subtitle">
              {formatDate(report.trip.startDate)} - {formatDate(report.trip.endDate)}
              &nbsp;·&nbsp; 共 {report.trip.days.length} 天
            </p>
            <button
              className="btn btn-secondary"
              style={{ marginTop: '12px', fontSize: '13px', padding: '6px 14px' }}
              onClick={() => generateReport(true)}
            >
              🔄 重新加载
            </button>
          </div>

          <div className="report-summary">
            <div className="summary-item">
              <div className="summary-label">总预算</div>
              <div className="summary-value">¥{report.trip.totalBudget.toLocaleString()}</div>
            </div>
            <div className="summary-item">
              <div className="summary-label">已花费</div>
              <div className="summary-value" style={{ color: '#f59e0b' }}>
                ¥0
              </div>
            </div>
            <div className="summary-item">
              <div className="summary-label">剩余</div>
              <div className="summary-value" style={{ color: '#22c55e' }}>
                ¥{report.trip.totalBudget.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="timeline">
            <h3>📅 每日行程</h3>
            {report.trip.days.map((day, dayIndex) => (
              <div key={day.date} className="timeline-day">
                <div className="day-title">
                  第 {dayIndex + 1} 天 · {day.date} {getDayOfWeek(day.date)}
                </div>
                {day.activities.length === 0 ? (
                  <p style={{ color: '#999', fontSize: '14px' }}>暂无安排</p>
                ) : (
                  day.activities.map(act => (
                    <div key={act.id} className="timeline-activity">
                      <div className="activity-time">🕐 {act.time}</div>
                      <div className="activity-name">
                        📍 <strong>{act.location}</strong>
                      </div>
                      {act.description && (
                        <div style={{ fontSize: '13px', color: '#666', margin: '4px 0' }}>
                          {act.description}
                        </div>
                      )}
                      <div className="activity-cost">💰 ¥{act.cost.toLocaleString()}</div>
                    </div>
                  ))
                )}
              </div>
            ))}
          </div>

          <div className="chart-section">
            <h3>📊 花费分类占比</h3>
            <div
              className="chart-container"
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                <div style={{ fontSize: '56px', marginBottom: '12px' }}>📊</div>
                <p style={{ color: '#666', fontSize: '15px', fontWeight: '500' }}>
                  暂无花费数据，添加行程后即可生成报告
                </p>
              </div>
              <div
                style={{
                  width: '260px',
                  height: '260px',
                  borderRadius: '50%',
                  background: '#e5e7eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  marginTop: '10px'
                }}
              >
                <div
                  style={{
                    width: '140px',
                    height: '140px',
                    borderRadius: '50%',
                    background: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <span style={{ color: '#9ca3af', fontSize: '14px', fontWeight: '500' }}>
                    暂无数据
                  </span>
                </div>
              </div>
              <canvas ref={reportChartRef} style={{ display: 'none' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginTop: '20px' }}>
              {Object.entries(report.categoryBreakdown).map(([key, value]) => {
                return (
                  <div key={key} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 14px',
                    background: '#f8f9fa',
                    borderRadius: '8px'
                  }}>
                    <span style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: categoryColors[key as ExpenseCategory]
                    }} />
                    <span style={{ flex: 1, fontWeight: '500' }}>
                      {categoryLabels[key as ExpenseCategory]}
                    </span>
                    <span style={{ width: '80px', textAlign: 'right', color: '#9ca3af', fontSize: '13px' }}>
                      0%
                    </span>
                    <span style={{ width: '100px', textAlign: 'right', fontWeight: '600', color: '#9ca3af' }}>
                      ¥0
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="report-actions">
            <button className="btn btn-secondary" onClick={copyReport}>
              📋 复制文本
            </button>
            <button className="btn btn-primary" onClick={printReport}>
              🖨️ 打印报告
            </button>
          </div>
        </div>
      )}

      {activeTab !== 'trips' && !currentTrip && (
        <div className="select-trip-prompt card">
          <p>请先选择或创建一个旅行计划</p>
          <button
            className="btn btn-primary"
            style={{ marginTop: '16px' }}
            onClick={() => setActiveTab('trips')}
          >
            返回旅行列表
          </button>
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>创建新旅行</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>

            <div className="form-group">
              <label>目的地</label>
              <input
                type="text"
                value={createForm.destination}
                onChange={(e) => setCreateForm({ ...createForm, destination: e.target.value })}
                placeholder="例如：东京、北京、巴黎..."
              />
            </div>

            <div className="form-group">
              <label>开始日期</label>
              <input
                type="date"
                value={createForm.startDate}
                onChange={(e) => setCreateForm({ ...createForm, startDate: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>结束日期</label>
              <input
                type="date"
                value={createForm.endDate}
                onChange={(e) => setCreateForm({ ...createForm, endDate: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>总预算 (元)</label>
              <input
                type="number"
                min="0"
                value={createForm.totalBudget}
                onChange={(e) => setCreateForm({ ...createForm, totalBudget: Number(e.target.value) })}
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={createTrip}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
