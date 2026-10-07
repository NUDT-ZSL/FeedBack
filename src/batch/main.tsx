import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { runBatchChecks, BatchReport } from './batchScenarios';
import './batch.css';

const BatchPage: React.FC = () => {
  const [report, setReport] = useState<BatchReport>(() => runBatchChecks());

  return (
    <div className="batch-page">
      <header className="batch-header">
        <h1>花灯铺 · 多作品批量自检</h1>
        <div className="batch-actions">
          <a className="batch-btn ghost" href="./index.html">
            ← 返回铺面
          </a>
          <button
            type="button"
            className="batch-btn"
            onClick={() => setReport(runBatchChecks())}
          >
            重新运行
          </button>
        </div>
      </header>

      <div className={`summary ${report.passed ? 'ok' : 'fail'}`}>
        {report.passed ? '✓ 全部通过' : '✗ 存在失败'} ·{' '}
        {report.passedChecks}/{report.totalChecks} 项检查通过 ·{' '}
        {report.scenarios.length} 个场景
      </div>

      {report.scenarios.map((scenario) => (
        <section key={scenario.title} className="scenario">
          <h2 className={scenario.passed ? 'ok' : 'fail'}>
            {scenario.passed ? '✓' : '✗'} {scenario.title}
          </h2>
          <ul className="check-list">
            {scenario.checks.map((check, idx) => (
              <li key={idx} className={check.passed ? 'ok' : 'fail'}>
                <span className="mark">{check.passed ? '✓' : '✗'}</span>
                <span className="check-name">{check.name}</span>
                {check.detail && <span className="detail">{check.detail}</span>}
              </li>
            ))}
            {scenario.invariantViolations.map((v, idx) => (
              <li key={`v${idx}`} className="fail">
                <span className="mark">✗</span>
                <span className="check-name">状态不变量被破坏</span>
                <span className="detail">{v}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BatchPage />
  </React.StrictMode>
);
