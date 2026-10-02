import React from 'react';
import { motion } from 'framer-motion';
import { useGrindingStore } from '@/store/useGrindingStore';
import { PATTERN_CLARITY_LEVELS } from '@/types';

const ProgressPanel: React.FC = () => {
  const {
    grindingProgress,
    uniformity,
    reflectivity,
    patternClarity,
    scratchCount,
    isDamaged,
    polishProgress,
  } = useGrindingStore();

  const getPatternDescription = (clarity: number) => {
    const level = PATTERN_CLARITY_LEVELS.find(
      (l) => clarity >= l.min && clarity <= l.max
    );
    return level?.description || '镜面粗糙，无明显纹饰';
  };

  const CircularProgress: React.FC<{
    value: number;
    label: string;
    color: string;
    size?: number;
    strokeWidth?: number;
  }> = ({ value, label, color, size = 80, strokeWidth = 6 }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (value / 100) * circumference;

    return (
      <div className="flex flex-col items-center">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="transform -rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="rgba(139, 69, 19, 0.2)"
              strokeWidth={strokeWidth}
            />
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              style={{
                filter: `drop-shadow(0 0 3px ${color}40)`,
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <motion.span
              key={Math.round(value)}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-lg font-bold"
              style={{ color }}
            >
              {Math.round(value)}%
            </motion.span>
          </div>
        </div>
        <span className="text-xs text-amber-900 mt-1 font-medium">{label}</span>
      </div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4 shadow-xl border-2 border-amber-800"
      style={{
        backgroundImage: `
          linear-gradient(135deg, rgba(255,248,220,0.9) 0%, rgba(245,230,211,0.9) 100%),
          url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%238b4513' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")
        `,
      }}
    >
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold text-amber-900" style={{ fontFamily: 'KaiTi, STKaiti, serif' }}>
          磨镜进度
        </h2>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-amber-700 to-transparent mt-1" />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <CircularProgress value={uniformity} label="研磨均度" color="#8b4513" />
        <CircularProgress value={reflectivity} label="反射率" color="#b87333" />
      </div>

      <div className="space-y-3">
        <div className="bg-amber-50/80 rounded-lg p-3 border border-amber-200">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-amber-800 font-medium">纹饰清晰度</span>
            <span className="text-xs text-amber-600">{Math.round(patternClarity)}%</span>
          </div>
          <div className="h-2 bg-amber-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: 'linear-gradient(90deg, #d4a574, #b87333, #8b4513)',
              }}
              initial={{ width: 0 }}
              animate={{ width: `${patternClarity}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <motion.p
            key={getPatternDescription(patternClarity)}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs text-amber-900 mt-2 text-center font-medium"
          >
            {getPatternDescription(patternClarity)}
          </motion.p>
        </div>

        <div className="bg-amber-50/80 rounded-lg p-3 border border-amber-200">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-amber-800 font-medium">抛光进度</span>
            <span className="text-xs text-amber-600">{Math.round(polishProgress)}%</span>
          </div>
          <div className="h-2 bg-amber-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: 'linear-gradient(90deg, #e8d8b8, #f5deb3, #ffd700)',
              }}
              initial={{ width: 0 }}
              animate={{ width: `${polishProgress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>

        <div className="bg-amber-50/80 rounded-lg p-3 border border-amber-200">
          <div className="flex justify-between items-center">
            <span className="text-xs text-amber-800 font-medium">划痕数量</span>
            <motion.span
              key={scratchCount}
              initial={{ scale: 1 }}
              animate={{ scale: scratchCount > 0 ? [1, 1.2, 1] : 1 }}
              className={`text-sm font-bold ${isDamaged ? 'text-red-600' : scratchCount > 0 ? 'text-orange-500' : 'text-green-600'}`}
            >
              {scratchCount}
            </motion.span>
          </div>
          {isDamaged && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-2 bg-red-100 border border-red-300 rounded p-2"
            >
              <p className="text-xs text-red-700 font-medium text-center">
                ⚠️ 镜面受损！请用1200目细磨石或鹿皮抛光修复
              </p>
            </motion.div>
          )}
        </div>

        <div className="bg-amber-50/80 rounded-lg p-3 border border-amber-200">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-amber-800 font-medium">总进度</span>
            <span className="text-xs text-amber-600">{Math.round(grindingProgress)}%</span>
          </div>
          <div className="h-3 bg-amber-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: 'linear-gradient(90deg, #7a8a7a, #6b4e3a, #8b4513, #b87333)',
              }}
              initial={{ width: 0 }}
              animate={{ width: `${grindingProgress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          {grindingProgress >= 100 && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-2 text-center"
            >
              <span className="text-sm font-bold text-green-600">✨ 磨镜完成！</span>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default ProgressPanel;
