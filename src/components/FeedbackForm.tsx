import { useState, useRef, useCallback } from 'react';
import { FaImage, FaPaperPlane, FaTimes, FaCheckCircle } from 'react-icons/fa';

interface FeedbackFormProps {
  taskId: string;
  taskTitle: string;
  onSubmit: (taskId: string, data: { description: string; imageUrl?: string }) => void;
  onClose: () => void;
}

const MAX_LENGTH = 500;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

export default function FeedbackForm({ taskId, taskTitle, onSubmit, onClose }: FeedbackFormProps) {
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | undefined>(undefined);
  const [isVisible, setIsVisible] = useState(true);
  const [showThanks, setShowThanks] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    setTimeout(onClose, 300);
  }, [onClose]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(undefined);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setUploadError('仅支持 PNG 或 JPG 格式的图片');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setUploadError('图片大小不能超过 5MB');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const reader = new FileReader();

    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = Math.round((event.loaded / event.total) * 85);
        setUploadProgress(progress);
      }
    };

    reader.onload = () => {
      setTimeout(() => setUploadProgress(100), 120);
      setTimeout(() => {
        setImageUrl(reader.result as string);
        setIsUploading(false);
      }, 320);
    };

    reader.onerror = () => {
      setUploadError('图片读取失败，请重试');
      setIsUploading(false);
      setUploadProgress(0);
    };

    reader.readAsDataURL(file);
  }, []);

  const handleRemoveImage = useCallback(() => {
    setImageUrl(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    onSubmit(taskId, { description: description.trim(), imageUrl });
    setShowThanks(true);
    setTimeout(() => handleClose(), 1600);
  }, [description, imageUrl, taskId, onSubmit, handleClose]);

  const remaining = MAX_LENGTH - description.length;
  const progressColor = isUploading
    ? `linear-gradient(90deg, #E0E0E0 0%, #2196F3 ${uploadProgress}%, #E0E0E0 ${uploadProgress}%)`
    : 'transparent';

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: '12px',
        border: '1px solid #E3F2FD',
        borderTop: '3px solid #2196F3',
        marginTop: '12px',
        padding: '20px',
        transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
        opacity: isVisible ? 1 : 0,
        transition: 'all 0.3s ease-out',
        boxShadow: '0 4px 16px rgba(33,150,243,0.08)',
        overflow: 'hidden',
        willChange: 'transform, opacity'
      }}
    >
      {showThanks ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '18px 10px',
          textAlign: 'center',
          animation: 'fadeIn 0.4s ease-out'
        }}>
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: '#E8F5E9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '12px'
          }}>
            <FaCheckCircle color="#2E7D32" size={28} />
          </div>
          <h4 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 600, color: '#2E7D32' }}>
            感谢您的反馈！
          </h4>
          <p style={{ margin: 0, fontSize: '13.5px', color: '#666', lineHeight: 1.55 }}>
            您的付出让社区变得更美好 ❤️
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#333' }}>
              提交反馈 — {taskTitle}
            </h4>
            <button
              onClick={handleClose}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '6px',
                borderRadius: '8px',
                color: '#999',
                cursor: 'pointer',
                display: 'flex',
                transition: 'all 0.2s ease-out'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#F5F5F5'; e.currentTarget.style.color = '#666'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#999'; }}
            >
              <FaTimes size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: '13.5px',
                fontWeight: 500,
                color: '#444',
                marginBottom: '8px'
              }}>
                服务描述 <span style={{ color: '#E53935' }}>*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.length <= MAX_LENGTH) setDescription(val);
                }}
                placeholder="请详细描述您完成服务的过程、感受和成果（例如：为3位老人提供了手机教学，教会他们使用微信视频通话...）"
                rows={5}
                maxLength={MAX_LENGTH}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1.5px solid #E0E0E0',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  resize: 'vertical',
                  minHeight: '110px',
                  fontFamily: 'inherit',
                  color: '#333',
                  outline: 'none',
                  transition: 'border-color 0.2s ease-out, box-shadow 0.2s ease-out',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = '#2196F3';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(33,150,243,0.12)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = '#E0E0E0';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '6px',
                fontSize: '12px',
                color: remaining <= 50 ? remaining <= 0 ? '#E53935' : '#FF9800' : '#999',
                fontWeight: 500,
                transition: 'color 0.2s ease-out'
              }}>
                {remaining} / {MAX_LENGTH}
              </div>
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '13.5px',
                fontWeight: 500,
                color: '#444',
                marginBottom: '8px'
              }}>
                现场照片（可选）
              </label>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />

              {imageUrl ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={imageUrl}
                    alt="预览"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '200px',
                      borderRadius: '10px',
                      border: '1.5px solid #E0E0E0',
                      objectFit: 'cover',
                      display: 'block'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    style={{
                      position: 'absolute',
                      top: '-10px',
                      right: '-10px',
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: '#E53935',
                      color: '#fff',
                      border: '2px solid #fff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(229,57,53,0.3)',
                      transition: 'transform 0.2s ease-out'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                  >
                    <FaTimes size={12} />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    style={{
                      width: '100%',
                      padding: '18px',
                      borderRadius: '10px',
                      border: '2px dashed #BDBDBD',
                      background: isUploading ? '#FAFAFA' : '#FBFDFF',
                      color: isUploading ? '#999' : '#666',
                      fontSize: '14px',
                      cursor: isUploading ? 'wait' : 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.25s ease-out'
                    }}
                    onMouseEnter={(e) => {
                      if (!isUploading) {
                        e.currentTarget.style.borderColor = '#2196F3';
                        e.currentTarget.style.color = '#2196F3';
                        e.currentTarget.style.background = '#F5FAFF';
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#BDBDBD';
                      e.currentTarget.style.color = isUploading ? '#999' : '#666';
                      e.currentTarget.style.background = isUploading ? '#FAFAFA' : '#FBFDFF';
                    }}
                  >
                    <FaImage size={22} />
                    <span>
                      {isUploading ? `上传中 ${uploadProgress}%...` : '点击上传图片（PNG/JPG，≤5MB）'}
                    </span>
                  </button>

                  {isUploading && (
                    <div style={{
                      marginTop: '12px',
                      height: '8px',
                      borderRadius: '4px',
                      background: '#E0E0E0',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        height: '100%',
                        background: progressColor,
                        transition: 'background 0.2s linear',
                        borderRadius: '4px'
                      }} />
                    </div>
                  )}
                </>
              )}

              {uploadError && (
                <p style={{
                  margin: '10px 0 0',
                  fontSize: '12.5px',
                  color: '#E53935',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  animation: 'fadeIn 0.25s ease-out'
                }}>
                  ⚠️ {uploadError}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={handleClose}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1.5px solid #E0E0E0',
                  background: '#FAFAFA',
                  color: '#555',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-out'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#F0F0F0'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#FAFAFA'; }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={!description.trim()}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  background: description.trim() ? '#2196F3' : '#BDBDBD',
                  color: '#fff',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: description.trim() ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.25s ease-out'
                }}
                onMouseEnter={(e) => { if (description.trim()) { e.currentTarget.style.filter = 'brightness(1.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <FaPaperPlane size={13} />
                提交反馈
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
