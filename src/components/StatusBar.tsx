import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Undo2 } from 'lucide-react';
import { useStore, useLightSource, useDrawingLayers, useCanUndo } from '@/store/useStore';
import { threeUnitsToPx } from '@/utils/curveInterpolation';
import { LIGHT_CONSTRAINTS, MURAL_DIMENSIONS, COLORS } from '@/types';
import { calculateFillArea } from '@/utils/curveInterpolation';

interface Props {
  containerHeight: number;
}

export function StatusBar({ containerHeight }: Props) {
  const lightSource = useLightSource();
  const drawingLayers = useDrawingLayers();
  const canUndo = useCanUndo();
  const undoDrawing = useStore((state) => state.undoDrawing);

  const lightRadiusPx = useMemo(() => {
    const normalized = (lightSource.radius - LIGHT_CONSTRAINTS.minRadiusThree) / 
                      (LIGHT_CONSTRAINTS.maxRadiusThree - LIGHT_CONSTRAINTS.minRadiusThree);
    return Math.round(LIGHT_CONSTRAINTS.minRadiusPx + normalized * 
           (LIGHT_CONSTRAINTS.maxRadiusPx - LIGHT_CONSTRAINTS.minRadiusPx));
  }, [lightSource.radius]);

  const completionPercentage = useMemo(() => {
    const totalDamagedArea = MURAL_DIMENSIONS.width * MURAL_DIMENSIONS.height * 
                             MURAL_DIMENSIONS.damagedAreaRatio;
    
    let filledArea = 0;
    drawingLayers.forEach((layer) => {
      if (layer.type === 'fill' && layer.r) {
        filledArea += calculateFillArea(layer.r / 100);
      }
    });
    
    const percentage = Math.min(Math.round((filledArea / totalDamagedArea) * 100), 100);
    return percentage;
  }, [drawingLayers]);

  const hasDrawingActivity = drawingLayers.length > 0;

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="absolute bottom-0 left-0 right-0 z-30"
      style={{
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(10px)',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-xs">油灯坐标</span>
              <span 
                className="text-gray-200 text-sm"
                style={{ fontFamily: 'monospace' }}
              >
                X: {lightSource.x.toFixed(2)}
              </span>
              <span 
                className="text-gray-200 text-sm"
                style={{ fontFamily: 'monospace' }}
              >
                Y: {lightSource.y.toFixed(2)}
              </span>
              <span 
                className="text-gray-200 text-sm"
                style={{ fontFamily: 'monospace' }}
              >
                Z: {lightSource.z.toFixed(2)}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-xs">光锥半径</span>
              <span 
                className="text-sm"
                style={{ fontFamily: 'monospace', color: COLORS.LAMP_GLOW }}
              >
                {lightRadiusPx}px
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <AnimatePresence mode="wait">
              {hasDrawingActivity && (
                <motion.div
                  key="progress"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex items-center gap-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">补绘进度</span>
                    <div className="w-32 h-2 bg-gray-700 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: COLORS.STONE_GREEN }}
                        initial={{ width: 0 }}
                        animate={{ width: `${completionPercentage}%` }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      />
                    </div>
                    <span 
                      className="text-sm font-medium"
                      style={{ color: COLORS.STONE_GREEN, fontFamily: 'monospace' }}
                    >
                      {completionPercentage}%
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            <motion.button
              whileHover={{ scale: canUndo ? 1.1 : 1 }}
              whileTap={{ scale: canUndo ? 0.95 : 1 }}
              onClick={undoDrawing}
              disabled={!canUndo}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                canUndo
                  ? 'bg-gray-700 hover:bg-gray-600 text-gray-200 cursor-pointer'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
              title="撤销 (Ctrl+Z)"
            >
              <Undo2 size={14} />
              撤销
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
