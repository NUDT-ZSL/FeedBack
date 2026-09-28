import { useState, useMemo } from 'react';
import type { WateringRecord, Plant } from '../types';
import { initialWateringRecords, initialPlants } from '../data';
import './Calendar.scss';

export default function Calendar() {
  const [records] = useState<WateringRecord[]>(initialWateringRecords);
  const [plants] = useState<Plant[]>(initialPlants);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedRecords, setSelectedRecords] = useState<WateringRecord[] | null>(null);
  const [selectedPhotos, setSelectedPhotos] = useState<{ photos: string[]; currentIndex: number } | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const { days, weekDays } = useMemo(() => {
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: Array<{ date: Date | null; dayNum: number | null; isToday: boolean; records: WateringRecord[] }> = [];

    for (let i = 0; i < firstDay; i++) {
      days.push({ date: null, dayNum: null, isToday: false, records: [] });
    }

    const today = new Date();
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const dayRecords = records.filter(r => {
        const rd = new Date(r.timestamp);
        return rd.getFullYear() === year && rd.getMonth() === month && rd.getDate() === d;
      });
      const isToday =
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate();
      days.push({ date, dayNum: d, isToday, records: dayRecords });
    }

    return { days, weekDays };
  }, [year, month, records]);

  const handleDayClick = (cell: typeof days[0]) => {
    if (cell.records.length > 0) {
      setSelectedRecords(cell.records);
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'water': return '#2196f3';
      case 'fertilize': return '#9c27b0';
      case 'repot': return '#ff9800';
      default: return '#4caf50';
    }
  };

  const getTypeName = (type: string) => {
    switch (type) {
      case 'water': return '💧 浇水';
      case 'fertilize': return '🌿 施肥';
      case 'repot': return '🪴 换盆';
      default: return type;
    }
  };

  const getPlantName = (id: string) => plants.find(p => p.id === id)?.name || '未知植物';
  const getPlantIcon = (id: string) => plants.find(p => p.id === id)?.icon || '🌱';

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="calendar-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">养护日历</h1>
          <p className="page-subtitle">查看植物的完整养护历史 📅</p>
        </div>
      </div>

      <div className="calendar-card card">
        <div className="calendar-header">
          <button className="nav-btn" onClick={prevMonth}>‹</button>
          <h2 className="calendar-title">{year} 年 {month + 1} 月</h2>
          <button className="nav-btn" onClick={nextMonth}>›</button>
        </div>

        <div className="legend">
          <span className="legend-item"><span className="dot dot-water" /> 浇水</span>
          <span className="legend-item"><span className="dot dot-fertilize" /> 施肥</span>
          <span className="legend-item"><span className="dot dot-repot" /> 换盆</span>
        </div>

        <div className="week-row">
          {weekDays.map(w => (
            <div key={w} className="week-cell">{w}</div>
          ))}
        </div>

        <div className="days-grid">
          {days.map((cell, idx) => (
            <div
              key={idx}
              className={`day-cell ${cell.isToday ? 'today' : ''} ${cell.records.length > 0 ? 'has-events' : ''} ${!cell.dayNum ? 'empty' : ''}`}
              onClick={() => cell.dayNum && handleDayClick(cell)}
            >
              {cell.dayNum && (
                <>
                  <span className="day-num">{cell.dayNum}</span>
                  <div className="event-dots">
                    {cell.records.slice(0, 3).map(r => (
                      <span
                        key={r.id}
                        className="event-dot"
                        style={{ background: getTypeColor(r.type) }}
                      />
                    ))}
                    {cell.records.length > 3 && (
                      <span className="event-more">+{cell.records.length - 3}</span>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {selectedRecords && (
        <div className="modal-overlay" onClick={() => { setSelectedRecords(null); setSelectedPhotos(null); }}>
          <div className="detail-popup" onClick={e => e.stopPropagation()}>
            <div className="popup-header">
              <h3 className="popup-title">
                📋 养护详情 · {selectedRecords.length} 条记录
              </h3>
              <button className="close-btn" onClick={() => { setSelectedRecords(null); setSelectedPhotos(null); }}>✕</button>
            </div>
            <div className="popup-content">
              {selectedRecords.map(record => (
                <div key={record.id} className="record-item">
                  <div className="record-header">
                    <span
                      className="record-type"
                      style={{ background: getTypeColor(record.type) + '20', color: getTypeColor(record.type) }}
                    >
                      {getTypeName(record.type)}
                    </span>
                    <span className="record-time">{formatTime(record.timestamp)}</span>
                  </div>
                  <div className="record-meta">
                    <span className="record-plant">{getPlantIcon(record.plantId)} {getPlantName(record.plantId)}</span>
                    <span className="record-operator">操作人：{record.operatorName}</span>
                  </div>
                  {record.note && <div className="record-note">📝 {record.note}</div>}
                  {record.photos.length > 0 && (
                    <div className="record-photos">
                      {record.photos.map((photo, pi) => (
                        <img
                          key={pi}
                          src={photo}
                          alt=""
                          className="record-photo"
                          onClick={() => setSelectedPhotos({ photos: record.photos, currentIndex: pi })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedPhotos && (
        <div className="photo-carousel" onClick={() => setSelectedPhotos(null)}>
          <button
            className="carousel-nav carousel-prev"
            onClick={e => {
              e.stopPropagation();
              setSelectedPhotos({
                ...selectedPhotos,
                currentIndex: (selectedPhotos.currentIndex - 1 + selectedPhotos.photos.length) % selectedPhotos.photos.length,
              });
            }}
          >
            ‹
          </button>
          <img
            src={selectedPhotos.photos[selectedPhotos.currentIndex]}
            alt=""
            className="carousel-img"
            onClick={e => e.stopPropagation()}
          />
          <button
            className="carousel-nav carousel-next"
            onClick={e => {
              e.stopPropagation();
              setSelectedPhotos({
                ...selectedPhotos,
                currentIndex: (selectedPhotos.currentIndex + 1) % selectedPhotos.photos.length,
              });
            }}
          >
            ›
          </button>
          <div className="carousel-indicators">
            {selectedPhotos.photos.map((_, i) => (
              <span
                key={i}
                className={`carousel-dot ${i === selectedPhotos.currentIndex ? 'active' : ''}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
