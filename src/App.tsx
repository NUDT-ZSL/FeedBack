import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AudioEngine, type AudioMetadata, type AudioAnalysisData, type Selection } from './AudioEngine';
import WaveformVisualizer from './WaveformVisualizer';
import SpectrumVisualizer from './SpectrumVisualizer';

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const formatSampleRate = (rate: number): string => {
  if (rate >= 1000) {
    return (rate / 1000).toFixed(1) + ' kHz';
  }
  return rate + ' Hz';
};

const App: React.FC = () => {
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [frequencyData, setFrequencyData] = useState<Uint8Array | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [progressTooltipTime, setProgressTooltipTime] = useState(0);
  const [rollingValues, setRollingValues] = useState({
    time: false,
    sampleRate: false,
    fileSize: false
  });

  useEffect(() => {
    audioEngineRef.current = new AudioEngine();
    
    audioEngineRef.current.setAnalysisCallback((data: AudioAnalysisData) => {
      setCurrentTime(data.currentTime);
      setFrequencyData(data.frequencyData);
    });

    audioEngineRef.current.setStateChangeCallback((playing: boolean) => {
      setIsPlaying(playing);
    });

    audioEngineRef.current.setEndedCallback(() => {
      if (!audioEngineRef.current?.isLoopingEnabled()) {
        setCurrentTime(0);
      }
    });

    return () => {
      audioEngineRef.current?.dispose();
    };
  }, []);

  const triggerRolling = useCallback((key: keyof typeof rollingValues) => {
    setRollingValues(prev => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setRollingValues(prev => ({ ...prev, [key]: false }));
    }, 300);
  }, []);

  const handleFileUpload = useCallback(async (file: File) => {
    const validTypes = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/x-wav'];
    const validExtensions = ['.mp3', '.wav', '.ogg'];
    
    const fileExt = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!validTypes.includes(file.type) && !validExtensions.includes(fileExt)) {
      alert('请上传支持的音频格式：MP3、WAV、OGG');
      return;
    }

    setIsLoading(true);
    setSelection(null);
    
    try {
      if (!audioEngineRef.current) {
        audioEngineRef.current = new AudioEngine();
      }
      
      const buffer = await audioEngineRef.current.loadAudioFile(file);
      const meta = audioEngineRef.current.getMetadata();
      
      setAudioBuffer(buffer);
      setMetadata(meta);
      setCurrentTime(0);
      triggerRolling('time');
      triggerRolling('sampleRate');
      triggerRolling('fileSize');
    } catch (error) {
      console.error('Error loading audio:', error);
      alert('音频文件加载失败，请尝试其他文件');
    } finally {
      setIsLoading(false);
    }
  }, [triggerRolling]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, [handleFileUpload]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, [handleFileUpload]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePlayPause = useCallback(() => {
    if (!audioEngineRef.current) return;
    
    if (isPlaying) {
      audioEngineRef.current.pause();
    } else {
      if (selection && selection.end > selection.start) {
        audioEngineRef.current.play(selection);
      } else {
        audioEngineRef.current.play();
      }
    }
  }, [isPlaying, selection]);

  const handleStop = useCallback(() => {
    if (!audioEngineRef.current) return;
    audioEngineRef.current.stop();
    setSelection(null);
    setCurrentTime(0);
    triggerRolling('time');
  }, [triggerRolling]);

  const handleToggleLoop = useCallback(() => {
    if (!audioEngineRef.current) return;
    const looping = audioEngineRef.current.toggleLoop();
    setIsLooping(looping);
  }, []);

  const handleSeek = useCallback((time: number) => {
    if (!audioEngineRef.current) return;
    audioEngineRef.current.seek(time);
    triggerRolling('time');
  }, [triggerRolling]);

  const handleProgressBarMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!metadata || metadata.duration === 0) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = ratio * metadata.duration;
    
    handleSeek(time);
    setIsDraggingProgress(true);
    setProgressTooltipTime(time);
  }, [metadata, handleSeek]);

  const handleProgressBarMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!metadata || metadata.duration === 0) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = ratio * metadata.duration;
    
    setProgressTooltipTime(time);
    
    if (isDraggingProgress) {
      handleSeek(time);
    }
  }, [metadata, isDraggingProgress, handleSeek]);

  const handleProgressBarMouseUp = useCallback(() => {
    setIsDraggingProgress(false);
  }, []);

  const handleProgressBarMouseLeave = useCallback(() => {
    setIsDraggingProgress(false);
  }, []);

  const handleSelectionChange = useCallback((newSelection: Selection | null) => {
    setSelection(newSelection);
  }, []);

  const getWaveformData = useCallback((samples: number): Float32Array => {
    if (!audioEngineRef.current) return new Float32Array(0);
    return audioEngineRef.current.getWaveformData(samples);
  }, []);

  const duration = metadata?.duration || 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="app-container">
      <div 
        className={`upload-overlay ${audioBuffer ? 'hidden' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div 
          className={`upload-area ${isDragOver ? 'drag-over' : ''}`}
          onClick={handleUploadClick}
        >
          <div className="upload-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <h2 className="upload-title">音乐波形可视化</h2>
          <p className="upload-subtitle">
            拖拽音频文件到此处，或点击选择文件
          </p>
          <div className="upload-formats">
            <span className="format-tag">MP3</span>
            <span className="format-tag">WAV</span>
            <span className="format-tag">OGG</span>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.wav,.ogg,audio/mpeg,audio/wav,audio/ogg"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      {isLoading && (
        <div className="loading-spinner">
          <div className="spinner" />
        </div>
      )}

      {audioBuffer && (
        <div className="main-content">
          <div className="visualization-area">
            <WaveformVisualizer
              audioBuffer={audioBuffer}
              currentTime={currentTime}
              duration={duration}
              selection={selection}
              onSelectionChange={handleSelectionChange}
              onSeek={handleSeek}
              getWaveformData={getWaveformData}
            />
            <SpectrumVisualizer
              frequencyData={frequencyData}
              isPlaying={isPlaying}
            />
          </div>

          <div className="audio-info">
            <div className="info-item">
              <span className="info-label">时间</span>
              <span className={`info-value ${rollingValues.time ? 'rolling' : ''}`}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>
            {metadata && (
              <>
                <div className="info-item">
                  <span className="info-label">采样率</span>
                  <span className={`info-value ${rollingValues.sampleRate ? 'rolling' : ''}`}>
                    {formatSampleRate(metadata.sampleRate)}
                  </span>
                </div>
                <div className="info-item">
                  <span className="info-label">文件大小</span>
                  <span className={`info-value ${rollingValues.fileSize ? 'rolling' : ''}`}>
                    {formatFileSize(metadata.fileSize)}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="controls-container">
            <div 
              className={`progress-bar-container ${isDraggingProgress ? 'dragging' : ''}`}
              onMouseDown={handleProgressBarMouseDown}
              onMouseMove={handleProgressBarMouseMove}
              onMouseUp={handleProgressBarMouseUp}
              onMouseLeave={handleProgressBarMouseLeave}
            >
              <div 
                className="progress-track" 
                style={{ width: `${progress}%` }}
              />
              <div 
                className="progress-handle"
                style={{ left: `${progress}%` }}
              />
              <div 
                className="progress-tooltip"
                style={{ left: `${progress}%` }}
              >
                {formatTime(progressTooltipTime)}
              </div>
            </div>

            <div className="buttons-container">
              <button
                className={`control-btn ${isLooping ? 'active' : ''}`}
                onClick={handleToggleLoop}
                title="循环播放"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              
              <button
                className="control-btn"
                onClick={handleStop}
                title="停止"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
              </button>
              
              <button
                className={`control-btn play-btn ${isPlaying ? 'playing' : ''}`}
                onClick={handlePlayPause}
                title={isPlaying ? '暂停' : '播放'}
              >
                <svg className="play-icon" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <svg className="pause-icon" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
