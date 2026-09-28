import { useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, CheckCircle, Users, BarChart3, TrendingUp } from 'lucide-react';
import { useStore } from '@/store/useStore';

export default function Dashboard() {
  const getStats = useStore((s) => s.getStats);
  const members = useStore((s) => s.members);
  const songs = useStore((s) => s.songs);
  const stats = getStats();

  const [flashKey, setFlashKey] = useState(0);
  const prevCompletedRef = useRef(stats.completedCount);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stats.completedCount !== prevCompletedRef.current) {
      prevCompletedRef.current = stats.completedCount;
      setFlashKey((k) => k + 1);
    }
  }, [stats.completedCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const entries = Object.entries(stats.memberParticipation);
    const barHeight = 32;
    const gap = 12;
    const height = entries.length * (barHeight + gap) + gap;
    const labelWidth = 64;
    const countWidth = 40;
    const maxBarWidth = width - labelWidth - countWidth - gap * 2;
    const maxCount = Math.max(...Object.values(stats.memberParticipation), 1);

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    let animId: number;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      entries.forEach(([memberId, count], i) => {
        const y = gap + i * (barHeight + gap);
        const member = members.find((m) => m.id === memberId);
        const name = member?.name ?? memberId;

        ctx.fillStyle = '#e0e0e0';
        ctx.font = '14px "Noto Sans SC", sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 0, y + barHeight / 2);

        const barWidth = maxBarWidth * (count / maxCount);
        const barX = labelWidth + gap;

        const gradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
        gradient.addColorStop(0, '#00d4aa');
        gradient.addColorStop(1, '#00a888');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(barX, y + 4, barWidth, barHeight - 8, 4);
        ctx.fill();

        ctx.fillStyle = '#00d4aa';
        ctx.font = '13px "Noto Sans SC", sans-serif';
        ctx.fillText(`${count}`, barX + barWidth + gap, y + barHeight / 2);
      });

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [stats.memberParticipation, members]);

  const hours = Math.floor(stats.weeklyDuration / 60);
  const minutes = stats.weeklyDuration % 60;

  const songEntries = Object.entries(stats.songCompletion);

  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-4 h-full">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-neon" />
          <h2 className="text-lg font-semibold text-white">本周概览</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <motion.div
            key={`duration-${flashKey}`}
            className={`glass-card-no-hover p-4 flex flex-col gap-2 ${flashKey > 0 ? 'flash-animation' : ''}`}
          >
            <Clock className="w-5 h-5 text-neon" />
            <span className="text-sm text-white/60">排练总时长</span>
            <span className="text-xl font-bold text-white">
              {hours} 小时 {minutes} 分钟
            </span>
          </motion.div>
          <motion.div
            key={`completed-${flashKey}`}
            className={`glass-card-no-hover p-4 flex flex-col gap-2 ${flashKey > 0 ? 'flash-animation' : ''}`}
          >
            <CheckCircle className="w-5 h-5 text-neon" />
            <span className="text-sm text-white/60">已完成曲目</span>
            <span className="text-xl font-bold text-white">
              {stats.completedCount} 首
            </span>
          </motion.div>
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-neon" />
          <h2 className="text-lg font-semibold text-white">成员参与</h2>
        </div>
        <div ref={containerRef} className="glass-card-no-hover p-4">
          <canvas ref={canvasRef} />
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-neon" />
          <h2 className="text-lg font-semibold text-white">曲目完成度</h2>
        </div>
        <div className="flex flex-col gap-3">
          {songEntries.map(([songId, percentage]) => {
            const song = songs.find((s) => s.id === songId);
            return (
              <div key={songId} className="glass-card-no-hover p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-white/80">{song?.name ?? songId}</span>
                  <span className="text-sm font-semibold text-neon">{percentage}%</span>
                </div>
                <div className="h-2 rounded-full bg-dark-50 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ width: `${percentage}%`, background: 'linear-gradient(90deg, #00d4aa, #00a888)' }}
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
