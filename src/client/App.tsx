import { useEffect, useState, useRef, useCallback } from 'react';
import type { Episode, Chapter } from '../server/types.js';
import Player from './player.js';
import Comments from './comments.js';
import Poll from './poll.js';

const EPISODE_ID = 'ep-001';
const POLL_ID = 'poll-001';

function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, (data: unknown) => void>>(new Map());

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', payload: { channel: `episode-${EPISODE_ID}` } }));
      ws.send(JSON.stringify({ type: 'subscribe', payload: { channel: `poll-${POLL_ID}` } }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const handler = handlersRef.current.get(msg.type);
        if (handler) handler(msg.payload);
      } catch { /* ignore */ }
    };

    return () => ws.close();
  }, []);

  const on = useCallback((type: string, handler: (data: unknown) => void) => {
    handlersRef.current.set(type, handler);
  }, []);

  return { wsRef, on };
}

export default function App() {
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [chapterKey, setChapterKey] = useState(0);
  const { on } = useWebSocket();

  useEffect(() => {
    fetch(`/api/episode/${EPISODE_ID}`)
      .then((r) => r.json())
      .then(setEpisode);
  }, []);

  const handleTimeUpdate = useCallback(
    (currentTime: number) => {
      if (!episode) return;
      let active: Chapter | null = null;
      for (let i = episode.chapters.length - 1; i >= 0; i--) {
        if (currentTime >= episode.chapters[i].startTime) {
          active = episode.chapters[i];
          break;
        }
      }
      if (active && active.id !== currentChapter?.id) {
        setChapterKey((k) => k + 1);
        setTimeout(() => setCurrentChapter(active), 150);
      }
    },
    [episode, currentChapter]
  );

  if (!episode) return <div className="loading">加载中...</div>;

  return (
    <div className="app">
      <header
        className="chapter-header"
        style={{ backgroundColor: currentChapter?.color || '#1a1a2e' }}
      >
        <div key={chapterKey} className="chapter-title-wrapper chapter-fade">
          <span className="chapter-label">正在播放</span>
          <h1 className="chapter-title">{currentChapter?.title || episode.title}</h1>
        </div>
      </header>

      <main className="main-content">
        <section className="episode-info">
          <h2 className="episode-title">{episode.title}</h2>
          <p className="episode-desc">{episode.description}</p>
        </section>

        <Player
          episode={episode}
          onTimeUpdate={handleTimeUpdate}
          onChapterClick={() => {}}
        />

        <div className="bottom-panels">
          <Comments episodeId={EPISODE_ID} wsOn={on} />
          <Poll episodeId={EPISODE_ID} wsOn={on} />
        </div>
      </main>
    </div>
  );
}
