import React, { useState, useCallback, useMemo } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { FaShareAlt, FaEye, FaArrowLeft } from 'react-icons/fa';
import RouteBuilder from './components/RouteBuilder';
import MapView from './components/MapView';
import {
  Trip,
  DaySchedule,
  Attraction,
  TripSpot,
  generateId,
  generateShareCode,
} from './types';
import './index.css';

const App: React.FC = () => {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);

  const handleCreateTrip = useCallback((name: string, days: number) => {
    const schedules: DaySchedule[] = [];
    for (let i = 0; i < days; i++) {
      schedules.push({ dayIndex: i, spots: [] });
    }
    const newTrip: Trip = {
      id: generateId(),
      name,
      days,
      schedules,
      createdAt: Date.now(),
    };
    setTrip(newTrip);
    toast.success(`行程 "${name}" 创建成功！`);
  }, []);

  const handleAddSpot = useCallback(
    (attraction: Attraction, dayIndex: number) => {
      setTrip((prev) => {
        if (!prev) return prev;
        const schedules = prev.schedules.map((s) => ({ ...s, spots: [...s.spots] }));
        const schedule = schedules[dayIndex];
        const newSpot: TripSpot = {
          id: generateId(),
          attractionId: attraction.id,
          name: attraction.name,
          description: attraction.description,
          lat: attraction.lat,
          lng: attraction.lng,
          arrivalTime: '09:00',
          duration: 2,
          dayIndex,
          order: schedule.spots.length,
          isNew: true,
        };
        schedule.spots.push(newSpot);
        setTimeout(() => {
          setTrip((p) => {
            if (!p) return p;
            return {
              ...p,
              schedules: p.schedules.map((s) => ({
                ...s,
                spots: s.spots.map((sp) =>
                  sp.id === newSpot.id ? { ...sp, isNew: false } : sp
                ),
              })),
            };
          });
        }, 350);
        return { ...prev, schedules };
      });
    },
    []
  );

  const handleMoveSpot = useCallback(
    (
      fromDay: number,
      fromOrder: number,
      toDay: number,
      toOrder: number
    ) => {
      setTrip((prev) => {
        if (!prev) return prev;
        const schedules = prev.schedules.map((s) => ({
          ...s,
          spots: [...s.spots],
        }));
        const fromSchedule = schedules[fromDay];
        const sortedFrom = fromSchedule.spots.sort((a, b) => a.order - b.order);
        if (fromOrder >= sortedFrom.length) return prev;
        const [movedSpot] = sortedFrom.splice(fromOrder, 1);
        sortedFrom.forEach((s, i) => {
          s.order = i;
          s.dayIndex = fromDay;
        });
        fromSchedule.spots = sortedFrom;

        if (fromDay === toDay) {
          const targetOrder = Math.min(toOrder, sortedFrom.length);
          sortedFrom.splice(targetOrder, 0, {
            ...movedSpot,
            order: targetOrder,
          });
          sortedFrom.forEach((s, i) => (s.order = i));
        } else {
          const toSchedule = schedules[toDay];
          const sortedTo = toSchedule.spots.sort((a, b) => a.order - b.order);
          const targetOrder = Math.min(toOrder, sortedTo.length);
          const updatedSpot = {
            ...movedSpot,
            dayIndex: toDay,
            order: targetOrder,
          };
          sortedTo.splice(targetOrder, 0, updatedSpot);
          sortedTo.forEach((s, i) => (s.order = i));
          toSchedule.spots = sortedTo;
        }
        return { ...prev, schedules };
      });
    },
    []
  );

  const handleEditSpot = useCallback(
    (spotId: string, arrivalTime: string, duration: number) => {
      setTrip((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          schedules: prev.schedules.map((s) => ({
            ...s,
            spots: s.spots.map((sp) =>
              sp.id === spotId ? { ...sp, arrivalTime, duration } : sp
            ),
          })),
        };
      });
      toast.success('时间已更新');
    },
    []
  );

  const handleDeleteSpot = useCallback((spotId: string, dayIndex: number) => {
    setTrip((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        schedules: prev.schedules.map((s, idx) => {
          if (idx !== dayIndex) return s;
          const filtered = s.spots.filter((sp) => sp.id !== spotId);
          filtered.forEach((sp, i) => (sp.order = i));
          return { ...s, spots: filtered };
        }),
      };
    });
  }, []);

  const allSpots = useMemo(() => {
    if (!trip) return [];
    return trip.schedules.flatMap((s) => s.spots);
  }, [trip]);

  const handleGenerateShare = useCallback(() => {
    if (!trip) return;
    const code = generateShareCode();
    setTrip((prev) => (prev ? { ...prev, shareCode: code } : prev));
    const link = `${window.location.origin}${window.location.pathname}?share=${code}`;
    navigator.clipboard
      .writeText(link)
      .then(() => {
        toast.success(`分享短码 ${code} 已复制到剪贴板！`, {
          style: {
            background: '#27AE60',
            color: '#fff',
            borderRadius: '10px',
          },
          duration: 3000,
        });
      })
      .catch(() => {
        toast.success(`分享短码：${code}`);
      });
  }, [trip]);

  const handleTogglePreview = useCallback(() => {
    setIsPreviewMode((p) => !p);
  }, []);

  const handleBackToCreate = useCallback(() => {
    setTrip(null);
    setIsPreviewMode(false);
  }, []);

  return (
    <div className="app-container">
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            borderRadius: '10px',
          },
        }}
      />

      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">旅行行程规划助手</h1>
          {trip && !isPreviewMode && (
            <span className="trip-name-tag">· {trip.name}</span>
          )}
          {trip && isPreviewMode && (
            <span className="preview-tag">· 预览分享版</span>
          )}
        </div>
        <div className="header-right">
          {trip && !isPreviewMode && (
            <>
              <button
                className="header-btn preview-btn"
                onClick={handleTogglePreview}
              >
                <FaEye />
                <span>预览分享版</span>
              </button>
              <button
                className="header-btn share-btn"
                onClick={handleGenerateShare}
              >
                <FaShareAlt />
                <span>生成分享链接</span>
              </button>
              <button
                className="header-btn back-btn"
                onClick={handleBackToCreate}
              >
                <FaArrowLeft />
                <span>返回</span>
              </button>
            </>
          )}
          {trip && isPreviewMode && (
            <button
              className="header-btn preview-btn"
              onClick={handleTogglePreview}
            >
              <FaArrowLeft />
              <span>返回编辑</span>
            </button>
          )}
        </div>
      </header>

      <main className="app-main">
        <div className={`main-content ${isPreviewMode ? 'preview-layout' : ''}`}>
          <section className="cards-section">
            <RouteBuilder
              trip={trip}
              isPreviewMode={isPreviewMode}
              onCreateTrip={handleCreateTrip}
              onAddSpot={handleAddSpot}
              onMoveSpot={handleMoveSpot}
              onEditSpot={handleEditSpot}
              onDeleteSpot={handleDeleteSpot}
            />
          </section>

          <section className="map-section">
            <MapView
              spots={allSpots}
              days={trip?.days ?? 0}
              isPreviewMode={isPreviewMode}
            />
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;
