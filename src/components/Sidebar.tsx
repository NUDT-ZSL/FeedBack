import React, { useState, useMemo } from 'react';
import {
  SurveyPoint,
  TagType,
  TAG_OPTIONS,
  getTagColor,
  getTagLabel,
  formatDate
} from '../utils';

interface SidebarProps {
  points: SurveyPoint[];
  selectedPointId: string | null;
  onSelectPoint: (id: string) => void;
}

type FilterTag = 'all' | TagType;

const Sidebar: React.FC<SidebarProps> = ({ points, selectedPointId, onSelectPoint }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTag, setFilterTag] = useState<FilterTag>('all');

  const filteredPoints = useMemo(() => {
    const start = performance.now();
    let result = points;

    if (filterTag !== 'all') {
      result = result.filter((p) => p.tag === filterTag);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query)
      );
    }

    const duration = performance.now() - start;
    return result;
  }, [points, filterTag, searchQuery]);

  const getTagCounts = useMemo(() => {
    const counts: Record<string, number> = { all: points.length };
    TAG_OPTIONS.forEach((opt) => {
      counts[opt.value] = points.filter((p) => p.tag === opt.value).length;
    });
    return counts;
  }, [points]);

  return (
    <div className="sidebar-container">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <i className="fas fa-list-ul" style={{ marginRight: '8px' }}></i>
          采样点列表 ({filteredPoints.length}/{points.length})
        </div>

        <div className="sidebar-filters">
          <div style={{ position: 'relative' }}>
            <i
              className="fas fa-search"
              style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#999',
                fontSize: '14px',
                pointerEvents: 'none'
              }}
            ></i>
            <input
              type="text"
              className="search-input"
              placeholder="搜索名称或描述..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '40px' }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#999',
                  cursor: 'pointer',
                  padding: '4px',
                  fontSize: '14px',
                  borderRadius: '4px'
                }}
              >
                <i className="fas fa-times"></i>
              </button>
            )}
          </div>

          <div className="tag-filters">
            <button
              className={`tag-filter-btn ${filterTag === 'all' ? 'active' : ''}`}
              onClick={() => setFilterTag('all')}
            >
              <span
                className="tag-color-dot"
                style={{ background: 'linear-gradient(135deg, #6B8E23, #8B4513, #1E90FF, #708090)' }}
              ></span>
              全部 ({getTagCounts.all})
            </button>
            {TAG_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`tag-filter-btn ${filterTag === opt.value ? 'active' : ''}`}
                onClick={() => setFilterTag(opt.value)}
              >
                <span className="tag-color-dot" style={{ background: opt.color }}></span>
                {opt.label} ({getTagCounts[opt.value] || 0})
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sidebar-list">
        {filteredPoints.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              {points.length === 0 ? (
                <i className="fas fa-map-marked-alt"></i>
              ) : (
                <i className="fas fa-search"></i>
              )}
            </div>
            <div className="empty-state-text">
              {points.length === 0 ? (
                <>
                  暂无采样点数据
                  <br />
                  <span style={{ fontSize: '12px' }}>
                    点击地图下方的红色按钮开始采集
                  </span>
                </>
              ) : (
                '没有找到匹配的采样点'
              )}
            </div>
          </div>
        ) : (
          filteredPoints.map((point) => (
            <div
              key={point.id}
              className={`list-item ${selectedPointId === point.id ? 'selected' : ''}`}
              onClick={() => onSelectPoint(point.id)}
            >
              <div className="list-item-header">
                <div className="list-item-name" title={point.name}>
                  <i
                    className="fas fa-map-pin"
                    style={{
                      marginRight: '6px',
                      color: getTagColor(point.tag)
                    }}
                  ></i>
                  {point.name}
                </div>
                <span
                  className="list-item-tag"
                  style={{ background: getTagColor(point.tag) }}
                >
                  {getTagLabel(point.tag)}
                </span>
              </div>
              <div className="list-item-coords">
                <i className="fas fa-crosshairs" style={{ marginRight: '4px' }}></i>
                {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
              </div>
              <div className="list-item-time">
                <i className="far fa-clock" style={{ marginRight: '4px' }}></i>
                {formatDate(point.createdAt)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Sidebar;
