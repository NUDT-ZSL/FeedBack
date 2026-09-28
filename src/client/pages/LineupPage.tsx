import { useEffect, useState } from 'react';
import LineupTimeline from '../components/LineupTimeline';
import { useStore } from '../store/useStore';
import { scheduleApi, bandsApi } from '../services/api';
import { wsService } from '../services/websocket';
import { Schedule, Band, WSMessage } from '../types';
import './LineupPage.css';

export default function LineupPage() {
  const { schedules, bands, setSchedules, setBands, addSchedule, updateSchedule, removeSchedule, addNotification, favorites } = useStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [schedulesData, bandsData] = await Promise.all([
          scheduleApi.getSchedules(),
          bandsApi.getBands()
        ]);
        setSchedules(schedulesData);
        setBands(bandsData);
      } catch (error) {
        console.error('获取数据失败:', error);
        addNotification({ message: '加载数据失败', type: 'error' });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [setSchedules, setBands, addNotification]);

  useEffect(() => {
    wsService.sendSubscribe(favorites);
  }, [favorites]);

  useEffect(() => {
    const wsUrl = window.location.protocol === 'https:'
      ? `wss://${window.location.host}/ws`
      : `ws://${window.location.host}/ws`;

    wsService.connect(wsUrl);
    wsService.sendSubscribe(favorites);

    const unsubscribe = wsService.subscribe((message: WSMessage) => {
      if (message.type === 'schedule_create') {
        const schedule = message.data as Schedule;
        addSchedule(schedule);
        addNotification({
          message: `${schedule.bandName} 新增演出安排`,
          type: 'info'
        });
      } else if (message.type === 'schedule_update') {
        const schedule = message.data as Schedule;
        updateSchedule(schedule);
        addNotification({
          message: `${schedule.bandName} 的演出时间有调整`,
          type: 'warning'
        });
      } else if (message.type === 'schedule_delete') {
        const data = message.data as { id: string; bandId?: string };
        removeSchedule(data.id);
        addNotification({
          message: '演出安排已取消',
          type: 'error'
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [addSchedule, updateSchedule, removeSchedule, addNotification, favorites]);

  if (loading) {
    return (
      <div className="lineup-page">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lineup-page">
      <div className="page-hero">
        <h1 className="page-title">星空音乐节</h1>
        <p className="page-subtitle">2026年7月 · 与音乐相遇在星空下</p>
      </div>

      <LineupTimeline schedules={schedules} bands={bands} />

      <div className="page-footer">
        <p>💫 点击心形图标收藏你喜欢的乐队，演出变动时将收到通知</p>
      </div>
    </div>
  );
}
