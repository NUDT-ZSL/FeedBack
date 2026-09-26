import { useState } from 'react';

interface ImportModalProps {
  onConfirm: (json: string) => void;
  onClose: () => void;
}

const ImportModal = ({ onConfirm, onClose }: ImportModalProps) => {
  const [jsonText, setJsonText] = useState('');

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="import-modal-overlay" onClick={handleOverlayClick}>
      <div className="import-modal">
        <h3 className="import-modal__title">导入色板JSON</h3>
        <textarea
          className="import-modal__textarea"
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          placeholder="粘贴色板JSON数据..."
          spellCheck={false}
        />
        <div className="import-modal__actions">
          <button
            className="import-modal__btn import-modal__btn--cancel"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="import-modal__btn import-modal__btn--confirm"
            onClick={() => onConfirm(jsonText)}
          >
            确认导入
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportModal;
