import { motion } from 'framer-motion'
import { useSundialStore, SEASONS, Season, SHICHEN } from '../store/store'

const seasonButtons: { key: Season; label: string }[] = [
  { key: 'spring', label: '春分' },
  { key: 'summer', label: '夏至' },
  { key: 'autumn', label: '秋分' },
  { key: 'winter', label: '冬至' },
]

export default function ControlPanel() {
  const {
    gnomonElevation,
    gnomonRotation,
    currentSeason,
    highlightedShichen,
    shadowLength,
    gnomonShadowLength,
    setGnomonElevation,
    setGnomonRotation,
    animateToSeason,
    resetView,
  } = useSundialStore()

  const currentShichen = SHICHEN.find(s => s.name === highlightedShichen)

  return (
    <motion.div
      className="control-panel"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <motion.h2
        className="panel-title"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        司天监 · 日晷校准
      </motion.h2>

      <motion.div
        className="section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <h3 className="section-title">晷针调整</h3>
        
        <div className="slider-container">
          <div className="slider-label">
            <span>仰角</span>
            <span className="slider-value">{gnomonElevation.toFixed(0)}°</span>
          </div>
          <input
            type="range"
            className="slider"
            min="10"
            max="80"
            value={gnomonElevation}
            onChange={(e) => setGnomonElevation(Number(e.target.value))}
          />
        </div>

        <div className="slider-container" style={{ marginTop: '16px' }}>
          <div className="slider-label">
            <span>旋转</span>
            <span className="slider-value">{gnomonRotation.toFixed(0)}°</span>
          </div>
          <input
            type="range"
            className="slider"
            min="-180"
            max="180"
            value={gnomonRotation}
            onChange={(e) => setGnomonRotation(Number(e.target.value))}
          />
        </div>
      </motion.div>

      <motion.div
        className="section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <h3 className="section-title">节气选择</h3>
        <div className="date-buttons">
          {seasonButtons.map((season, index) => (
            <motion.button
              key={season.key}
              className={`date-btn ${currentSeason === season.key ? 'active' : ''}`}
              onClick={() => animateToSeason(season.key)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + index * 0.05 }}
            >
              {season.label}
            </motion.button>
          ))}
        </div>
      </motion.div>

      <motion.div
        className="section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
      >
        <h3 className="section-title">观测结果</h3>
        <div className="info-display">
          <div className="info-row">
            <span className="info-label">当前时辰</span>
            <motion.span
              className="info-value"
              key={highlightedShichen}
              initial={{ scale: 1.2, color: '#ffffff' }}
              animate={{ scale: 1, color: '#d4a017' }}
              transition={{ duration: 0.3 }}
            >
              {highlightedShichen}
            </motion.span>
          </div>
          {currentShichen && (
            <div className="info-row">
              <span className="info-label">对应时刻</span>
              <span className="info-value" style={{ fontSize: '14px' }}>
                {currentShichen.hours}
              </span>
            </div>
          )}
          <div className="info-row">
            <span className="info-label">当前节气</span>
            <span className="info-value">
              {SEASONS[currentSeason as Season].name}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">太阳高度</span>
            <span className="info-value" style={{ fontSize: '14px' }}>
              {SEASONS[currentSeason as Season].sunHeight}°
            </span>
          </div>
        </div>

        <div className="shadow-display">
          晷针影长：{gnomonShadowLength.toFixed(2)} 单位
        </div>
        <div className="shadow-display">
          影表投影：{shadowLength.toFixed(2)} 单位
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        <motion.button
          className="reset-btn"
          onClick={resetView}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          复位校准
        </motion.button>
      </motion.div>

      <motion.div
        className="hint"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
      >
        拖动滑块调整晷针，观察光影方向与刻度对齐。
        <br />
        鼠标左键旋转视角，滚轮缩放场景。
      </motion.div>
    </motion.div>
  )
}
