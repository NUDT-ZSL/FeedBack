import { useState, useRef, useCallback } from 'react';
import type { ScheduleEvent, TeamMember } from '../types';
import { convertTime, formatTime } from '../utils/timezone';
import { lightenColor, rgbaFromHsl } from '../utils/color';

interface EventBlockProps {
  event: ScheduleEvent;
  member: TeamMember;
  baseTimezone: string;
  zoom: number;
  onUpdateTime: (id: string, startMinutes: number) => void;
  onRemove: (id: string) => void;
}

const PIXELS_PER_MINUTE_BASE = 168 / 1440;
const ROW_HEIGHT = 64;

export default function EventBlock({
  event,
  member,
  baseTimezone,
  zoom,
  onUpdateTime,
  onRemove,
}: EventBlockProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const startXRef = useRef(0);
  const startMinutesRef = useRef(0);
  const blockRef = useRef<HTMLDivElement>(null);

  const localStartMinutes = convertTime(
    event.startMinutes,
    baseTimezone,
    member.timezone
  );

  const pixelsPerMinute = PIXELS_PER_MINUTE_BASE * zoom;
  const left = localStartMinutes * pixelsPerMinute;
  const width = Math.max(40, event.durationMinutes * pixelsPerMinute);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    startXRef.current = e.clientX;
    startMinutesRef.current = event.startMinutes;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startXRef.current;
      const minutesDelta = Math.round(dx / pixelsPerMinute / 15) * 15;
      setDragOffset(minutesDelta * pixelsPerMinute);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      const dx = upEvent.clientX - startXRef.current;
      const minutesDelta = Math.round(dx / pixelsPerMinute / 15) * 15;
      const newStart = startMinutesRef.current + minutesDelta;
      if (newStart !== startMinutesRef.current) {
        onUpdateTime(event.id, newStart);
      }
      setIsDragging(false);
      setDragOffset(0);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [event.id, event.startMinutes, pixelsPerMinute, onUpdateTime]);

  const localEndMinutes = (localStartMinutes + event.durationMinutes) % 1440;
  const bgColor = member.avatarColor;
  const hoverBg = lightenColor(bgColor, 15);
  const dragBg = rgbaFromHsl(bgColor, 0.3);

  return (
    <div
      ref={blockRef}
      className="event-block"
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left: `${left + dragOffset}px`,
        top: '8px',
        width: `${width}px`,
        height: `${ROW_HEIGHT - 16}px`,
        backgroundColor: isDragging ? dragBg : bgColor,
        borderRadius: '4px',
        padding: '4px',
        cursor: isDragging ? 'grabbing' : 'grab',
        overflow: 'hidden',
        transition: isDragging ? 'none' : 'left 300ms ease, background-color 150ms ease',
        animation: isDragging ? 'none' : 'eventAppear 300ms ease',
        userSelect: 'none',
        zIndex: isDragging ? 100 : 1,
      }}
      onMouseEnter={(e) => {
        if (!isDragging) {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = hoverBg;
        }
      }}
      onMouseLeave={(e) => {
        if (!isDragging) {
          (e.currentTarget as HTMLDivElement).style.backgroundColor = bgColor;
        }
      }}
    >
      <div
        style={{
          fontSize: `${12 * zoom}px`,
          color: '#FFFFFF',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: 1.2,
        }}
      >
        {event.title}
      </div>
      <div
        style={{
          fontSize: `${10 * zoom}px`,
          color: 'rgba(255,255,255,0.6)',
          marginTop: '2px',
          whiteSpace: 'nowrap',
        }}
      >
        {formatTime(localStartMinutes)} - {formatTime(localEndMinutes)}
      </div>
      <button
        className="delete-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(event.id);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          backgroundColor: '#FF5555',
          border: 'none',
          cursor: 'pointer',
          display: 'none',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          fontSize: '10px',
          lineHeight: 1,
          padding: 0,
          opacity: 0,
          transition: 'opacity 150ms ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.display = 'flex';
          (e.currentTarget as HTMLButtonElement).style.opacity = '1';
        }}
      >
        ×
      </button>
    </div>
  );
}
