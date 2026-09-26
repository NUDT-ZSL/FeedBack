import { useState, useEffect } from 'react';
import type { TeamMember, ScheduleEvent } from '../types';
import { getCurrentMinutesInTimezone, formatTime } from '../utils/timezone';
import EventBlock from './EventBlock';
import ZoomSlider from './ZoomSlider';

interface TimeLineProps {
  members: TeamMember[];
  events: ScheduleEvent[];
  baseTimezone: string;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onUpdateEventTime: (id: string, startMinutes: number) => void;
  onRemoveEvent: (id: string) => void;
}

const BASE_TIMELINE_WIDTH = 168;
const HOUR_TICK_WIDTH = 7;
const ROW_HEIGHT = 64;

export default function TimeLine({
  members,
  events,
  baseTimezone,
  zoom,
  onZoomChange,
  onUpdateEventTime,
  onRemoveEvent,
}: TimeLineProps) {
  const [currentMinutes, setCurrentMinutes] = useState(
    () => getCurrentMinutesInTimezone(baseTimezone)
  );

  useEffect(() => {
    setCurrentMinutes(getCurrentMinutesInTimezone(baseTimezone));
    const interval = setInterval(() => {
      setCurrentMinutes(getCurrentMinutesInTimezone(baseTimezone));
    }, 60000);
    return () => clearInterval(interval);
  }, [baseTimezone]);

  const timelineWidth = BASE_TIMELINE_WIDTH * zoom;
  const pixelsPerMinute = timelineWidth / 1440;
  const currentLineLeft = currentMinutes * pixelsPerMinute;

  const hourTicks = Array.from({ length: 25 }, (_, i) => i);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#161B22',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 1,
          overflowX: 'auto',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            position: 'relative',
            minWidth: `${timelineWidth}px`,
            minHeight: members.length > 0 ? `${members.length * (ROW_HEIGHT + 32) + 40}px` : '200px',
          }}
        >
          <div
            style={{
              position: 'sticky',
              top: 0,
              height: '32px',
              backgroundColor: '#161B22',
              zIndex: 10,
              display: 'flex',
              borderBottom: '1px solid #30363D',
            }}
          >
            {hourTicks.map((hour) => (
              <div
                key={hour}
                style={{
                  width: `${HOUR_TICK_WIDTH * zoom}px`,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'flex-end',
                  paddingBottom: '4px',
                  justifyContent: hour === 24 ? 'flex-end' : 'flex-start',
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    color: '#8B949E',
                    transform: hour === 24 ? 'translateX(0)' : 'translateX(-50%)',
                  }}
                >
                  {formatTime(hour * 60)}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              position: 'absolute',
              top: '32px',
              left: 0,
              right: 0,
              bottom: 0,
            }}
          >
            {members.map((member, rowIndex) => (
              <div
                key={member.id}
                style={{
                  position: 'relative',
                  height: `${ROW_HEIGHT + 32}px`,
                  borderBottom: '1px solid #21262D',
                  paddingTop: '16px',
                  paddingBottom: '16px',
                }}
              >
                {hourTicks.map((hour) => (
                  <div
                    key={`${member.id}-${hour}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${hour * 60 * pixelsPerMinute}px`,
                      width: '1px',
                      backgroundColor: hour % 6 === 0 ? '#30363D' : '#21262D',
                    }}
                  />
                ))}
                <div
                  style={{
                    position: 'relative',
                    height: `${ROW_HEIGHT}px`,
                    width: `${timelineWidth}px`,
                  }}
                >
                  {events
                    .filter((e) => e.memberIds.includes(member.id))
                    .map((event) => (
                      <EventBlock
                        key={`${member.id}-${event.id}`}
                        event={event}
                        member={member}
                        baseTimezone={baseTimezone}
                        zoom={zoom}
                        onUpdateTime={onUpdateEventTime}
                        onRemove={onRemoveEvent}
                      />
                    ))}
                </div>
              </div>
            ))}

            <div
              className="current-time-line"
              style={{
                position: 'absolute',
                top: '32px',
                left: `${currentLineLeft}px`,
                width: '1px',
                bottom: 0,
                backgroundColor: '#EF4444',
                zIndex: 5,
                pointerEvents: 'none',
                animation: 'blink 1s infinite',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '-4px',
                  left: '-3px',
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: '#EF4444',
                }}
              />
            </div>
          </div>
        </div>
      </div>
      <ZoomSlider value={zoom} onChange={onZoomChange} />
    </div>
  );
}
