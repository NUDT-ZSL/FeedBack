import React, { useRef, useState } from 'react';
import { Upload, X, FileJson, AlertTriangle, CheckCircle2, SkipForward, HelpCircle, PlusCircle } from 'lucide-react';
import { useMovies } from '../context/MovieContext';
import { parseImportText } from '../utils/import/parse';
import type { ImportReport, PendingCluster } from '../utils/import/types';

interface ImportDialogProps {
  onClose: () => void;
}

const ACTION_LABEL: Record<string, string> = {
  added: '新增',
  merged: '合并',
  duplicate: '重复',
  pending: '待裁决',
  skipped: '跳过',
};

export const ImportDialog: React.FC<ImportDialogProps> = ({ onClose }) => {
  const { importMovies, decidePending, lastImport } = useMovies();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [report, setReport] = useState<ImportReport | null>(lastImport);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const handleImport = () => {
    setError('');
    try {
      const raw = parseImportText(text);
      if (raw.length === 0) {
        setError('未解析到任何记录');
        return;
      }
      const result = importMovies(raw);
      setReport(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : '解析失败，请检查文件格式');
    }
  };

  const handleDecision = (clusterKey: string, decision: Parameters<typeof decidePending>[1]) => {
    const next = decidePending(clusterKey, decision);
    if (next) setReport(next);
  };

  const renderPendingCluster = (cluster: PendingCluster) => (
    <div key={cluster.clusterKey} className="pending-cluster">
      <div className="pending-reason">
        <AlertTriangle size={14} /> {cluster.reason}
      </div>
      <div className="pending-records">
        {cluster.records.map((r) => (
          <span key={r.row} className="pending-record">
            第{r.row}行《{r.title}》{r.year ?? '未知年份'}（{r.source}）
          </span>
        ))}
      </div>
      <div className="pending-actions">
        {cluster.candidates
          .filter((c) => c.kind === 'existing')
          .map((c) => (
            <button
              key={c.id}
              className="btn btn-secondary btn-sm"
              onClick={() =>
                handleDecision(cluster.clusterKey, {
                  type: 'merge',
                  targetId: c.id,
                  decidedAt: new Date().toISOString(),
                })
              }
            >
              并入《{c.title}》
            </button>
          ))}
        <button
          className="btn btn-secondary btn-sm"
          onClick={() =>
            handleDecision(cluster.clusterKey, {
              type: 'add',
              recordId: `row:${cluster.records[0].row}`,
              decidedAt: new Date().toISOString(),
            })
          }
        >
          作为新条目添加
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() =>
            handleDecision(cluster.clusterKey, { type: 'skip', decidedAt: new Date().toISOString() })
          }
        >
          跳过
        </button>
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            <Upload size={18} /> 导入外部片单
          </h3>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          {!report && (
            <>
              <p className="import-hint">
                支持 JSON / CSV 格式的片单文件。字段缺失或非法时会归为「未知」并在报告中标注，不会丢弃整条记录；已收藏条目的个人评分、观影日期、观看状态不会被覆盖。
              </p>
              <div className="import-input-row">
                <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
                  <FileJson size={16} /> 选择文件
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".json,.csv,.txt"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <span className="import-or">或直接粘贴内容</span>
              </div>
              <textarea
                className="import-textarea"
                placeholder='[{"title": "Inception", "year": 2010, "rating": 9, "watched": "已看"}]'
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
              />
              {error && <div className="import-error">{error}</div>}
            </>
          )}

          {report && (
            <div className="import-report">
              <div className="import-summary">
                <span><PlusCircle size={14} /> 新增 {report.added}</span>
                <span><CheckCircle2 size={14} /> 合并 {report.merged}</span>
                <span><SkipForward size={14} /> 重复 {report.duplicate}</span>
                <span><HelpCircle size={14} /> 待裁决 {report.pending}</span>
                <span><AlertTriangle size={14} /> 跳过 {report.skipped}</span>
              </div>

              {report.pendingClusters.length > 0 && (
                <div className="pending-list">
                  <h4>待裁决（{report.pendingClusters.length}）</h4>
                  {report.pendingClusters.map(renderPendingCluster)}
                </div>
              )}

              <div className="import-records">
                {report.recordResults.map((r) => (
                  <div key={r.row} className={`import-record action-${r.action}`}>
                    <div className="import-record-head">
                      <span className="import-record-title">
                        第{r.row}行 《{r.title}》{r.year ?? '未知年份'}
                      </span>
                      <span className={`action-badge badge-${r.action}`}>{ACTION_LABEL[r.action]}</span>
                    </div>
                    {r.reason && <div className="import-record-reason">{r.reason}</div>}
                    {r.filledFields && r.filledFields.length > 0 && (
                      <div className="import-record-reason">本次补齐字段：{r.filledFields.join('、')}</div>
                    )}
                    {r.issues.length > 0 && (
                      <ul className="import-issues">
                        {r.issues.map((issue, i) => (
                          <li key={i} className={`issue-${issue.level}`}>
                            {issue.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          {report ? (
            <>
              <button className="btn btn-secondary" onClick={() => setReport(null)}>
                继续导入
              </button>
              <button className="btn btn-primary" onClick={onClose}>
                完成
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onClose}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleImport} disabled={!text.trim()}>
                开始导入
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
