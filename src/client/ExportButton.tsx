import React, { useState, useCallback } from 'react';
import { toPng } from 'html-to-image';
import { saveAs } from 'file-saver';
import { Download, Share2, Copy, Check, Loader2, Link } from 'lucide-react';
import { PosterConfig, ShareResponse } from './types';

interface ExportButtonProps {
  canvasRef: React.MutableRefObject<HTMLDivElement | null>;
  config: PosterConfig;
}

type ExportState = 'idle' | 'progress' | 'done' | 'error';
type ShareState = 'idle' | 'loading' | 'success' | 'error' | 'copied';

const ExportButton: React.FC<ExportButtonProps> = ({ canvasRef, config }) => {
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [progress, setProgress] = useState(0);
  const [shareState, setShareState] = useState<ShareState>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const [shareError, setShareError] = useState('');

  const handleExport = useCallback(async () => {
    if (!canvasRef.current) return;
    setExportState('progress');
    setProgress(0);

    try {
      let prog = 0;
      const timer = setInterval(() => {
        prog += Math.random() * 25;
        if (prog >= 90) prog = 90;
        setProgress(prog);
      }, 120);

      const dataUrl = await toPng(canvasRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: undefined,
      });

      clearInterval(timer);
      setProgress(100);

      setTimeout(() => {
        const blob = dataURLtoBlob(dataUrl);
        saveAs(blob, `poster-${config.bandId}-${Date.now()}.png`);
        setExportState('done');
        setTimeout(() => {
          setExportState('idle');
          setProgress(0);
        }, 2500);
      }, 300);
    } catch (err) {
      console.error(err);
      setExportState('error');
      setTimeout(() => {
        setExportState('idle');
        setProgress(0);
      }, 2000);
    }
  }, [canvasRef, config.bandId]);

  const handleShare = useCallback(async () => {
    setShareState('loading');
    setShareError('');
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data: ShareResponse = await res.json();
      if (data.success && data.url) {
        const finalUrl = window.location.origin + window.location.pathname + '?poster=' + data.id;
        setShareUrl(finalUrl);
        setShareState('success');
      } else {
        setShareError(data.error || '生成失败');
        setShareState('error');
      }
    } catch (err) {
      setShareError('网络错误');
      setShareState('error');
    }
  }, [config]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareState('copied');
      setTimeout(() => setShareState('success'), 1800);
    } catch {
      setShareState('success');
    }
  }, [shareUrl]);

  return (
    <div className="w-full h-full overflow-y-auto bg-[#16162a] border-l border-[#2a2a4a] text-white p-4 space-y-5">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-cyan-400 mb-3">
          🖼️ 导出海报
        </h3>

        <button
          onClick={handleExport}
          disabled={exportState !== 'idle'}
          className={`w-full relative overflow-hidden py-3.5 px-4 rounded-xl font-bold text-sm tracking-wide transition-all duration-300 ${
            exportState === 'error'
              ? 'bg-gradient-to-r from-red-600 to-red-500'
              : exportState === 'done'
              ? 'bg-gradient-to-r from-green-600 to-emerald-500'
              : exportState === 'progress'
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 cursor-wait'
              : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 hover:shadow-xl hover:shadow-cyan-500/30 hover:-translate-y-0.5'
          } disabled:cursor-not-allowed`}
        >
          {exportState === 'idle' && (
            <span className="flex items-center justify-center gap-2">
              <Download size={16} /> 导出高清 PNG
            </span>
          )}
          {exportState === 'progress' && (
            <span className="flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> 正在生成... {Math.floor(progress)}%
            </span>
          )}
          {exportState === 'done' && (
            <span className="flex items-center justify-center gap-2 animate-bounce">
              <Check size={16} /> 导出完成！
            </span>
          )}
          {exportState === 'error' && (
            <span className="flex items-center justify-center gap-2">导出失败，请重试</span>
          )}

          {(exportState === 'progress' || exportState === 'done') && (
            <div
              className="absolute bottom-0 left-0 h-1 bg-white/60 transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          )}
        </button>

        <p className="text-[10px] text-gray-500 mt-2 text-center">
          分辨率 3840 × 2160 · 2倍像素比高清输出
        </p>
      </div>

      <div className="border-t border-[#2a2a4a] pt-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
          🔗 生成分享链接
        </h3>

        <button
          onClick={handleShare}
          disabled={shareState === 'loading'}
          className={`w-full py-3 px-4 rounded-xl font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2 ${
            shareState === 'loading'
              ? 'bg-[#2a2a4a] cursor-wait'
              : shareState === 'error'
              ? 'bg-red-500/20 border border-red-400/40 text-red-300'
              : 'bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 hover:shadow-lg hover:shadow-pink-500/25 hover:-translate-y-0.5'
          }`}
        >
          {shareState === 'loading' ? (
            <>
              <Loader2 size={16} className="animate-spin" /> 生成中...
            </>
          ) : shareState === 'error' ? (
            <>生成链接失败</>
          ) : (
            <>
              <Share2 size={16} /> 生成分享链接
            </>
          )}
        </button>

        {shareError && (
          <p className="text-[11px] text-red-400 mt-2 text-center">{shareError}</p>
        )}

        {(shareState === 'success' || shareState === 'copied') && shareUrl && (
          <div className="mt-4 animate-fadeIn">
            <div className="p-3 rounded-lg bg-[#0f0f1e] border border-[#3a3a5a]">
              <div className="flex items-center gap-2 mb-2 text-[10px] uppercase tracking-wider text-green-400">
                <Link size={12} /> 链接已生成
              </div>
              <div className="text-[10px] font-mono text-gray-300 break-all pr-2 max-h-16 overflow-y-auto">
                {shareUrl}
              </div>
            </div>
            <button
              onClick={handleCopy}
              className={`mt-3 w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                shareState === 'copied'
                  ? 'bg-green-500/20 border border-green-400/50 text-green-400'
                  : 'bg-[#2a2a4a] hover:bg-[#3a3a5a] text-gray-200 border border-transparent hover:border-green-400/40'
              }`}
            >
              {shareState === 'copied' ? (
                <>
                  <Check size={14} /> 已复制到剪贴板！
                </>
              ) : (
                <>
                  <Copy size={14} /> 复制链接
                </>
              )}
            </button>
            <p className="text-[10px] text-gray-500 mt-2 text-center leading-relaxed">
              他人打开此链接即可看到<br />完全相同的海报并继续编辑
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-[#2a2a4a] pt-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
          💡 操作提示
        </h3>
        <ul className="space-y-2 text-[11px] text-gray-400 leading-relaxed">
          <li className="flex gap-2">
            <span className="text-cyan-400">●</span>
            拖拽元素调整位置
          </li>
          <li className="flex gap-2">
            <span className="text-pink-400">●</span>
            选中后拖拽右下角调整尺寸
          </li>
          <li className="flex gap-2">
            <span className="text-purple-400">●</span>
            点击左侧元素列表快速选中
          </li>
          <li className="flex gap-2">
            <span className="text-green-400">●</span>
            支持自定义CSS高级样式
          </li>
        </ul>
      </div>
    </div>
  );
};

function dataURLtoBlob(dataurl: string): Blob {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

export default ExportButton;
