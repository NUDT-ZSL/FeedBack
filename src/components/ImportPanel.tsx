import React, { useRef, useState } from 'react';
import { X, Upload, FileText, AlertTriangle, Plus, RefreshCw, MinusCircle, HelpCircle } from 'lucide-react';
import { useMovies } from '../context/MovieContext';
import { parseImportText } from '../utils/importer';
import type { ImportReport, ImportItemResult, ImportItemStatus } from '../types';

interface ImportPanelProps {
  onClose: () => void;
}

const STATUS_META: Record<
  ImportItemStatus,
  { label: string; className: string; icon: React.ReactNode }
> = {
  added: { label: '新增', className: 'import-item-added', icon: <Plus size={14} /> },
  updated: { label: '补齐字段', className: 'import-item-updated', icon: <RefreshCw size={14} /> },
  unchanged: { label: '已存在', className: 'import-item-unchanged', icon: <MinusCircle size={14} /> },
  duplicate: { label: '片单内重复', className: 'import-item-duplicate', icon: <MinusCircle size={14} /> },
  conflict: { label: '待裁决', className: 'import-item-conflict', icon: <HelpCircle size={14} /> },
  skipped: { label: '跳过', className: 'import-item-skipped', icon: <AlertTriangle size={14} /> },
};

export const ImportPanel: React.FC<ImportPanelProps> = ({ onClose }) => {
  const { importMovies } = useMovies();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [repeatImport, setRepeatImport] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    setReport(null);
    setParseError('');
    const content = await file.text();
    setText(content);
    try {
      setPreviewCount(parseImportText(content).length);
    } catch (e) {
      setPreviewCount(null);
      setParseError(`无法解析文件：${(e as Error).message}`);
    }
  };

  const handleTextChange = (value: string) => {
    setText(value);
    setReport(null);
    setFileName('');
    setParseError('');
    try {
      const count = parseImportText(value).length;
      setPreviewCount(count > 0 ? count : null);
    } catch (e) {
      setPreviewCount(null);
      setParseError(`无法解析内容：${(e as Error).message}`);
    }
  };

  const handleImport = () => {
    const result = importMovies(text);
    if (!result) {
      setParseError('内容为空或无法解析，未执行导入');
      return;
    }
    setReport(result.report);
    setRepeatImport(result.history.repeat);
  };

  const grouped = report
    ? (['added', 'updated', 'unchanged', 'duplicate', 'conflict', 'skipped'] as const).map((status) => ({
        status,
        items: report.items.filter((it) => it.status === status),
      }))
    : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>批量导入片单</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p className="import-hint">
            支持 JSON 数组或带表头的 CSV，可识别字段：<code>title/标题、year/年份、rating/评分、status/观看状态、genre/类型、director/导演、watchDate/观影日期、id/标识</code> 等。缺失或非法的年份、评分、类型等会归一为「未知」而不是丢弃记录；已存在条目的个人评分、观影日期、观看状态不会被覆盖。
          </p>

          {!report && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.csv,.txt"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              <button className="btn btn-secondary import-file-btn" onClick={() => fileRef.current?.click()}>
                <Upload size={16} /> 选择片单文件
              </button>
              {fileName && (
                <div className="import-filename">
                  <FileText size={14} /> {fileName}
                  {previewCount !== null && <span> · 识别到 {previewCount} 条记录</span>}
                </div>
              )}
              <div className="form-group">
                <label>或直接粘贴片单内容</label>
                <textarea
                  className="form-input import-textarea"
                  rows={7}
                  placeholder={'[\n  {"title": "盗梦空间", "year": "2010", "rating": "9.2", "status": "watched", "genre": "科幻"}\n]'}
                  value={text}
                  onChange={(e) => handleTextChange(e.target.value)}
                />
              </div>
              {parseError && <div className="import-error">{parseError}</div>}
            </>
          )}

          {report && (
            <div className="import-report">
              {repeatImport && (
                <div className="import-repeat-banner">
                  <AlertTriangle size={16} />
                  该文件此前已导入过：本次未产生重复条目，也未改写任何已有数据，收藏集合保持不变。
                </div>
              )}
              <div className="import-summary">
                <span>共 {report.total} 条</span>
                <span className="import-item-added">新增 {report.added}</span>
                <span className="import-item-updated">补齐 {report.updated}</span>
                <span className="import-item-unchanged">已存在 {report.unchanged}</span>
                <span className="import-item-duplicate">重复 {report.duplicate}</span>
                <span className="import-item-conflict">待裁决 {report.conflict}</span>
                <span className="import-item-skipped">跳过 {report.skipped}</span>
              </div>
              {grouped.map(({ status, items }) =>
                items.length === 0 ? null : (
                  <div key={status} className="import-group">
                    <div className="import-group-title">
                      <span className={`import-badge ${STATUS_META[status].className}`}>
                        {STATUS_META[status].icon} {STATUS_META[status].label}
                      </span>
                      <span>{items.length} 条</span>
                    </div>
                    <ul className="import-item-list">
                      {items.map((it: ImportItemResult) => (
                        <li key={it.index}>
                          <span className="import-item-index">#{it.index + 1}</span>
                          <span className="import-item-title">{it.title}</span>
                          {it.reason && <span className="import-item-reason">{it.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            关闭
          </button>
          {report ? (
            <button className="btn btn-primary" onClick={() => { setReport(null); setText(''); setFileName(''); setPreviewCount(null); }}>
              再导入一份
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleImport} disabled={!text.trim() || !!parseError}>
              开始导入
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
