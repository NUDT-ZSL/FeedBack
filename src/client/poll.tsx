import { useEffect, useState } from 'react';

interface PollPanelProps {
  episodeId: string;
  wsOn: (type: string, handler: (data: unknown) => void) => void;
}

interface PollOptionData {
  id: string;
  label: string;
  votes: number;
}

interface PollData {
  id: string;
  question: string;
  options: PollOptionData[];
}

export default function Poll({ episodeId, wsOn }: PollPanelProps) {
  const [poll, setPoll] = useState<PollData | null>(null);
  const [voted, setVoted] = useState<string | null>(null);
  const [hoveredOption, setHoveredOption] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/poll?episodeId=${episodeId}`)
      .then((r) => r.json())
      .then(setPoll);
  }, [episodeId]);

  useEffect(() => {
    wsOn('poll_update', (data) => {
      setPoll(data as PollData);
    });
  }, [wsOn]);

  const handleVote = async (optionId: string) => {
    if (voted || !poll) return;
    setVoted(optionId);
    await fetch('/api/poll/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pollId: poll.id, optionId }),
    });
  };

  if (!poll) return <div className="poll-panel">加载投票中...</div>;

  const totalVotes = poll.options.reduce((s, o) => s + o.votes, 0);

  return (
    <div className="poll-panel">
      <h3 className="panel-title">📊 互动投票</h3>
      <p className="poll-question">{poll.question}</p>
      <div className="poll-options">
        {poll.options.map((opt) => {
          const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
          const isHovered = hoveredOption === opt.id;
          return (
            <div
              key={opt.id}
              className={`poll-option ${voted === opt.id ? 'poll-option-selected' : ''} ${isHovered ? 'poll-option-hovered' : ''}`}
              onMouseEnter={() => setHoveredOption(opt.id)}
              onMouseLeave={() => setHoveredOption(null)}
              onClick={() => handleVote(opt.id)}
              role="button"
              tabIndex={0}
            >
              <div className="poll-option-label">
                <span className="poll-option-text">{opt.label}</span>
                {isHovered && (
                  <span className="poll-detail">{opt.votes}票 · {pct}%</span>
                )}
              </div>
              <div className="poll-bar-bg">
                <div
                  className="poll-bar-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {!isHovered && <span className="poll-pct">{pct}%</span>}
            </div>
          );
        })}
      </div>
      <p className="poll-total">共 {totalVotes} 人参与 · 点击选项即可投票</p>
    </div>
  );
}
