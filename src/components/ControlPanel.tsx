import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useWaterStore } from '../store/waterStore'

const sliderStyle: React.CSSProperties = {
  WebkitAppearance: 'none',
  appearance: 'none',
  height: '8px',
  borderRadius: '4px',
  background: 'linear-gradient(to right, #d4a76a, #6b4e3a)',
  outline: 'none',
  cursor: 'pointer',
  transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
}

export default function ControlPanel() {
  const {
    gateOpening,
    slope,
    curvature,
    collisionCount,
    isAutoDemo,
    setGateOpening,
    setSlope,
    setCurvature,
    reset,
    startAutoDemo,
    stopAutoDemo
  } = useWaterStore()

  const autoDemoRef = useRef<number | null>(null)
  const autoDemoStartTime = useRef(0)

  useEffect(() => {
    if (isAutoDemo) {
      autoDemoStartTime.current = Date.now()
      const cycleDuration = 8000

      const animate = () => {
        const elapsed = Date.now() - autoDemoStartTime.current
        const phase = (elapsed % cycleDuration) / cycleDuration

        const triangleWave = (t: number) => {
          if (t < 0.5) return t * 2
          return (1 - t) * 2
        }

        const value = triangleWave(phase) * 100

        setGateOpening(value)
        setSlope(value * 0.3)
        setCurvature(value * 0.9)

        autoDemoRef.current = requestAnimationFrame(animate)
      }

      autoDemoRef.current = requestAnimationFrame(animate)
    } else {
      if (autoDemoRef.current) {
        cancelAnimationFrame(autoDemoRef.current)
        autoDemoRef.current = null
      }
    }

    return () => {
      if (autoDemoRef.current) {
        cancelAnimationFrame(autoDemoRef.current)
      }
    }
  }, [isAutoDemo, setGateOpening, setSlope, setCurvature])

  const handleAutoDemo = () => {
    if (isAutoDemo) {
      stopAutoDemo()
    } else {
      startAutoDemo()
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="counter-panel counter-panel-collision"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#d4a76a', fontSize: '14px' }}>碰撞次数</span>
          <span
            key={collisionCount}
            className="counter-pulse"
            style={{
              color: '#ffd700',
              fontSize: '24px',
              fontWeight: 'bold',
              textShadow: '0 0 10px rgba(255, 215, 0, 0.5)'
            }}
          >
            {collisionCount}
          </span>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, x: -50 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2 }}
        className="control-panel"
      >
        <h2 className="panel-title">曲水流觞</h2>

        <div className="slider-group">
          <div className="slider-label">
            <label>水闸开度</label>
            <span className="slider-value">{gateOpening.toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={gateOpening}
            onChange={(e) => setGateOpening(parseFloat(e.target.value))}
            style={sliderStyle}
            className="custom-slider"
          />
        </div>

        <div className="slider-group">
          <div className="slider-label">
            <label>导水槽坡度</label>
            <span className="slider-value">{slope.toFixed(0)}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="30"
            value={slope}
            onChange={(e) => setSlope(parseFloat(e.target.value))}
            style={sliderStyle}
            className="custom-slider"
          />
        </div>

        <div className="slider-group">
          <div className="slider-label">
            <label>转角弧度</label>
            <span className="slider-value">{curvature.toFixed(0)}°</span>
          </div>
          <input
            type="range"
            min="0"
            max="90"
            value={curvature}
            onChange={(e) => setCurvature(parseFloat(e.target.value))}
            style={sliderStyle}
            className="custom-slider"
          />
        </div>

        <div className="button-group">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={reset}
            className="btn btn-reset"
          >
            重置
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleAutoDemo}
            className="btn btn-demo"
            style={{
              background: isAutoDemo ? '#e67e22' : '#27ae60',
              boxShadow: isAutoDemo
                ? '0 4px 12px rgba(230, 126, 34, 0.4)'
                : '0 4px 12px rgba(39, 174, 96, 0.4)'
            }}
          >
            {isAutoDemo ? '停止' : '自动演示'}
          </motion.button>
        </div>
      </motion.div>

      <style>{`
        .counter-panel {
          position: fixed;
          top: 20px;
          left: 20px;
          padding: 12px 20px;
          background: rgba(200, 180, 150, 0.2);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-radius: 12px;
          border: 1px solid rgba(212, 167, 106, 0.3);
          z-index: 100;
        }

        .control-panel {
          position: fixed;
          left: 20px;
          top: 50%;
          transform: translateY(-50%);
          width: 280px;
          padding: 24px;
          background: rgba(200, 180, 150, 0.2);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-radius: 12px;
          border: 1px solid rgba(212, 167, 106, 0.3);
          z-index: 100;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .panel-title {
          color: #d4a76a;
          font-size: 20px;
          text-align: center;
          margin: 0;
          font-family: Georgia, serif;
          letter-spacing: 2px;
        }

        .slider-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .slider-label {
          display: flex;
          justify-content: space-between;
        }

        .slider-label label {
          color: #d4a76a;
          font-size: 14px;
        }

        .slider-value {
          color: #ffd700;
          font-size: 14px;
          font-weight: bold;
        }

        .custom-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 8px;
          border-radius: 4px;
          background: linear-gradient(to right, #d4a76a, #6b4e3a);
          outline: none;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .custom-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #d4a76a;
          border: 2px solid #6b4e3a;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .custom-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #d4a76a;
          border: 2px solid #6b4e3a;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .button-group {
          display: flex;
          gap: 12px;
          margin-top: 8px;
        }

        .btn {
          flex: 1;
          padding: 12px;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-family: Georgia, serif;
          font-weight: bold;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .btn-reset {
          background: #c0392b;
          box-shadow: 0 4px 12px rgba(192, 57, 43, 0.4);
        }

        .btn-demo {
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-family: Georgia, serif;
          font-weight: bold;
        }

        @media (max-width: 768px) {
          .control-panel {
            top: auto !important;
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            transform: none !important;
            width: 100% !important;
            height: 80px !important;
            padding: 10px 16px !important;
            flex-direction: row !important;
            align-items: center !important;
            border-radius: 16px 16px 0 0 !important;
            gap: 12px !important;
          }
          .control-panel h2 {
            display: none !important;
          }
          .control-panel .slider-group {
            flex: 1 !important;
            min-width: 0 !important;
          }
          .control-panel .button-group {
            gap: 8px !important;
            margin-top: 0 !important;
          }
          .control-panel button {
            padding: 8px 12px !important;
            font-size: 12px !important;
          }
        }
      `}</style>
    </>
  )
}
