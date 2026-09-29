import { useState } from 'react'
import { Upload, X, Music, FileAudio, CheckCircle } from 'lucide-react'
import { STYLE_TAGS, addWork } from '../data/mockData'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'

export default function UploadPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [selectedStyles, setSelectedStyles] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadComplete, setUploadComplete] = useState(false)

  const maxDescriptionLength = 300

  const toggleStyle = (style: string) => {
    setSelectedStyles(prev =>
      prev.includes(style)
        ? prev.filter(s => s !== style)
        : [...prev, style]
    )
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.mp3')) {
      toast.error('请上传 MP3 格式的音频文件')
      return
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error('文件大小不能超过 20MB')
      return
    }

    setFileName(file.name)
    setIsUploading(true)
    setUploadProgress(0)
    setUploadComplete(false)

    let progress = 0
    const interval = setInterval(() => {
      progress += Math.random() * 8 + 2
      if (progress >= 100) {
        progress = 100
        clearInterval(interval)
        setIsUploading(false)
        setUploadComplete(true)
        toast.success('音频上传成功')
      }
      setUploadProgress(progress)
    }, 200)
  }

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error('请填写作品名称')
      return
    }
    if (selectedStyles.length === 0) {
      toast.error('请至少选择一个风格标签')
      return
    }
    if (!uploadComplete) {
      toast.error('请等待音频上传完成')
      return
    }
    if (!description.trim()) {
      toast.error('请填写作品简介')
      return
    }

    const newWork = addWork(title, selectedStyles, description)
    toast.success('作品发布成功！')
    navigate(`/work/${newWork.id}`)
  }

  const clearFile = () => {
    setFileName('')
    setUploadProgress(0)
    setIsUploading(false)
    setUploadComplete(false)
  }

  const progressGradient = `linear-gradient(90deg, 
    hsl(${220 + uploadProgress * 0.8}, 80%, 60%) 0%, 
    hsl(${280 + uploadProgress * 0.3}, 70%, 55%) 50%,
    hsl(${330 + uploadProgress * 0.1}, 80%, 60%) 100%)`

  return (
    <div className="max-w-2xl mx-auto animate-fadeIn">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2">发布新作品</h2>
        <p className="text-white/60">上传你的音乐作品，让更多人听到你的声音</p>
      </div>

      <div className="space-y-6">
        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <label className="block text-sm font-medium mb-2">作品名称</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入你的作品名称"
            maxLength={50}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition-all duration-300"
          />
          <p className="text-xs text-white/40 mt-1 text-right">{title.length}/50</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <label className="block text-sm font-medium mb-3">风格标签</label>
          <div className="flex flex-wrap gap-3">
            {STYLE_TAGS.map((style) => {
              const isSelected = selectedStyles.includes(style)
              return (
                <button
                  key={style}
                  onClick={() => toggleStyle(style)}
                  className="px-5 py-2 rounded-full text-sm font-medium transition-all duration-200 ease-out"
                  style={{
                    backgroundColor: isSelected ? 'rgba(233, 69, 96, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    color: isSelected ? '#E94560' : 'rgba(255, 255, 255, 0.7)',
                    border: isSelected ? '1px solid rgba(233, 69, 96, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                    transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                    transition: 'all 0.2s ease-out',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = 'scale(1.1)'
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
                      e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.transform = 'scale(1)'
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'
                      e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)'
                    }
                  }}
                >
                  {style}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-white/40 mt-3">选择 1-3 个最适合的风格标签</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <label className="block text-sm font-medium mb-2">作品简介</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, maxDescriptionLength))}
            placeholder="介绍一下你的作品吧..."
            rows={4}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 resize-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition-all duration-300"
          />
          <p className="text-xs text-white/40 mt-1 text-right">{description.length}/{maxDescriptionLength}</p>
        </div>

        <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
          <label className="block text-sm font-medium mb-3">音频文件</label>

          {!fileName ? (
            <label className="block">
              <div className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center cursor-pointer hover:border-pink-500/50 hover:bg-white/5 transition-all duration-300">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center">
                  <Upload size={28} className="text-pink-400" />
                </div>
                <p className="text-white/80 mb-1">点击上传音频文件</p>
                <p className="text-sm text-white/40">支持 MP3 格式，最大 20MB</p>
              </div>
              <input
                type="file"
                accept=".mp3,audio/mpeg"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <FileAudio size={20} className="text-pink-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{fileName}</p>
                  <p className="text-xs text-white/50">MP3 格式</p>
                </div>
                {uploadComplete ? (
                  <CheckCircle size={20} className="text-green-400" />
                ) : (
                  <button
                    onClick={clearFile}
                    className="p-1 text-white/40 hover:text-white/70 transition-colors"
                  >
                    <X size={18} />
                  </button>
                )}
              </div>

              {isUploading && (
                <div className="space-y-2">
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-200"
                      style={{
                        width: `${uploadProgress}%`,
                        background: progressGradient,
                        boxShadow: '0 0 10px rgba(67, 97, 238, 0.5)',
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-white/50">上传中...</span>
                    <span className="text-pink-400 font-medium">{Math.round(uploadProgress)}%</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={isUploading}
          className="w-full py-4 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl text-white font-semibold hover:shadow-[0_0_30px_rgba(233,69,96,0.4)] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Music size={20} />
          <span>发布作品</span>
        </button>
      </div>
    </div>
  )
}
