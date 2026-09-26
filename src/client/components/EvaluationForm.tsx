import React, { useState } from 'react';

interface EvaluationFormProps {
  onSubmit: (data: {
    courseName: string;
    teacher: string;
    rating: number;
    comment: string;
  }) => void;
}

const EvaluationForm: React.FC<EvaluationFormProps> = ({ onSubmit }) => {
  const [courseName, setCourseName] = useState('');
  const [teacher, setTeacher] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!courseName.trim()) newErrors.courseName = '请输入课程名称';
    if (!teacher.trim()) newErrors.teacher = '请输入授课教师';
    if (rating === 0) newErrors.rating = '请选择评分';
    const chineseChars = comment.match(/[\u4e00-\u9fff]/g);
    if (!comment.trim()) {
      newErrors.comment = '请输入评论文本';
    } else if (!chineseChars || chineseChars.length < 10) {
      newErrors.comment = '评论文本不少于10个汉字';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);
    try {
      await onSubmit({ courseName, teacher, rating, comment });
      setCourseName('');
      setTeacher('');
      setRating(0);
      setHoverRating(0);
      setComment('');
      setErrors({});
    } finally {
      setSubmitting(false);
    }
  };

  const displayRating = hoverRating || rating;

  return (
    <div style={styles.card}>
      <style>{starAnimationCSS}</style>
      <h2 style={styles.heading}>✍️ 提交课程评价</h2>
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.fieldGroup}>
          <label style={styles.label}>课程名称</label>
          <input
            type="text"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
            placeholder="例如：前端开发基础"
            style={{
              ...styles.input,
              borderColor: errors.courseName ? '#ff6b6b' : '#3a3a5e',
            }}
          />
          {errors.courseName && (
            <span style={styles.errorText}>{errors.courseName}</span>
          )}
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>授课教师</label>
          <input
            type="text"
            value={teacher}
            onChange={(e) => setTeacher(e.target.value)}
            placeholder="例如：张明教授"
            style={{
              ...styles.input,
              borderColor: errors.teacher ? '#ff6b6b' : '#3a3a5e',
            }}
          />
          {errors.teacher && (
            <span style={styles.errorText}>{errors.teacher}</span>
          )}
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>评分</label>
          <div style={styles.starsContainer}>
            {[1, 2, 3, 4, 5].map((star) => (
              <span
                key={star}
                style={{
                  ...styles.star,
                  color: star <= displayRating ? '#FFD700' : '#555580',
                  cursor: 'pointer',
                  transition: 'color 0.15s ease, transform 0.15s ease',
                  transform:
                    star <= displayRating ? 'scale(1.15)' : 'scale(1)',
                }}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(star)}
              >
                ★
              </span>
            ))}
            <span style={styles.ratingText}>
              {displayRating > 0 ? `${displayRating} 星` : '请选择评分'}
            </span>
          </div>
          {errors.rating && (
            <span style={styles.errorText}>{errors.rating}</span>
          )}
        </div>

        <div style={styles.fieldGroup}>
          <label style={styles.label}>评论文本</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="请输入不少于10个汉字的评价内容..."
            rows={4}
            style={{
              ...styles.textarea,
              borderColor: errors.comment ? '#ff6b6b' : '#3a3a5e',
            }}
          />
          {errors.comment && (
            <span style={styles.errorText}>{errors.comment}</span>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          style={{
            ...styles.submitBtn,
            opacity: submitting ? 0.7 : 1,
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
          className="submit-btn-hover"
        >
          {submitting ? '提交中...' : '提交评价'}
        </button>
      </form>

      <style>{submitBtnCSS}</style>
    </div>
  );
};

const submitBtnCSS = `
  .submit-btn-hover:hover {
    transform: scale(1.05) !important;
    background-color: #ff9500 !important;
  }
`;

const starAnimationCSS = `
  @keyframes starPulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1.15); }
  }
`;

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#2a2a3e',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
  },
  heading: {
    fontSize: '20px',
    fontWeight: 600,
    color: '#ffb347',
    marginBottom: '20px',
    marginTop: 0,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#b0b0c0',
  },
  input: {
    padding: '10px 14px',
    borderRadius: '12px',
    border: '1px solid #3a3a5e',
    backgroundColor: '#1e1e2e',
    color: '#e0e0e0',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  },
  textarea: {
    padding: '10px 14px',
    borderRadius: '12px',
    border: '1px solid #3a3a5e',
    backgroundColor: '#1e1e2e',
    color: '#e0e0e0',
    fontSize: '15px',
    outline: 'none',
    resize: 'vertical',
    transition: 'border-color 0.2s ease',
    fontFamily: 'inherit',
  },
  starsContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  star: {
    fontSize: '28px',
    userSelect: 'none',
  },
  ratingText: {
    marginLeft: '10px',
    fontSize: '14px',
    color: '#8888aa',
  },
  submitBtn: {
    padding: '12px 24px',
    borderRadius: '12px',
    border: 'none',
    backgroundColor: '#ffb347',
    color: '#1e1e2e',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform 0.2s ease, background-color 0.2s ease',
    boxShadow: '0 2px 8px rgba(255,179,71,0.3)',
  },
  errorText: {
    fontSize: '13px',
    color: '#ff6b6b',
    marginTop: '2px',
  },
};

export default EvaluationForm;
