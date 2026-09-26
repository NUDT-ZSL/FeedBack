import { useEffect, useState, useRef, useCallback } from 'react';
import { Upload, X, Send, ImagePlus, Smile, Meh, Zap, AlertCircle, Moon } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Diary, Mood, MOOD_LABELS, MOOD_COLORS, Pet } from '../types';

const moodIcons: Record<Mood, React.ReactNode> = {
  happy: <Smile size={18} />,
  normal: <Meh size={18} />,
  playful: <Zap size={18} />,
  sick: <AlertCircle size={18} />,
  sleepy: <Moon size={18} />
};

function DiaryList() {
  const { state, fetchDiaries, addDiary, fetchPets } = useApp();
  const observerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedImages, setSelectedImages] = useState<{ file: File; preview: string }[]>([]);
  const [content, setContent] = useState('');
  const [selectedMood, setSelectedMood] = useState<Mood>('happy');
  const [selectedPet, setSelectedPet] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [visibleItems, setVisibleItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchPets();
    fetchDiaries(1, false);
  }, [fetchPets, fetchDiaries]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          const id = entry.target.getAttribute('data-id');
          if (id) {
            if (entry.isIntersecting) {
              setVisibleItems(prev => new Set([...prev, id]));
            } else {
              setVisibleItems(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }
          }
        });
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    document.querySelectorAll('[data-id]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [state.diaries]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && state.hasMoreDiaries && !state.diariesLoading) {
          fetchDiaries(state.currentPage + 1, true);
        }
      },
      { threshold: 0.1 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }
    return () => observer.disconnect();
  }, [fetchDiaries, state.hasMoreDiaries, state.diariesLoading, state.currentPage]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = (files: FileList) => {
    const remainingSlots = 3 - selectedImages.length;
    const newFiles = Array.from(files).slice(0, remainingSlots);
    
    newFiles.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setSelectedImages(prev => [...prev, { file, preview: reader.result as string }]);
        };
        reader.readAsDataURL(file);
      }
    });
  };

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !selectedPet || submitting) return;

    const pet = state.pets.find(p => p.id === selectedPet);
    if (!pet) return;

    setSubmitting(true);
    const formData = new FormData();
    formData.append('petId', selectedPet);
    formData.append('petName', pet.name);
    formData.append('content', content);
    formData.append('mood', selectedMood);
    selectedImages.forEach(img => formData.append('images', img.file));

    const result = await addDiary(formData);
    setSubmitting(false);

    if (result) {
      setContent('');
      setSelectedImages([]);
      setSelectedMood('happy');
      setSelectedPet('');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.publishCard} className="animate-slide-up">
        <h2 style={styles.sectionTitle}>发布寄养日记</h2>
        
        <form onSubmit={handleSubmit}>
          <div style={styles.petSelectContainer}>
            <label style={styles.label}>选择宠物</label>
            <select
              value={selectedPet}
              onChange={e => setSelectedPet(e.target.value)}
              style={styles.petSelect}
              required
            >
              <option value="">请选择宠物</option>
              {state.pets.map(pet => (
                <option key={pet.id} value={pet.id}>
                  {pet.name} ({pet.breed})
                </option>
              ))}
            </select>
          </div>

          <div style={styles.moodContainer}>
            <label style={styles.label}>心情标签</label>
            <div style={styles.moodOptions}>
              {(Object.keys(MOOD_LABELS) as Mood[]).map(mood => (
                <button
                  key={mood}
                  type="button"
                  style={{
                    ...styles.moodButton,
                    backgroundColor: selectedMood === mood ? MOOD_COLORS[mood] + '20' : 'transparent',
                    borderColor: selectedMood === mood ? MOOD_COLORS[mood] : 'transparent',
                    color: selectedMood === mood ? MOOD_COLORS[mood] : '#8D8D8D'
                  }}
                  onClick={() => setSelectedMood(mood)}
                >
                  {moodIcons[mood]}
                  {MOOD_LABELS[mood]}
                </button>
              ))}
            </div>
          </div>

          <div
            style={{
              ...styles.uploadArea,
              borderColor: isDragging ? '#E67E22' : 'rgba(107, 66, 38, 0.2)',
              backgroundColor: isDragging ? 'rgba(230, 126, 34, 0.05)' : 'transparent'
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {selectedImages.length > 0 ? (
              <div style={styles.imagePreviews}>
                {selectedImages.map((img, idx) => (
                  <div key={idx} style={styles.imagePreview}>
                    <img src={img.preview} alt="" style={styles.previewImg} />
                    <button
                      type="button"
                      style={styles.removeImage}
                      onClick={() => removeImage(idx)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                {selectedImages.length < 3 && (
                  <label style={styles.addMore}>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />
                    <ImagePlus size={24} color="#8D8D8D" />
                    <span style={{ fontSize: 12, color: '#8D8D8D' }}>添加</span>
                  </label>
                )}
              </div>
            ) : (
              <label style={styles.uploadPlaceholder}>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <Upload size={32} color="#8D8D8D" style={{ marginBottom: 8 }} />
                <p style={{ color: '#8D8D8D', fontSize: 14, margin: 0 }}>
                  拖拽图片到此处或点击上传
                </p>
                <p style={{ color: '#A0937D', fontSize: 12, margin: '4px 0 0 0' }}>
                  最多上传3张图片
                </p>
              </label>
            )}
          </div>

          <div style={styles.textareaContainer}>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value.slice(0, 200))}
              placeholder="记录今天毛孩子的状态和心情..."
              style={styles.textarea}
              maxLength={200}
            />
            <span style={styles.charCount}>
              {content.length}/200
            </span>
          </div>

          <button
            type="submit"
            disabled={submitting || !content.trim() || !selectedPet}
            className="button-hover"
            style={{
              ...styles.submitButton,
              opacity: (submitting || !content.trim() || !selectedPet) ? 0.6 : 1
            }}
          >
            <Send size={18} style={{ marginRight: 8 }} />
            {submitting ? '发布中...' : '发布日记'}
          </button>
        </form>
      </div>

      <div style={styles.listHeader}>
        <h2 style={styles.sectionTitle}>日记列表</h2>
        <span style={styles.count}>共 {state.diaries.length} 篇</span>
      </div>

      <div style={styles.diaryList}>
        {state.diaries.map((diary, index) => (
          <DiaryCard
            key={diary.id}
            diary={diary}
            index={index}
            isVisible={visibleItems.has(diary.id)}
            pets={state.pets}
          />
        ))}
      </div>

      {state.diariesLoading && (
        <div style={styles.loadingMore}>加载中...</div>
      )}

      <div ref={observerRef} style={{ height: 20 }} />

      {!state.hasMoreDiaries && state.diaries.length > 0 && (
        <div style={styles.noMore}>—— 已经到底啦 ——</div>
      )}
    </div>
  );
}

function DiaryCard({ 
  diary, 
  index, 
  isVisible,
  pets 
}: { 
  diary: Diary; 
  index: number;
  isVisible: boolean;
  pets: Pet[];
}) {
  const pet = pets.find(p => p.id === diary.petId);
  
  return (
    <div
      data-id={diary.id}
      style={{
        ...styles.diaryCard,
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        opacity: isVisible ? 1 : 0.3,
        transform: isVisible ? 'translateY(0)' : 'translateY(10px)',
        animationDelay: index === 0 ? '0s' : undefined,
        opacity: index === 0 ? undefined : (isVisible ? 1 : 0.3)
      }}
      className={`${index === 0 ? 'animate-slide-up' : ''} card-hover`}
    >
      <div style={styles.cardHeader}>
        <div style={styles.petInfo}>
          {pet && (
            <img src={pet.avatar} alt={pet.name} style={styles.smallAvatar} />
          )}
          <div>
            <span style={styles.petName}>{diary.petName}</span>
            <span 
              style={{
                ...styles.moodBadge,
                backgroundColor: MOOD_COLORS[diary.mood] + '20',
                color: MOOD_COLORS[diary.mood]
              }}
            >
              {moodIcons[diary.mood]}
              {MOOD_LABELS[diary.mood]}
            </span>
          </div>
        </div>
        <span style={styles.date}>
          {new Date(diary.createdAt).toLocaleString('zh-CN')}
        </span>
      </div>

      {diary.images.length > 0 && (
        <div style={styles.cardImages}>
          {diary.images.map((img, i) => (
            <img 
              key={i} 
              src={img} 
              alt="" 
              style={{
                ...styles.cardImage,
                width: diary.images.length === 1 ? '100%' : diary.images.length === 2 ? 'calc(50% - 4px)' : 'calc(33.33% - 6px)'
              }}
              loading="lazy"
            />
          ))}
        </div>
      )}

      <p style={styles.cardContent}>{diary.content}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    maxWidth: 700,
    margin: '0 auto'
  },
  publishCard: {
    backgroundColor: '#FFFCF7',
    borderRadius: 20,
    padding: 28,
    marginBottom: 32,
    boxShadow: '0 2px 12px rgba(107, 66, 38, 0.08)',
    opacity: 0
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 600,
    color: '#3D2914',
    margin: '0 0 20px 0'
  },
  label: {
    display: 'block',
    fontSize: 14,
    fontWeight: 500,
    color: '#3D2914',
    marginBottom: 10
  },
  petSelectContainer: {
    marginBottom: 20
  },
  petSelect: {
    width: '100%',
    padding: '12px 16px',
    border: '1px solid rgba(107, 66, 38, 0.2)',
    borderRadius: 12,
    fontSize: 15,
    backgroundColor: 'white',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif'
  },
  moodContainer: {
    marginBottom: 20
  },
  moodOptions: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap'
  },
  moodButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    border: '2px solid transparent',
    borderRadius: 20,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontFamily: 'Georgia, serif'
  },
  uploadArea: {
    border: '2px dashed rgba(107, 66, 38, 0.2)',
    borderRadius: 16,
    padding: 24,
    marginBottom: 20,
    transition: 'all 0.2s ease',
    minHeight: 120
  },
  uploadPlaceholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: '20px 0'
  },
  imagePreviews: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  imagePreview: {
    position: 'relative',
    width: 100,
    height: 100,
    borderRadius: 12,
    overflow: 'hidden'
  },
  previewImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  removeImage: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: '50%',
    backgroundColor: 'rgba(0,0,0,0.6)',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  addMore: {
    width: 100,
    height: 100,
    borderRadius: 12,
    border: '2px dashed rgba(107, 66, 38, 0.2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    gap: 4,
    transition: 'all 0.2s ease'
  },
  textareaContainer: {
    position: 'relative',
    marginBottom: 20
  },
  textarea: {
    width: '100%',
    minHeight: 100,
    padding: '16px 16px 40px 16px',
    border: '1px solid rgba(107, 66, 38, 0.2)',
    borderRadius: 12,
    fontSize: 15,
    resize: 'vertical',
    fontFamily: 'Georgia, serif',
    lineHeight: 1.6,
    backgroundColor: 'white'
  },
  charCount: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    fontSize: 12,
    color: '#8D8D8D'
  },
  submitButton: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px',
    backgroundColor: '#E67E22',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontFamily: 'Georgia, serif'
  },
  listHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  count: {
    fontSize: 14,
    color: '#8D8D8D'
  },
  diaryList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20
  },
  publishCard: {
    backgroundColor: '#FFFCF7',
    borderRadius: 20,
    padding: 28,
    marginBottom: 32,
    boxShadow: '0 2px 12px rgba(107, 66, 38, 0.08)',
    opacity: 0
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16
  },
  petInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 12
  },
  smallAvatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    objectFit: 'cover'
  },
  petName: {
    display: 'block',
    fontSize: 16,
    fontWeight: 600,
    color: '#3D2914',
    marginBottom: 4
  },
  moodBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 500
  },
  date: {
    fontSize: 12,
    color: '#8D8D8D'
  },
  cardImages: {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 16
  },
  cardImage: {
    height: 180,
    borderRadius: 12,
    objectFit: 'cover',
    cursor: 'pointer',
    transition: 'transform 0.2s ease'
  },
  cardContent: {
    fontSize: 15,
    lineHeight: 1.7,
    color: '#3D2914',
    margin: 0
  },
  loadingMore: {
    textAlign: 'center',
    padding: '20px 0',
    color: '#8D8D8D',
    fontSize: 14
  },
  noMore: {
    textAlign: 'center',
    padding: '30px 0',
    color: '#A0937D',
    fontSize: 13
  }
};

export default DiaryList;
