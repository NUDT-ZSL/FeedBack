import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Heart, Users } from 'lucide-react';
import { Schedule, Band } from '../types';
import { useStore } from '../store/useStore';
import { formatTime, formatDate } from '../utils/time';
import './LineupTimeline.css';

interface LineupTimelineProps {
  schedules: Schedule[];
  bands: Band[];
}

const STAGES = ['主舞台', '副舞台', '电音舞台'];
const HOUR_START = 12;
const HOUR_END = 24;
const TOTAL_HOURS = HOUR_END - HOUR_START;
const HOUR_WIDTH = 120;

const genreColors: Record<string, string> = {
  '摇滚': '#6c63ff',
  '独立': '#f9a826',
  '电子': '#10b981',
  '后摇': '#8b5cf6',
  '器乐': '#ec4899',
  '流行': '#06b6d4',
  '合成器': '#f43f5e',
  '民谣': '#84cc16',
  '氛围': '#6366f1',
  '实验': '#f97316',
};

function getGenreColor(genres: string[]): string {
  if (genres.length === 0) return '#6c63ff';
  return genreColors[genres[0]] || '#6c63ff';
}

function timeToPercent(isoTime: string): number {
  const date = new Date(isoTime);
  const hours = date.getHours() + date.getMinutes() / 60;
  if (hours < HOUR_START) return 0;
  if (hours >= HOUR_END) return 100;
  return ((hours - HOUR_START) / TOTAL_HOURS) * 100;
}

function timeRangeWidth(startIso: string, endIso: string): number {
  return timeToPercent(endIso) - timeToPercent(startIso);
}

export default function LineupTimeline({ schedules, bands }: LineupTimelineProps) {
  const [selectedStage, setSelectedStage] = useState<string>('all');
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);

  const { toggleFavorite, isFavorite } = useStore();

  const days = useMemo(() => {
    const daySet = new Set<string>();
    schedules.forEach(s => {
      const d = new Date(s.startTime);
      d.setHours(0, 0, 0, 0);
      daySet.add(d.toISOString());
    });
    return Array.from(daySet).sort();
  }, [schedules]);

  useEffect(() => {
    if (days.length > 0 && !selectedDay) {
      setSelectedDay(days[0]);
    }
  }, [days, selectedDay]);

  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => {
      const d = new Date(s.startTime);
      d.setHours(0, 0, 0, 0);
      return d.toISOString() === selectedDay
        && (selectedStage === 'all' || s.stage === selectedStage);
    });
  }, [schedules, selectedDay, selectedStage]);

  const displayStages = useMemo(() => {
    if (selectedStage !== 'all') return [selectedStage];
    const used = new Set<string>();
    filteredSchedules.forEach(s => used.add(s.stage));
    return STAGES.filter(s => used.has(s));
  }, [selectedStage, filteredSchedules]);

  const hours = useMemo(() => {
    const h = [];
    for (let i = HOUR_START; i < HOUR_END; i++) {
      h.push(i);
    }
    return h;
  }, []);

  const totalWidth = TOTAL_HOURS * HOUR_WIDTH;

  const handleMouseEnter = useCallback((id: string, e: React.MouseEvent) => {
    setHoveredId(id);
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredId(null);
  }, []);

  const hoveredSchedule = schedules.find(s => s.id === hoveredId);
  const hoveredBand = bands.find(b => b.id === hoveredSchedule?.bandId);

  return (
    <div className="lineup-timeline">
      <div className="timeline-header">
        <h2 className="timeline-title">演出日程</h2>
        <div className="timeline-filters">
          <div className="filter-group">
            <label>日期</label>
            <select
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
              className="filter-select"
            >
              {days.map(day => (
                <option key={day} value={day}>{formatDate(day)}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>舞台</label>
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="filter-select"
            >
              <option value="all">全部舞台</option>
              {STAGES.map(stage => (
                <option key={stage} value={stage}>{stage}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {selectedDay && (
        <div className="timeline-scroll" ref={scrollRef}>
          <div className="timeline-canvas" style={{ width: totalWidth + 120 }}>
            <div className="timeline-ruler">
              <div className="ruler-spacer"></div>
              {hours.map(h => (
                <div key={h} className="ruler-cell" style={{ width: HOUR_WIDTH }}>
                  <span className="ruler-label">{String(h).padStart(2, '0')}:00</span>
                  <div className="ruler-tick"></div>
                </div>
              ))}
            </div>

            {displayStages.map(stage => (
              <div key={stage} className="timeline-lane">
                <div className="lane-label">{stage}</div>
                <div className="lane-track">
                  {hours.map(h => (
                    <div key={h} className="lane-cell" style={{ width: HOUR_WIDTH }}>
                      <div className="cell-border"></div>
                    </div>
                  ))}
                  {filteredSchedules
                    .filter(s => s.stage === stage)
                    .map(schedule => {
                      const left = timeToPercent(schedule.startTime);
                      const width = timeRangeWidth(schedule.startTime, schedule.endTime);
                      const color = getGenreColor(schedule.genres);
                      const fav = isFavorite(schedule.bandId);

                      return (
                        <div
                          key={schedule.id}
                          className="gantt-bar fade-in"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(width, 2)}%`,
                            background: `linear-gradient(135deg, ${color}, ${color}aa)`,
                          }}
                          onMouseEnter={(e) => handleMouseEnter(schedule.id, e)}
                          onMouseMove={handleMouseMove}
                          onMouseLeave={handleMouseLeave}
                        >
                          <div className="bar-content">
                            <span className="bar-name">{schedule.bandName}</span>
                            <span className="bar-time">
                              {formatTime(schedule.startTime)}-{formatTime(schedule.endTime)}
                            </span>
                          </div>
                          <button
                            className={`bar-fav ${fav ? 'active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFavorite(schedule.bandId);
                            }}
                          >
                            <Heart size={12} fill={fav ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hoveredSchedule && hoveredBand && (
        <div
          className="gantt-tooltip"
          style={{ left: tooltipPos.x + 16, top: tooltipPos.y + 16 }}
        >
          <div className="tooltip-head">
            <h4>{hoveredSchedule.bandName}</h4>
            <button
              className={`bar-fav ${isFavorite(hoveredSchedule.bandId) ? 'active' : ''}`}
              onClick={() => toggleFavorite(hoveredSchedule.bandId)}
            >
              <Heart size={14} fill={isFavorite(hoveredSchedule.bandId) ? 'currentColor' : 'none'} />
            </button>
          </div>
          <div className="tooltip-genres">
            {hoveredSchedule.genres.map(g => (
              <span key={g} className="genre-pill" style={{ background: getGenreColor([g]) }}>{g}</span>
            ))}
          </div>
          <p className="tooltip-desc">{hoveredBand.description}</p>
          <div className="tooltip-meta">
            <span><Users size={14} /> {hoveredBand.memberCount}人</span>
            <span>{formatTime(hoveredSchedule.startTime)} - {formatTime(hoveredSchedule.endTime)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
