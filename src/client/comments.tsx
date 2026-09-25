import { useEffect, useRef, useState } from 'react';

interface CommentsPanelProps {
  episodeId: string;
  wsOn: (type: string, handler: (data: unknown) => void) => void;
}

interface CommentData {
  id: string;
  author: string;
  avatarColor: string;
  content: string;
  timestamp: number;
}

const AVATAR_COLORS = ['#e94560', '#0f3460', '#533483', '#e9a560', '#48c9b0', '#6c5ce7', '#fd79a8', '#00b894', '#e17055', '#0984e3'];

function generateAvatar(author: string): { color: string; initial: string } {
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = author.charCodeAt(i) + ((hash << 5) - hash);
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  const initial = author.trim().charAt(0).toUpperCase();
  return { color, initial };
}

function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

export default function Comments({ episodeId, wsOn }: CommentsPanelProps) {
  const [comments, setComments] = useState<CommentData[]>([]);
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/comments?episodeId=${episodeId}`)
      .then((r) => r.json())
      .then((data: CommentData[]) => {
        const enriched = data.map((c) => ({
          ...c,
          avatarColor: c.avatarColor || generateAvatar(c.author).color,
        }));
        setComments(enriched);
      });
  }, [episodeId]);

  useEffect(() => {
    wsOn('comment', (data) => {
      const c = data as CommentData;
      const enriched = {
        ...c,
        avatarColor: c.avatarColor || generateAvatar(c.author).color,
      };
      setComments((prev) => [...prev, enriched]);
    });
  }, [wsOn]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const auth = author.trim();
    const cont = content.trim();
    if (!auth || !cont) return;
    const { color } = generateAvatar(auth);
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author: auth, content: cont, episodeId, avatarColor: color }),
    });
    setContent('');
  };

  const formatTs = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="comments-panel">
      <h3 className="panel-title">💬 实时评论</h3>
      <div className="comments-list" ref={listRef}>
        {comments.map((c, i) => {
          const avatar = generateAvatar(c.author);
          const color = c.avatarColor || avatar.color;
          const initial = avatar.initial;
          return (
            <div
              key={c.id}
              className="comment-card"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <div
                className="comment-avatar"
                style={{ backgroundColor: color }}
                title={c.author}
              >
                {initial}
              </div>
              <div className="comment-body">
                <div className="comment-meta">
                  <span className="comment-author">{c.author}</span>
                  <span className="comment-time">{formatTs(c.timestamp)}</span>
                </div>
                <div className="comment-content">{c.content}</div>
              </div>
            </div>
          );
        })}
      </div>
      <form className="comment-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="你的昵称"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className="input-author"
        />
        <div className="input-row">
          <input
            type="text"
            placeholder="说点什么..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="input-content"
          />
          <button type="submit" className="submit-btn">发送</button>
        </div>
      </form>
    </div>
  );
}
