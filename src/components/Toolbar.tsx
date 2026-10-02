import React from 'react'
import { Template, templates, generateTemplateThumbnail } from '@/utils/cutLogic'

interface ToolbarProps {
  selectedTemplate: Template | null
  onTemplateSelect: (template: Template) => void
  onUndo: () => void
  onReset: () => void
  onSave: () => void
  canUndo: boolean
}

const Toolbar: React.FC<ToolbarProps> = ({
  selectedTemplate,
  onTemplateSelect,
  onUndo,
  onReset,
  onSave,
  canUndo
}) => {
  return (
    <div className="toolbar">
      <div className="templates-section">
        <h3 className="section-title">选择模板</h3>
        <div className="templates-grid">
          {templates.map((template) => (
            <div
              key={template.id}
              className={`template-thumb ${selectedTemplate?.id === template.id ? 'selected' : ''}`}
              onClick={() => onTemplateSelect(template)}
            >
              <div className="thumb-wrapper">
                <svg
                  viewBox="0 0 400 400"
                  width="80"
                  height="80"
                  className="thumb-svg"
                  dangerouslySetInnerHTML={{ __html: template.svgPath }}
                />
              </div>
              <span className="template-name">{template.name}</span>
            </div>
          ))}
        </div>
      </div>
      
      <div className="actions-section">
        <button
          className="action-btn undo-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7v6h6"/>
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
          </svg>
          撤销
        </button>
        
        <button
          className="action-btn reset-btn"
          onClick={onReset}
          title="重新剪刻"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          重新剪刻
        </button>
        
        <button
          className="action-btn save-btn"
          onClick={onSave}
          title="保存作品"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          保存作品
        </button>
      </div>
      
      <style>{`
        .toolbar {
          display: flex;
          flex-direction: column;
          gap: 24px;
          padding: 20px;
          background: rgba(255, 248, 231, 0.95);
          border-radius: 12px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
          min-width: 180px;
        }
        
        .section-title {
          font-family: 'Ma Shan Zheng', cursive;
          font-size: 22px;
          color: #8b5e3c;
          margin-bottom: 12px;
          text-align: center;
          text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.1);
        }
        
        .templates-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .template-thumb {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 10px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.3s ease;
          background: rgba(255, 255, 255, 0.5);
          border: 2px solid transparent;
        }
        
        .template-thumb:hover {
          transform: scale(1.1);
          border-color: #f1c40f;
          box-shadow: 0 0 15px rgba(241, 196, 15, 0.5);
        }
        
        .template-thumb.selected {
          background: rgba(241, 196, 15, 0.2);
          border-color: #f1c40f;
        }
        
        .thumb-wrapper {
          width: 80px;
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(192, 57, 43, 0.1);
          border-radius: 6px;
        }
        
        .thumb-svg {
          opacity: 0.7;
        }
        
        .template-name {
          font-family: 'ZCOOL XiaoWei', serif;
          font-size: 14px;
          color: #5d4e37;
          white-space: nowrap;
        }
        
        .actions-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding-top: 16px;
          border-top: 2px solid rgba(139, 94, 60, 0.2);
        }
        
        .action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px 16px;
          border: none;
          border-radius: 8px;
          font-family: 'ZCOOL XiaoWei', serif;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        
        .action-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .undo-btn {
          background: linear-gradient(135deg, #95a5a6, #7f8c8d);
          color: white;
        }
        
        .undo-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #7f8c8d, #6c7a7b);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        
        .reset-btn {
          background: linear-gradient(135deg, #e74c3c, #c0392b);
          color: white;
        }
        
        .reset-btn:hover {
          background: linear-gradient(135deg, #c0392b, #a93226);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        
        .save-btn {
          background: linear-gradient(135deg, #f39c12, #e67e22);
          color: white;
        }
        
        .save-btn:hover {
          background: linear-gradient(135deg, #e67e22, #d35400);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        }
        
        @media (max-width: 768px) {
          .toolbar {
            flex-direction: row;
            flex-wrap: wrap;
            justify-content: center;
            min-width: auto;
            padding: 12px;
            gap: 12px;
          }
          
          .templates-section {
            width: 100%;
          }
          
          .templates-grid {
            flex-direction: row;
            flex-wrap: wrap;
            justify-content: center;
          }
          
          .template-thumb {
            width: 80px;
          }
          
          .actions-section {
            flex-direction: row;
            padding-top: 12px;
            width: 100%;
            justify-content: center;
            border-top: 2px solid rgba(139, 94, 60, 0.2);
          }
          
          .action-btn {
            flex: 1;
            max-width: 150px;
          }
        }
      `}</style>
    </div>
  )
}

export default Toolbar
