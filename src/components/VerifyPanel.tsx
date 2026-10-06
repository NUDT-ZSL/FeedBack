import type { VerifyReport } from '../engine/verify.ts';

interface VerifyPanelProps {
  report: VerifyReport;
  onClose: () => void;
}

export function VerifyPanel({ report, onClose }: VerifyPanelProps) {
  return (
    <div className="verify-overlay" onClick={onClose}>
      <div className="verify-panel" onClick={(event) => event.stopPropagation()}>
        <div className="verify-panel__head">
          <span>统一批量验证结果</span>
          <span className={report.ok ? 'verify-panel__ok' : 'verify-panel__fail'}>
            {report.passed}/{report.cases.length} 通过
          </span>
          <button className="verify-panel__close" onClick={onClose}>✕</button>
        </div>
        {report.cases.map((item) => (
          <div key={item.name} className="verify-case">
            <div className={`verify-case__name ${item.passed ? 'verify-case__name--pass' : 'verify-case__name--fail'}`}>
              [{item.passed ? 'PASS' : 'FAIL'}] {item.name}
            </div>
            {item.details.map((line, index) => (
              <div key={index} className="verify-case__line">{line}</div>
            ))}
          </div>
        ))}
        <div className="verify-panel__foot">
          命令行入口：<code>npm run verify</code>（同一套验证引擎，完全离线）
        </div>
      </div>
    </div>
  );
}
