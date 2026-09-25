import React from 'react';
import { AlertTriangle, RotateCcw, Copy, RefreshCw, CheckCircle } from 'lucide-react';

export type ErrorType = 'render' | 'async' | 'network' | 'unknown';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo?: React.ErrorInfo) => void;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  errorType: ErrorType;
}

export const classifyError = (error: Error): ErrorType => {
  const message = error.message.toLowerCase();
  const stack = error.stack?.toLowerCase() || '';
  const fullText = message + stack;

  if (
    fullText.includes('fetch') ||
    fullText.includes('network') ||
    fullText.includes('xmlhttprequest') ||
    fullText.includes('cors') ||
    fullText.includes('timeout') ||
    fullText.includes('abort') ||
    fullText.includes('failed to load') ||
    fullText.includes('net::') ||
    error.name === 'NetworkError' ||
    error.name === 'AbortError'
  ) {
    return 'network';
  }

  if (
    fullText.includes('indexedDB') ||
    fullText.includes('indexeddb') ||
    fullText.includes('websocket') ||
    fullText.includes('web socket') ||
    fullText.includes('ws://') ||
    fullText.includes('wss://') ||
    fullText.includes('localstorage') ||
    fullText.includes('local storage') ||
    fullText.includes('quota exceeded')
  ) {
    return 'async';
  }

  if (
    fullText.includes('render') ||
    fullText.includes('react') ||
    fullText.includes('component') ||
    fullText.includes('hooks') ||
    fullText.includes('invalid hook call') ||
    fullText.includes('too many re-renders')
  ) {
    return 'render';
  }

  return 'unknown';
};

const getErrorTypeLabel = (type: ErrorType): string => {
  const labels: Record<ErrorType, string> = {
    render: '渲染错误',
    async: '异步错误',
    network: '网络错误',
    unknown: '未知错误',
  };
  return labels[type];
};

const getErrorTypeColor = (type: ErrorType): string => {
  const colors: Record<ErrorType, string> = {
    render: '#e74c3c',
    async: '#f39c12',
    network: '#3498db',
    unknown: '#95a5a6',
  };
  return colors[type];
};

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorType: 'unknown',
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorType: classifyError(error),
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  componentDidMount(): void {
    window.addEventListener('error', this.handleWindowError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  componentWillUnmount(): void {
    window.removeEventListener('error', this.handleWindowError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  private handleWindowError = (event: ErrorEvent): void => {
    event.preventDefault();
    const error = event.error instanceof Error ? event.error : new Error(event.message);
    const errorType = classifyError(error);

    this.setState({
      hasError: true,
      error,
      errorInfo: {
        componentStack: `Source: ${event.filename}:${event.lineno}:${event.colno}`,
      },
      errorType,
    });

    this.props.onError?.(error);
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    event.preventDefault();
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    const errorType = classifyError(error);

    this.setState({
      hasError: true,
      error,
      errorInfo: {
        componentStack: 'Unhandled Promise Rejection',
      },
      errorType,
    });

    this.props.onError?.(error);
  };

  resetErrorBoundary = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorType: 'unknown',
    });
    this.props.onReset?.();
  };

  private copyErrorDetails = async (): Promise<void> => {
    const { error, errorInfo, errorType } = this.state;
    if (!error) return;

    const details = [
      `错误类型: ${getErrorTypeLabel(errorType)}`,
      `错误消息: ${error.message}`,
      `错误名称: ${error.name}`,
      error.stack ? `堆栈信息:\n${error.stack}` : '',
      errorInfo?.componentStack ? `组件堆栈:\n${errorInfo.componentStack}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(details);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = details;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  private refreshPage = (): void => {
    window.location.reload();
  };

  private handleCopyClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLButtonElement;
    const originalText = btn.innerHTML;

    this.copyErrorDetails().then(() => {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg><span>已复制</span>';
      btn.style.color = '#27ae60';
      btn.style.background = 'rgba(39, 174, 96, 0.1)';

      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.color = '';
        btn.style.background = '';
      }, 2000);
    });
  };

  render(): React.ReactNode {
    const { hasError, error, errorInfo, errorType } = this.state;
    const { children, fallback } = this.props;

    if (!hasError) {
      return children;
    }

    if (fallback) {
      if (React.isValidElement(fallback)) {
        return React.cloneElement(fallback as React.ReactElement<any>, {
          error,
          errorInfo,
          errorType,
          resetErrorBoundary: this.resetErrorBoundary,
        });
      }
      return fallback;
    }

    const errorColor = getErrorTypeColor(errorType);

    return (
      <div className="error-boundary-wrapper">
        <div className="error-boundary-card">
          <div className="error-boundary-icon" style={{ background: `linear-gradient(135deg, ${errorColor}20 0%, var(--primary-end)20 100%)` }}>
            <AlertTriangle size={48} style={{ color: errorColor }} />
          </div>

          <div className="error-boundary-type" style={{ color: errorColor }}>
            {getErrorTypeLabel(errorType)}
          </div>

          <h1 className="error-boundary-title">
            页面出现了一些问题
          </h1>

          <p className="error-boundary-message">
            {error?.message || '发生了意外的错误，请尝试刷新页面或重试操作。'}
          </p>

          {errorInfo?.componentStack && (
            <details className="error-boundary-details">
              <summary>查看详细信息</summary>
              <pre>
                {error?.stack || errorInfo.componentStack}
              </pre>
            </details>
          )}

          <div className="error-boundary-actions">
            <button className="error-boundary-btn primary" onClick={this.resetErrorBoundary}>
              <RotateCcw size={16} />
              <span>重试</span>
            </button>

            <button className="error-boundary-btn secondary" onClick={this.handleCopyClick}>
              <Copy size={16} />
              <span>复制详情</span>
            </button>

            <button className="error-boundary-btn outline" onClick={this.refreshPage}>
              <RefreshCw size={16} />
              <span>刷新页面</span>
            </button>
          </div>
        </div>

        <style>{`
          .error-boundary-wrapper {
            min-height: 100vh;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: var(--primary-gradient);
          }

          .error-boundary-card {
            width: 100%;
            max-width: 480px;
            background: var(--bg-card);
            border-radius: var(--radius-lg);
            padding: 48px 40px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
            text-align: center;
            animation: errorSlideIn 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          }

          @keyframes errorSlideIn {
            from {
              opacity: 0;
              transform: translateY(20px) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }

          .error-boundary-icon {
            width: 96px;
            height: 96px;
            margin: 0 auto 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .error-boundary-type {
            display: inline-block;
            padding: 6px 16px;
            margin-bottom: 16px;
            font-size: 13px;
            font-weight: 600;
            border-radius: 20px;
            background: currentColor;
            opacity: 0.1;
          }

          .error-boundary-type {
            opacity: 1;
            background: transparent;
            border: 2px solid currentColor;
          }

          .error-boundary-title {
            font-size: 24px;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 12px;
          }

          .error-boundary-message {
            font-size: 14px;
            color: var(--text-secondary);
            line-height: 1.7;
            margin-bottom: 24px;
            word-break: break-word;
          }

          .error-boundary-details {
            text-align: left;
            margin-bottom: 28px;
            border-radius: var(--radius-md);
            overflow: hidden;
          }

          .error-boundary-details summary {
            padding: 12px 16px;
            background: #f5f7fa;
            font-size: 13px;
            font-weight: 500;
            color: var(--text-secondary);
            cursor: pointer;
            transition: var(--transition);
            list-style: none;
          }

          .error-boundary-details summary::-webkit-details-marker {
            display: none;
          }

          .error-boundary-details summary::before {
            content: '▶';
            display: inline-block;
            margin-right: 8px;
            font-size: 10px;
            transition: transform 0.2s;
          }

          .error-boundary-details[open] summary::before {
            transform: rotate(90deg);
          }

          .error-boundary-details summary:hover {
            background: #e8ecf1;
            color: var(--text-primary);
          }

          .error-boundary-details pre {
            max-height: 200px;
            overflow-y: auto;
            padding: 16px;
            background: #1a1a2e;
            color: #ecf0f1;
            font-size: 12px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            line-height: 1.6;
            white-space: pre-wrap;
            word-break: break-all;
          }

          .error-boundary-details pre::-webkit-scrollbar {
            width: 6px;
          }

          .error-boundary-details pre::-webkit-scrollbar-track {
            background: transparent;
          }

          .error-boundary-details pre::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
          }

          .error-boundary-actions {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            justify-content: center;
          }

          .error-boundary-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            height: 44px;
            padding: 0 20px;
            font-size: 14px;
            font-weight: 600;
            border-radius: var(--radius-md);
            transition: var(--transition);
            flex: 1;
            min-width: 120px;
          }

          .error-boundary-btn.primary {
            background: var(--primary-gradient);
            color: #fff;
            box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
          }

          .error-boundary-btn.primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(52, 152, 219, 0.4);
          }

          .error-boundary-btn.secondary {
            background: #f5f7fa;
            color: var(--text-primary);
          }

          .error-boundary-btn.secondary:hover {
            background: #e8ecf1;
          }

          .error-boundary-btn.outline {
            background: transparent;
            color: var(--text-secondary);
            border: 2px solid var(--border-color);
          }

          .error-boundary-btn.outline:hover {
            border-color: var(--primary-start);
            color: var(--primary-start);
            background: rgba(52, 152, 219, 0.05);
          }

          .error-boundary-btn:active {
            transform: translateY(0);
          }

          @media (max-width: 480px) {
            .error-boundary-card {
              padding: 32px 24px;
            }

            .error-boundary-icon {
              width: 80px;
              height: 80px;
            }

            .error-boundary-icon svg {
              width: 40px;
              height: 40px;
            }

            .error-boundary-title {
              font-size: 20px;
            }

            .error-boundary-actions {
              flex-direction: column;
            }

            .error-boundary-btn {
              width: 100%;
            }
          }
        `}</style>
      </div>
    );
  }
}

export default ErrorBoundary;
