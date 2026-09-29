import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FaPencilAlt, FaTrash } from 'react-icons/fa';
import {
  TripSpot,
  DAY_COLORS,
  TIME_OPTIONS,
  DURATION_OPTIONS,
} from '../types';

interface DayCardProps {
  dayIndex: number;
  spots: TripSpot[];
  isPreviewMode: boolean;
  onMoveSpot: (
    fromDay: number,
    fromOrder: number,
    toDay: number,
    toOrder: number
  ) => void;
  onEditSpot: (spotId: string, arrivalTime: string, duration: number) => void;
  onDeleteSpot: (spotId: string, dayIndex: number) => void;
}

const DayCard: React.FC<DayCardProps> = ({
  dayIndex,
  spots,
  isPreviewMode,
  onMoveSpot,
  onEditSpot,
  onDeleteSpot,
}) => {
  const color = DAY_COLORS[dayIndex % DAY_COLORS.length];
  const [draggingSpotId, setDraggingSpotId] = useState<string | null>(null);
  const [dragOverOrder, setDragOverOrder] = useState<number | null>(null);
  const [editingSpotId, setEditingSpotId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('09:00');
  const [editDuration, setEditDuration] = useState(2);
  const [newSpotIds, setNewSpotIds] = useState<Set<string>>(new Set());
  const dragDataRef = useRef<{ fromDay: number; fromOrder: number; spotId: string } | null>(null);

  useEffect(() => {
    const newIds = spots.filter((s) => s.isNew).map((s) => s.id);
    if (newIds.length > 0) {
      setNewSpotIds((prev) => new Set([...prev, ...newIds]));
      const timer = setTimeout(() => {
        setNewSpotIds((prev) => {
          const next = new Set(prev);
          newIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [spots]);

  const handleDragStart = useCallback(
    (e: React.DragEvent, spot: TripSpot) => {
      if (isPreviewMode) {
        e.preventDefault();
        return;
      }
      dragDataRef.current = {
        fromDay: spot.dayIndex,
        fromOrder: spot.order,
        spotId: spot.id,
      };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(
        'text/plain',
        `${spot.dayIndex}:${spot.order}:${spot.id}`
      );
      setDraggingSpotId(spot.id);
    },
    [isPreviewMode]
  );

  const handleDragEnd = useCallback(() => {
    setDraggingSpotId(null);
    setDragOverOrder(null);
    dragDataRef.current = null;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, order: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverOrder(order);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toOrder: number) => {
      e.preventDefault();
      const data = dragDataRef.current;
      if (!data) return;
      onMoveSpot(data.fromDay, data.fromOrder, dayIndex, toOrder);
      setDraggingSpotId(null);
      setDragOverOrder(null);
      dragDataRef.current = null;
    },
    [dayIndex, onMoveSpot]
  );

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const data = dragDataRef.current;
      if (!data) return;
      onMoveSpot(data.fromDay, data.fromOrder, dayIndex, spots.length);
      setDraggingSpotId(null);
      setDragOverOrder(null);
      dragDataRef.current = null;
    },
    [dayIndex, spots.length, onMoveSpot]
  );

  const handleOpenEdit = useCallback((spot: TripSpot) => {
    setEditingSpotId(spot.id);
    setEditTime(spot.arrivalTime);
    setEditDuration(spot.duration);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editingSpotId) {
      onEditSpot(editingSpotId, editTime, editDuration);
      setEditingSpotId(null);
    }
  }, [editingSpotId, editTime, editDuration, onEditSpot]);

  const sortedSpots = [...spots].sort((a, b) => a.order - b.order);

  return (
    <div className={`day-card ${isPreviewMode ? 'preview-mode' : ''}`}>
      <div
        className="day-header"
        style={{
          borderLeftColor: color,
        }}
      >
        <div className="day-title">
          <span
            className="day-badge"
            style={{ backgroundColor: color }}
          >
            D{dayIndex + 1}
          </span>
          <span className="day-label">第 {dayIndex + 1} 天</span>
        </div>
        <span className="spot-count">{sortedSpots.length} 个景点</span>
      </div>

      <div
        className="spots-container"
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
      >
        {sortedSpots.length === 0 && !isPreviewMode && (
          <div className="empty-hint">拖拽景点到此处，或从上方添加</div>
        )}

        {sortedSpots.map((spot, idx) => (
          <React.Fragment key={spot.id}>
            {dragOverOrder === idx && draggingSpotId !== spot.id && (
              <div className="drop-placeholder" />
            )}

            <div
              className={`spot-card ${
                draggingSpotId === spot.id ? 'spot-dragging' : ''
              } ${newSpotIds.has(spot.id) ? 'spot-new' : ''} ${
                editingSpotId === spot.id ? 'spot-editing' : ''
              }`}
              draggable={!isPreviewMode}
              onDragStart={(e) => handleDragStart(e, spot)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              style={{
                ['--day-color' as string]: color,
              }}
            >
              <div
                className="spot-dot"
                style={{ backgroundColor: color }}
              />

              <div className="spot-info">
                <div className="spot-name">{spot.name}</div>
                <div className="spot-desc">{spot.description}</div>
              </div>

              <div className="spot-tags">
                <span
                  className={`time-tag ${
                    editingSpotId === spot.id ? 'tag-updating' : ''
                  }`}
                >
                  {spot.arrivalTime}
                </span>
                <span
                  className={`duration-tag ${
                    editingSpotId === spot.id ? 'tag-updating' : ''
                  }`}
                >
                  {spot.duration}h
                </span>
              </div>

              {!isPreviewMode && (
                <div className="spot-actions">
                  <button
                    className="action-btn edit-btn"
                    onClick={() => handleOpenEdit(spot)}
                    title="编辑时间"
                  >
                    <FaPencilAlt />
                  </button>
                  <button
                    className="action-btn delete-btn"
                    onClick={() => onDeleteSpot(spot.id, spot.dayIndex)}
                    title="删除"
                  >
                    <FaTrash />
                  </button>
                </div>
              )}

              {editingSpotId === spot.id && (
                <div className="edit-popup" onClick={(e) => e.stopPropagation()}>
                  <div className="edit-row">
                    <label>到达时间</label>
                    <select
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="edit-row">
                    <label>停留时长</label>
                    <select
                      value={editDuration}
                      onChange={(e) =>
                        setEditDuration(Number(e.target.value))
                      }
                    >
                      {DURATION_OPTIONS.map((d) => (
                        <option key={d} value={d}>
                          {d} 小时
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="edit-buttons">
                    <button
                      className="cancel-btn"
                      onClick={() => setEditingSpotId(null)}
                    >
                      取消
                    </button>
                    <button className="save-btn" onClick={handleSaveEdit}>
                      保存
                    </button>
                  </div>
                </div>
              )}
            </div>
          </React.Fragment>
        ))}

        {dragOverOrder === sortedSpots.length && draggingSpotId && (
          <div className="drop-placeholder" />
        )}
      </div>
    </div>
  );
};

export default React.memo(DayCard);
