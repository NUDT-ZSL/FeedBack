import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { saveAs } from 'file-saver';
import { RepairRecord } from '@/types';
import { getToolName, getRegionTypeName } from '@/utils/tools';

interface ScrollViewerProps {
  records: RepairRecord[];
  isOpen: boolean;
  onClose: () => void;
  completionRate: number;
}

const getEvaluation = (rate: number): string => {
  if (rate >= 100) return '完美修复，宝器重焕光华，技艺精湛，堪比古人';
  if (rate >= 80) return '修复精良，古意盎然，用心之作';
  if (rate >= 50) return '修复尚可，古物渐显';
  return '修复初成，仍需努力';
};

export default function ScrollViewer({ records, isOpen, onClose, completionRate }: ScrollViewerProps) {
  const [scale, setScale] = useState(1);

  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(prev + 0.1, 2));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => Math.max(prev - 0.1, 0.5));
  }, []);

  const handleExport = useCallback(() => {
    const exportData = records.map((r, index) => ({
      序号: index + 1,
      工具: getToolName(r.toolType),
      区域: getRegionTypeName(r.regionType),
      描述: r.description,
      时间: new Date(r.timestamp).toLocaleString('zh-CN'),
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    saveAs(blob, '青铜器修复记录.json');
  }, [records]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="absolute top-4 right-4 z-10 flex gap-2">
            <button
              onClick={handleZoomOut}
              className="px-4 py-2 bg-amber-800 text-amber-100 rounded hover:bg-amber-700 transition-colors"
            >
              缩小
            </button>
            <span className="px-4 py-2 bg-amber-900 text-amber-100 rounded">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="px-4 py-2 bg-amber-800 text-amber-100 rounded hover:bg-amber-700 transition-colors"
            >
              放大
            </button>
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-amber-800 text-amber-100 rounded hover:bg-amber-700 transition-colors"
            >
              导出
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-red-800 text-red-100 rounded hover:bg-red-700 transition-colors"
            >
              关闭
            </button>
          </div>

          <motion.div
            className="relative flex"
            style={{ scale, transformOrigin: 'center center' }}
            initial={{ scale: 0.8 }}
            animate={{ scale }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              className="relative"
              style={{
                width: 800,
                height: 1500,
                background: '#f5e6c8',
                boxShadow: '0 0 60px rgba(0,0,0,0.5), inset 0 0 100px rgba(139,90,43,0.3)',
              }}
              initial={{ clipPath: 'inset(0 100% 0 0)' }}
              animate={{ clipPath: 'inset(0 0% 0 0)' }}
              transition={{ duration: 3, ease: 'easeInOut' }}
            >
              <div
                className="absolute inset-0"
                style={{
                  background: `
                    radial-gradient(circle at 10% 20%, transparent 3px, rgba(139,90,43,0.1) 4px, transparent 5px),
                    radial-gradient(circle at 30% 70%, transparent 4px, rgba(139,90,43,0.15) 5px, transparent 6px),
                    radial-gradient(circle at 60% 30%, transparent 2px, rgba(139,90,43,0.1) 3px, transparent 4px),
                    radial-gradient(circle at 80% 80%, transparent 5px, rgba(139,90,43,0.2) 6px, transparent 7px),
                    radial-gradient(circle at 45% 55%, transparent 3px, rgba(139,90,43,0.1) 4px, transparent 5px),
                    linear-gradient(90deg, rgba(139,90,43,0.1) 0%, transparent 5%, transparent 95%, rgba(139,90,43,0.15) 100%),
                    linear-gradient(180deg, rgba(139,90,43,0.1) 0%, transparent 3%, transparent 97%, rgba(139,90,43,0.15) 100%)
                  `,
                  backgroundSize: '100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%, 100% 100%',
                }}
              />

              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
                }}
              />

              <div
                className="absolute left-0 top-0 bottom-0"
                style={{
                  width: 30,
                  background: 'linear-gradient(90deg, #5c3d2e 0%, #8b5a2b 50%, #5c3d2e 100%)',
                  boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5), 5px 0 15px rgba(0,0,0,0.3)',
                }}
              />
              <div
                className="absolute right-0 top-0 bottom-0"
                style={{
                  width: 30,
                  background: 'linear-gradient(90deg, #5c3d2e 0%, #8b5a2b 50%, #5c3d2e 100%)',
                  boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5), -5px 0 15px rgba(0,0,0,0.3)',
                }}
              />

              <div className="absolute inset-y-0 left-[30px] right-[30px] overflow-hidden">
                <div
                  className="absolute right-8 top-12"
                  style={{
                    writingMode: 'vertical-rl',
                    fontFamily: 'KaiTi, STKaiti, serif',
                    fontSize: 48,
                    color: '#1a1a1a',
                    letterSpacing: '0.5em',
                    textShadow: '2px 2px 4px rgba(0,0,0,0.1)',
                  }}
                >
                  <motion.span
                    initial={{ filter: 'blur(10px)', opacity: 0 }}
                    animate={{ filter: 'blur(0px)', opacity: 1 }}
                    transition={{ duration: 2, delay: 2, ease: 'easeInOut' }}
                  >
                    青铜器修复录
                  </motion.span>
                </div>

                <div className="absolute right-32 top-12 bottom-24 left-8 flex flex-row-reverse gap-6 overflow-y-auto">
                  {records.map((record, index) => (
                    <motion.div
                      key={record.id}
                      className="flex-shrink-0 flex flex-row-reverse items-start gap-4 relative"
                      initial={{ filter: 'blur(8px)', opacity: 0 }}
                      animate={{ filter: 'blur(0px)', opacity: 1 }}
                      transition={{ duration: 1.5, delay: 2.5 + index * 0.3, ease: 'easeInOut' }}
                    >
                      {index < records.length - 1 && (
                        <div
                          className="absolute -left-3 top-0 bottom-0 w-1 flex items-center justify-center"
                          style={{ color: '#c41e3a', opacity: 0.6 }}
                        >
                          <div
                            className="w-8 h-8 border-2 border-current rounded-full flex items-center justify-center text-xs font-bold transform rotate-45"
                            style={{ fontFamily: 'KaiTi, STKaiti, serif' }}
                          >
                            <span className="transform -rotate-45">印</span>
                          </div>
                        </div>
                      )}

                      <div
                        className="flex-shrink-0"
                        style={{
                          writingMode: 'vertical-rl',
                          fontFamily: 'KaiTi, STKaiti, serif',
                          fontSize: 18,
                          color: '#1a1a1a',
                          lineHeight: 2,
                          letterSpacing: '0.15em',
                          textShadow: '1px 1px 2px rgba(0,0,0,0.1)',
                        }}
                      >
                        {String(index + 1).padStart(2, '0')}
                      </div>

                      <div
                        className="flex-shrink-0"
                        style={{
                          writingMode: 'vertical-rl',
                          fontFamily: 'KaiTi, STKaiti, serif',
                          fontSize: 20,
                          color: '#1a1a1a',
                          lineHeight: 2,
                          letterSpacing: '0.15em',
                          textShadow: '1px 1px 2px rgba(0,0,0,0.1)',
                        }}
                      >
                        {getToolName(record.toolType)}·{getRegionTypeName(record.regionType)}
                      </div>

                      <div
                        className="flex-shrink-0"
                        style={{
                          writingMode: 'vertical-rl',
                          fontFamily: 'KaiTi, STKaiti, serif',
                          fontSize: 18,
                          color: '#1a1a1a',
                          lineHeight: 2.2,
                          letterSpacing: '0.1em',
                          textShadow: '1px 1px 2px rgba(0,0,0,0.1)',
                          maxHeight: 1000,
                        }}
                      >
                        {record.description}
                      </div>

                      <div className="flex-shrink-0 flex flex-col gap-3 justify-start pt-4">
                        <div
                          className="w-16 h-16 border-2 border-amber-800/40 rounded overflow-hidden bg-amber-100/50"
                          style={{ boxShadow: 'inset 0 0 10px rgba(139,90,43,0.3)' }}
                      >
                        <div className="w-full h-full bg-gradient-to-br from-amber-700/40 to-amber-900/60 flex items-center justify-center text-xs text-amber-900/60">
                          前
                        </div>
                      </div>
                      <div
                        className="w-16 h-16 border-2 border-amber-800/40 rounded overflow-hidden bg-amber-100/50"
                        style={{ boxShadow: 'inset 0 0 10px rgba(139,90,43,0.3)' }}
                      >
                        <div className="w-full h-full bg-gradient-to-br from-amber-500/30 to-amber-700/40 flex items-center justify-center text-xs text-amber-900/60">
                          后
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <motion.div
                  className="absolute bottom-8 left-1/2 transform -translate-x-1/2 text-center"
                  initial={{ filter: 'blur(10px)', opacity: 0 }}
                  animate={{ filter: 'blur(0px)', opacity: 1 }}
                  transition={{ duration: 2, delay: 4, ease: 'easeInOut' }}
                >
                  <div
                    className="mb-2 text-sm text-amber-800/70"
                    style={{ fontFamily: 'KaiTi, STKaiti, serif' }}
                  >
                    完成度：{completionRate}%
                  </div>
                  <div
                    className="px-8 py-4 rounded-lg"
                    style={{
                      fontFamily: 'KaiTi, STKaiti, serif',
                      fontSize: 24,
                      color: '#1a1a1a',
                      letterSpacing: '0.2em',
                      background: 'rgba(139,90,43,0.1)',
                      border: '1px solid rgba(139,90,43,0.3)',
                      textShadow: '1px 1px 2px rgba(0,0,0,0.1)',
                    }}
                  >
                    {getEvaluation(completionRate)}
                  </div>
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
