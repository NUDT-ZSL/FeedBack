import React, { useState, useMemo, useCallback } from 'react';
import { FaSearch, FaPlus } from 'react-icons/fa';
import DayCard from './DayCard';
import {
  Trip,
  Attraction,
  PRESET_ATTRACTIONS,
  DaySchedule,
  TripSpot,
  generateId,
  DAY_COLORS,
} from '../types';

interface RouteBuilderProps {
  trip: Trip | null;
  isPreviewMode: boolean;
  onCreateTrip: (name: string, days: number) => void;
  onAddSpot: (attraction: Attraction, dayIndex: number) => void;
  onMoveSpot: (
    fromDay: number, fromOrder: number,
    toDay: number, toOrder: number
  ) => void;
  onEditSpot: (spotId: string, arrivalTime: string, duration: number) => void;
  onDeleteSpot: (spotId: string, dayIndex: number) => void;
}

const RouteBuilder: React.FC<RouteBuilderProps> = ({
  trip,
  isPreviewMode,
  onCreateTrip,
  onAddSpot,
  onMoveSpot,
  onEditSpot,
  onDeleteSpot,
}) => {
  const [tripName, setTripName] = useState('');
  const [tripDays, setTripDays] = useState<number>(3);
  const [searchQuery, setSearchQuery] = useState('');
  const [targetDay, setTargetDay] = useState<number>(0);
  const [showAddDropdown, setShowAddDropdown] = useState<boolean>(false);

  const filteredAttractions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return PRESET_ATTRACTIONS;
    return PRESET_ATTRACTIONS.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const handleCreate = useCallback(() => {
    if (!tripName.trim()) return;
    onCreateTrip(tripName.trim(), tripDays);
    setTripName('');
  }, [tripName, tripDays, onCreateTrip]);

  const handleAddAttraction = useCallback(
    (attraction: Attraction) => {
      onAddSpot(attraction, targetDay);
      setSearchQuery('');
      setShowAddDropdown(false);
    },
    [onAddSpot, targetDay]
  );

  if (!trip) {
    return (
      <div className="create-trip-panel">
        <h2 className="panel-title">创建新行程</h2>
        <div className="form-group">
          <label>行程名称</label>
          <input
            type="text"
            placeholder="例如：华东五日游"
            value={tripName}
            onChange={(e) => setTripName(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>
            行程天数</label>
          <div className="days-selector">
            <input
              type="range"
              min={1}
              max={14}
              value={tripDays}
              onChange={(e) => setTripDays(Number(e.target.value))}
            />
            <span className="days-value">{tripDays} 天</span>
          </div>
        </div>
        <button
          className="create-btn"
          onClick={handleCreate}
          disabled={!tripName.trim()}
        >
          创建行程
        </button>
      </div>
    );
  }

  return (
    <div className="route-builder">
      {!isPreviewMode && (
        <div className="add-spot-panel">
        <div className="add-spot-header">
          <h3>添加景点</h3>
          <div className="target-day-select">
            <label>添加到第</label>
            <select
              value={targetDay}
              onChange={(e) => setTargetDay(Number(e.target.value))}
            >
              {trip.schedules.map((_, idx) => (
                <option key={idx} value={idx}>
                  {idx + 1} 天
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="search-box">
          <FaSearch className="search-icon" />
          <input
            type="text"
            placeholder="搜索景点名称或描述..."
            value={searchQuery}
            onFocus={() => setShowAddDropdown(true)}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowAddDropdown(true);
            }}
          />
        </div>
        {showAddDropdown && (
          <div className="attraction-list">
            {filteredAttractions.length === 0 ? (
              <div className="no-result">未找到匹配的景点</div>
            ) : (
              filteredAttractions.map((a) => (
                <div
                  key={a.id}
                  className="attraction-item"
                  onClick={() => handleAddAttraction(a)}
                >
                  <div className="attraction-info">
                    <div
                      className="attraction-dot"
                      style={{
                        backgroundColor: DAY_COLORS[targetDay % DAY_COLORS.length],
                      }}
                    />
                    <div>
                      <div className="attraction-name">{a.name}</div>
                      <div className="attraction-desc">{a.description}</div>
                    </div>
                  </div>
                  <button className="add-btn">
                    <FaPlus />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    )}

    <div className="schedules-masonry">
      {trip.schedules.map((schedule: DaySchedule) => (
        <DayCard
          key={`day-${schedule.dayIndex}`}
          dayIndex={schedule.dayIndex}
          spots={schedule.spots.map((s: TripSpot) => s)}
          isPreviewMode={isPreviewMode}
          onMoveSpot={onMoveSpot}
          onEditSpot={onEditSpot}
          onDeleteSpot={onDeleteSpot}
        />
      ))}
    </div>
  </div>
  );
};

export default React.memo(RouteBuilder);
