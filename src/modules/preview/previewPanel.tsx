import { useState, useEffect } from "react";
import { getContrastColor, darkenColor } from "../export/cssExport";

interface PreviewPanelProps {
  colors: string[];
  transitioning: boolean;
}

export default function PreviewPanel({ colors, transitioning }: PreviewPanelProps) {
  const [progress, setProgress] = useState(65);
  const [buttonHovered, setButtonHovered] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((p) => (p >= 100 ? 20 : p + 5));
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  const primary = colors[0] || "#6C757D";
  const secondary = colors[1] || primary;
  const accent = colors[2] || primary;
  const textColor = getContrastColor(primary);

  const progressGradient =
    colors.length >= 2
      ? `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)`
      : primary;

  const buttonBg = buttonHovered ? darkenColor(primary, 0.15) : primary;

  return (
    <div className="preview-area">
      <div className="preview-container">
        <div
          className="preview-component"
          style={{ transition: transitioning ? "all 0.4s ease" : "all 0.2s ease" }}
        >
          <div className="preview-label">按钮 Button</div>
          <button
            className="preview-button"
            style={{
              backgroundColor: buttonBg,
              color: getContrastColor(buttonBg),
              boxShadow: buttonHovered
                ? `0 4px 14px ${primary}66`
                : `0 2px 6px ${primary}33`,
              transform: buttonHovered ? "translateY(-1px)" : "translateY(0)",
            }}
            onMouseEnter={() => setButtonHovered(true)}
            onMouseLeave={() => setButtonHovered(false)}
          >
            立即开始
          </button>
        </div>

        <div
          className="preview-component"
          style={{ transition: transitioning ? "all 0.4s ease" : "all 0.2s ease" }}
        >
          <div className="preview-label">卡片 Card</div>
          <div
            className="preview-card"
            style={{
              backgroundColor: primary,
              color: textColor,
            }}
          >
            <div className="preview-card-title">设计灵感配色</div>
            <div className="preview-card-text">
              通过精心搭配的色彩方案，让您的界面呈现出专业、和谐的视觉效果。每一种颜色都经过反复调整，确保在不同场景下都能保持最佳的可读性与对比度。
            </div>
          </div>
        </div>

        <div
          className="preview-component"
          style={{ transition: transitioning ? "all 0.4s ease" : "all 0.2s ease" }}
        >
          <div className="preview-label">进度条 Progress Bar</div>
          <div className="preview-progress-wrap">
            <div
              className="preview-progress-bar"
              style={{
                width: `${progress}%`,
                background: progressGradient,
              }}
            />
          </div>
        </div>

        <div
          className="preview-component"
          style={{ transition: transitioning ? "all 0.4s ease" : "all 0.2s ease" }}
        >
          <div className="preview-label">色彩标签 Tags</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {colors.slice(0, 6).map((color, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  borderRadius: 16,
                  backgroundColor: color + "22",
                  color: color,
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${color}44`,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: color,
                  }}
                />
                {color}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
