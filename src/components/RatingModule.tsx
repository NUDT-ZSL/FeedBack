import { useState, useCallback, memo } from 'react';
import { FiStar } from 'react-icons/fi';
import { useAppContext } from '../context/AppContext';

interface RatingModuleProps {
  storyId: string;
  chapterId: string;
  baseAverage: number;
  baseRatingCount: number;
}

const RIPPLE_COLOR = 'rgba(74, 144, 217, 0.4)';

export const RatingModule = memo(function RatingModule({
  storyId,
  chapterId,
  baseAverage,
  baseRatingCount
}: RatingModuleProps) {
  const { addRating, hasRated, getChapterRating, showToast } = useAppContext();
  const [hoveredScore, setHoveredScore] = useState(0);
  const [rippleScore, setRippleScore] = useState(0);
  const [reviewText, setReviewText] = useState('');
  const [showReviewInput, setShowReviewInput] = useState(false);
  const userRating = getChapterRating(storyId, chapterId);
  const alreadyRated = hasRated(storyId, chapterId);

  const totalCount = baseRatingCount + userRating.count;
  const totalAverage =
    totalCount > 0
      ? (baseAverage * baseRatingCount + userRating.average * userRating.count) / totalCount
      : 0;

  const handleRatingClick = useCallback(
    (score: number) => {
      setRippleScore(score);
      addRating({ storyId, chapterId, score });
      setShowReviewInput(true);
      setTimeout(() => setRippleScore(0), 300);
    },
    [storyId, chapterId, addRating]
  );

  const handleReviewSubmit = useCallback(() => {
    if (userRating.userScore && reviewText.trim()) {
      addRating({
        storyId,
        chapterId,
        score: userRating.userScore,
        review: reviewText.trim()
      });
      showToast('感谢您的评价！');
      setReviewText('');
    } else if (userRating.userScore) {
      showToast('感谢您的评分！');
    }
    setShowReviewInput(false);
  }, [storyId, chapterId, userRating.userScore, reviewText, addRating, showToast]);

  const displayScore = hoveredScore || userRating.userScore || 0;

  return (
    <div
      style={{
        marginTop: '48px',
        padding: '32px',
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)'
      }}
    >
      <h3
        style={{
          fontSize: '20px',
          fontWeight: 600,
          color: '#333',
          marginBottom: '20px',
          textAlign: 'center'
        }}
      >
        为本章评分
      </h3>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px'
        }}
      >
        {[1, 2, 3, 4, 5].map((score) => {
          const isActive = score <= displayScore;
          const hasRipple = score === rippleScore;

          return (
            <button
              key={score}
              onClick={() => handleRatingClick(score)}
              onMouseEnter={() => !alreadyRated && setHoveredScore(score)}
              onMouseLeave={() => setHoveredScore(0)}
              aria-label={`${score}星评分`}
              disabled={alreadyRated}
              style={{
                position: 'relative',
                width: '48px',
                height: '48px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: alreadyRated ? 'default' : 'pointer',
                transition: 'transform 0.2s ease',
                padding: 0
              }}
            >
              {hasRipple && (
                <span
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: '60px',
                    height: '60px',
                    borderRadius: '50%',
                    backgroundColor: RIPPLE_COLOR,
                    transform: 'translate(-50%, -50%) scale(0)',
                    animation: 'ripple 0.3s ease-out forwards',
                    pointerEvents: 'none'
                  }}
                />
              )}
              <FiStar
                size={32}
                fill={isActive ? '#FFC107' : 'none'}
                color={isActive ? '#FFC107' : '#999'}
                style={{
                  transition: 'all 0.2s ease',
                  transform: isActive ? 'scale(1)' : 'scale(0.95)'
                }}
              />
            </button>
          );
        })}
      </div>

      {(totalCount > 0 || alreadyRated) && (
        <div
          style={{
            textAlign: 'center',
            marginBottom: '20px'
          }}
        >
          <span
            style={{
              fontSize: '24px',
              fontWeight: 700,
              color: '#333',
              marginRight: '8px'
            }}
          >
            {totalAverage.toFixed(1)}
          </span>
          <span style={{ fontSize: '14px', color: '#999' }}>
            / 5.0 · {totalCount} 人评分
          </span>
          {alreadyRated && (
            <div style={{ marginTop: '8px', fontSize: '13px', color: '#4A90D9' }}>
              您已评分：{userRating.userScore} 星
            </div>
          )}
        </div>
      )}

      {showReviewInput && (
        <div
          style={{
            maxWidth: '500px',
            margin: '0 auto',
            animation: 'fadeIn 0.3s ease forwards'
          }}
        >
          <textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value.slice(0, 200))}
            placeholder="写下你对本章的整体评价...（选填，200字以内）"
            style={{
              width: '100%',
              minHeight: '100px',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #E5E5E5',
              fontSize: '14px',
              lineHeight: 1.5,
              resize: 'vertical',
              transition: 'border-color 0.2s ease',
              fontFamily: 'inherit',
              marginBottom: '12px'
            }}
            onFocus={(e) => {
              e.target.style.borderColor = '#4A90D9';
            }}
            onBlur={(e) => {
              e.target.style.borderColor = '#E5E5E5';
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span
              style={{
                fontSize: '12px',
                color: reviewText.length > 180 ? '#F44336' : '#999'
              }}
            >
              {reviewText.length}/200
            </span>
            <button
              onClick={handleReviewSubmit}
              style={{
                padding: '10px 24px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#4A90D9',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'background-color 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2C6BB0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#4A90D9';
              }}
            >
              提交评价
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
