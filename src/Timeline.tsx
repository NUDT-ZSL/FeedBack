import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import EventCard from './EventCard';
import { TimelineEvent, TimelineBranch, ViewportState } from './types';

interface TimelineProps {
  events: TimelineEvent[];
  branches: TimelineBranch[];
  viewport: ViewportState;
  onViewportChange: (viewport: ViewportState) => void;
  selectedEventId: string | null;
  onSelectEvent: (id: string | null) => void;
  onEventDateChange: (id: string, date: string) => void;
}

const MAIN_TIMELINE_Y = 120;
const BRANCH_SPACING = 80;
const MONTH_LABELS_TOP = 44;
const YEAR_LABELS_TOP = 12;
const PADDING_X = 100;
const MONTH_WIDTH_BASE = 80;

const Timeline: React.FC<TimelineProps> = ({
  events,
  branches,
  viewport,
  onViewportChange,
  selectedEventId,
  onSelectEvent,
  onEventDateChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStartX, setPanStartX] = useState(0);
  const [panStartPanX, setPanStartPanX] = useState(0);
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isEventDragging, setIsEventDragging] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const updateSize = () => {
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const monthWidth = MONTH_WIDTH_BASE * viewport.zoom;
  const totalWidth = viewport.monthsVisible * monthWidth + PADDING_X * 2;

  const getStartDate = useCallback(() => {
    const center = new Date(viewport.centerDate);
    const start = new Date(center);
    start.setMonth(start.getMonth() - Math.floor(viewport.monthsVisible / 2));
    start.setDate(1);
    return start;
  }, [viewport.centerDate, viewport.monthsVisible]);

  const dateToX = useCallback(
    (dateStr: string) => {
      const start = getStartDate();
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return PADDING_X;

      const monthsDiff =
        (date.getFullYear() - start.getFullYear()) * 12 +
        (date.getMonth() - start.getMonth()) +
        (date.getDate() - 1) / new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

      return PADDING_X + monthsDiff * monthWidth + viewport.panX;
    },
    [getStartDate, monthWidth, viewport.panX]
  );

  const xToDate = useCallback(
    (x: number) => {
      const start = getStartDate();
      const monthsFromStart = (x - PADDING_X - viewport.panX) / monthWidth;
      const date = new Date(start);
      date.setMonth(date.getMonth() + Math.floor(monthsFromStart));
      const dayFraction = monthsFromStart - Math.floor(monthsFromStart);
      const daysInMonth = new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0
      ).getDate();
      date.setDate(Math.max(1, Math.min(daysInMonth, Math.round(dayFraction * daysInMonth) + 1)));
      return date;
    },
    [getStartDate, monthWidth, viewport.panX]
  );

  const months = useMemo(() => {
    const start = getStartDate();
    const arr: { date: Date; x: number }[] = [];
    for (let i = 0; i <= viewport.monthsVisible; i++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);
      arr.push({ date: d, x: PADDING_X + i * monthWidth + viewport.panX });
    }
    return arr;
  }, [getStartDate, viewport.monthsVisible, monthWidth, viewport.panX]);

  const years = useMemo(() => {
    const map = new Map<number, number[]>();
    months.forEach((m, idx) => {
      const year = m.date.getFullYear();
      if (!map.has(year)) map.set(year, []);
      map.get(year)!.push(idx);
    });
    const result: { year: number; x: number }[] = [];
    map.forEach((indices, year) => {
      const avgIdx = indices.reduce((a, b) => a + b, 0) / indices.length;
      result.push({
        year,
        x: PADDING_X + avgIdx * monthWidth + viewport.panX,
      });
    });
    return result;
  }, [months, monthWidth, viewport.panX]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.3, Math.min(3, viewport.zoom * delta));
        const newMonthsVisible = Math.max(6, Math.min(36, Math.round(12 / newZoom)));
        onViewportChange({
          ...viewport,
          zoom: newZoom,
          monthsVisible: newMonthsVisible,
        });
      } else {
        onViewportChange({
          ...viewport,
          panX: viewport.panX - e.deltaY,
        });
      }
    },
    [viewport, onViewportChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (draggingEventId) return;
      if (e.button !== 0) return;
      setIsPanning(true);
      setPanStartX(e.clientX);
      setPanStartPanX(viewport.panX);
      onSelectEvent(null);
    },
    [viewport.panX, onSelectEvent, draggingEventId]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        onViewportChange({
          ...viewport,
          panX: panStartPanX + (e.clientX - panStartX),
        });
      } else if (draggingEventId && isEventDragging) {
        setDragOffset(e.clientX - panStartX);
      }
    },
    [isPanning, draggingEventId, isEventDragging, viewport, onViewportChange, panStartPanX, panStartX]
  );

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggingEventId && isEventDragging) {
      const startX = dateToX(events.find((ev) => ev.id === draggingEventId)?.date || '');
      const finalX = startX + dragOffset;
      const newDate = xToDate(finalX);
      const dateStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
      onEventDateChange(draggingEventId, dateStr);
      setDraggingEventId(null);
      setIsEventDragging(false);
      setDragOffset(0);
    }
  }, [isPanning, draggingEventId, isEventDragging, dragOffset, dateToX, xToDate, onEventDateChange, events]);

  const handleEventDragStart = useCallback(
    (id: string, e: React.MouseEvent) => {
      setDraggingEventId(id);
      setPanStartX(e.clientX);
      setIsEventDragging(false);
      setDragOffset(0);
      const threshold = 5;
      const startX = e.clientX;
      const startY = e.clientY;
      const checkDrag = (ev: MouseEvent) => {
        if (Math.abs(ev.clientX - startX) > threshold || Math.abs(ev.clientY - startY) > threshold) {
          setIsEventDragging(true);
        }
        if (!draggingEventId || isEventDragging) {
          document.removeEventListener('mousemove', checkDrag);
        }
      };
      document.addEventListener('mousemove', checkDrag);
    },
    [draggingEventId, isEventDragging]
  );

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isPanning) setIsPanning(false);
      if (draggingEventId) {
        if (isEventDragging) {
          const event = events.find((ev) => ev.id === draggingEventId);
          if (event) {
            const startX = dateToX(event.date);
            const finalX = startX + dragOffset;
            const newDate = xToDate(finalX);
            const dateStr = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
            onEventDateChange(draggingEventId, dateStr);
          }
        }
        setDraggingEventId(null);
        setIsEventDragging(false);
        setDragOffset(0);
      }
    };
    document.addEventListener('mouseup', handleGlobalMouseUp);
    return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isPanning, draggingEventId, isEventDragging, dragOffset, dateToX, xToDate, onEventDateChange, events]);

  const mainEvents = events.filter((e) => !e.branchId);
  const branchEventMap = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    events.forEach((e) => {
      if (e.branchId) {
        if (!map.has(e.branchId)) map.set(e.branchId, []);
        map.get(e.branchId)!.push(e);
      }
    });
    return map;
  }, [events]);

  const branchPositions = useMemo(() => {
    const map = new Map<string, { y: number; index: number }>();
    let globalBranchIndex = 0;
    mainEvents.forEach((ev) => {
      const evBranches = branches.filter((b) => b.parentEventId === ev.id);
      evBranches.forEach((branch, idx) => {
        map.set(branch.id, {
          y: MAIN_TIMELINE_Y + (globalBranchIndex + 1) * BRANCH_SPACING,
          index: idx,
        });
        globalBranchIndex++;
      });
    });
    return map;
  }, [mainEvents, branches]);

  const totalHeight = useMemo(() => {
    const totalBranches = branches.length;
    return MAIN_TIMELINE_Y + totalBranches * BRANCH_SPACING + 80;
  }, [branches.length]);

  const renderBranchConnector = (parentEvent: TimelineEvent, branchId: string, branchY: number) => {
    const parentX = dateToX(parentEvent.date);
    const connectorHeight = branchY - MAIN_TIMELINE_Y;
    const curveOffset = 20;

    const path = `M ${parentX} ${MAIN_TIMELINE_Y} 
                   C ${parentX} ${MAIN_TIMELINE_Y + curveOffset}, 
                     ${parentX - curveOffset * 2} ${branchY - curveOffset}, 
                     ${parentX - curveOffset * 2} ${branchY}`;

    return (
      <svg
        key={`connector-${branchId}`}
        className="event-connector"
        style={{
          left: 0,
          top: 0,
          width: totalWidth,
          height: totalHeight,
        }}
      >
        <path d={path} className="branch-connector" />
      </svg>
    );
  };

  const dragGuideX = draggingEventId && isEventDragging
    ? dateToX(events.find((e) => e.id === draggingEventId)?.date || '') + dragOffset
    : null;

  return (
    <div
      ref={containerRef}
      className={`timeline-canvas ${isPanning ? 'is-dragging' : ''} ${isEventDragging ? 'is-event-dragging' : ''}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div
        className="timeline-content"
        style={{
          width: totalWidth,
          height: totalHeight,
        }}
      >
        <div className="year-labels">
          {years.map((y) => (
            <div key={y.year} className="year-label" style={{ left: y.x, top: YEAR_LABELS_TOP }}>
              {y.year}年
            </div>
          ))}
        </div>

        <div className="month-labels">
          {months.map((m, i) => (
            <div key={i} className="month-label" style={{ left: m.x, top: MONTH_LABELS_TOP }}>
              {m.date.getMonth() + 1}月
            </div>
          ))}
        </div>

        <div className="timeline-axes" style={{ top: MAIN_TIMELINE_Y - 1, width: totalWidth, height: totalHeight }}>
          <div className="main-timeline-axis" style={{ top: 0 }} />
          {months.map((m, i) => (
            <div key={i} className="month-tick" style={{ left: m.x, top: 0, height: 8 }} />
          ))}
        </div>

        {branches.map((branch) => {
          const pos = branchPositions.get(branch.id);
          if (!pos) return null;
          const parentEvent = events.find((e) => e.id === branch.parentEventId);
          return (
            <React.Fragment key={branch.id}>
              {parentEvent && renderBranchConnector(parentEvent, branch.id, pos.y)}
              <div className="branch-timeline" style={{ top: pos.y - 1, width: totalWidth }}>
                <div className="branch-line" />
                <div className="branch-label" style={{ top: 0 }}>
                  {branch.name}
                </div>
              </div>
            </React.Fragment>
          );
        })}

        <div className="events-layer" style={{ top: 0, width: totalWidth, height: totalHeight }}>
          {mainEvents.map((event) => {
            const isDragging = draggingEventId === event.id && isEventDragging;
            const x = dateToX(event.date) + (isDragging ? dragOffset : 0);
            return (
              <EventCard
                key={event.id}
                event={event}
                x={x}
                y={MAIN_TIMELINE_Y}
                isBranch={false}
                isSelected={selectedEventId === event.id}
                onSelect={onSelectEvent}
                onDragStart={handleEventDragStart}
              />
            );
          })}

          {Array.from(branchEventMap.entries()).map(([branchId, branchEvents]) => {
            const pos = branchPositions.get(branchId);
            if (!pos) return null;
            return branchEvents.map((event) => {
              const isDragging = draggingEventId === event.id && isEventDragging;
              const x = dateToX(event.date) + (isDragging ? dragOffset : 0);
              return (
                <EventCard
                  key={event.id}
                  event={event}
                  x={x}
                  y={pos.y}
                  isBranch={true}
                  isSelected={selectedEventId === event.id}
                  onSelect={onSelectEvent}
                  onDragStart={handleEventDragStart}
                />
              );
            });
          })}
        </div>

        {dragGuideX !== null && (
          <div
            className="drag-guide-line"
            style={{
              left: dragGuideX,
              top: 0,
              height: totalHeight,
            }}
          />
        )}
      </div>
    </div>
  );
};

export default Timeline;
