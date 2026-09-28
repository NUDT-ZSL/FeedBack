import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Upload,
  ArrowLeft,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import { useAppState, authHeaders } from '../App';
import { Work } from '../types';

export default function CreateWork() {
  const navigate = useNavigate();
  const { state, dispatch } = useAppState();
  const currentUser = state.currentUser;

  const [formData, setFormData] = useState({
    title: '',
    series: '',
    scale: '',
    material: '',
    story: '',
    forSale: false,
    imageUrls: [''],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImageUrlChange = (index: number, value: string) => {
    const newUrls = [...formData.imageUrls];
    newUrls[index] = value;
    setFormData({ ...formData, imageUrls: newUrls });
  };

  const addImageUrl = () => {
    setFormData({ ...formData, imageUrls: [...formData.imageUrls, ''] });
  };

  const removeImageUrl = (index: number) => {
    if (formData.imageUrls.length <= 1) return;
    const newUrls = formData.imageUrls.filter((_, i) => i !== index);
    setFormData({ ...formData, imageUrls: newUrls });
  };

  const validImageUrls = formData.imageUrls.filter((url) => url.trim() !== '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!currentUser) {
        throw new Error('请先登录');
      }

      if (!formData.title.trim()) {
        throw new Error('请输入作品名称');
      }

      if (validImageUrls.length === 0) {
        throw new Error('请至少添加一张作品图片');
      }

      const payload = {
        artistId: currentUser?.id,
        title: formData.title,
        series: formData.series,
        scale: formData.scale,
        material: formData.material,
        images: validImageUrls,
        story: formData.story,
        forSale: formData.forSale,
      };

      const response = await fetch('/api/works', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('发布失败，请重试');
      }

      const newWork: Work = await response.json();
      dispatch({ type: 'ADD_WORK', payload: newWork });
      navigate(`/artist/${currentUser?.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (currentUser) {
      navigate(`/artist/${currentUser?.id}`);
    } else {
      navigate('/home');
    }
  };

  return (
    <div className="min-h-screen bg-ivory">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="max-w-2xl mx-auto px-4 py-8"
      >
        <button
          onClick={handleBack}
          className="inline-flex items-center gap-2 text-forest-700 hover:text-copper-600 transition-colors mb-6 group"
        >
          <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
          <span className="font-medium">返回</span>
        </button>

        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold text-forest-800 mb-2">
            发布新作品
          </h1>
          <p className="text-charcoal/60">分享你的微缩创作故事</p>
        </div>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6"
          >
            {error}
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl shadow-md p-6"
          >
            <h2 className="font-display text-xl font-bold text-forest-800 mb-6">
              基本信息
            </h2>

            <div className="space-y-5">
              <div>
                <label className="block text-charcoal font-medium mb-2">
                  作品名称 <span className="text-copper-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                  className="w-full px-4 py-3 border-2 border-forest-200 rounded-xl focus:outline-none focus:border-copper-400 focus:ring-0 transition-colors"
                  placeholder="输入作品名称"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-charcoal font-medium mb-2">
                    系列名称
                  </label>
                  <input
                    type="text"
                    value={formData.series}
                    onChange={(e) =>
                      setFormData({ ...formData, series: e.target.value })
                    }
                    className="w-full px-4 py-3 border-2 border-forest-200 rounded-xl focus:outline-none focus:border-copper-400 focus:ring-0 transition-colors"
                    placeholder="如：末日废墟系列"
                  />
                </div>
                <div>
                  <label className="block text-charcoal font-medium mb-2">
                    比例尺
                  </label>
                  <input
                    type="text"
                    value={formData.scale}
                    onChange={(e) =>
                      setFormData({ ...formData, scale: e.target.value })
                    }
                    className="w-full px-4 py-3 border-2 border-forest-200 rounded-xl focus:outline-none focus:border-copper-400 focus:ring-0 transition-colors"
                    placeholder="如：1:35"
                  />
                </div>
              </div>

              <div>
                <label className="block text-charcoal font-medium mb-2">
                  材质
                </label>
                <input
                  type="text"
                  value={formData.material}
                  onChange={(e) =>
                    setFormData({ ...formData, material: e.target.value })
                  }
                  className="w-full px-4 py-3 border-2 border-forest-200 rounded-xl focus:outline-none focus:border-copper-400 focus:ring-0 transition-colors"
                  placeholder="如：树脂、石膏、铜丝"
                />
              </div>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-xl shadow-md p-6"
          >
            <h2 className="font-display text-xl font-bold text-forest-800 mb-6">
              作品图片
            </h2>

            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {formData.imageUrls.map((url, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: 'auto', marginBottom: 12 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.25 }}
                    className="flex items-center gap-3 overflow-hidden"
                  >
                    <div className="relative flex-1">
                      <ImageIcon
                        size={18}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-forest-400"
                      />
                      <input
                        type="text"
                        value={url}
                        onChange={(e) =>
                          handleImageUrlChange(index, e.target.value)
                        }
                        className="w-full pl-10 pr-4 py-3 border-2 border-forest-200 rounded-xl focus:outline-none focus:border-copper-400 focus:ring-0 transition-colors"
                        placeholder="输入图片 URL"
                      />
                    </div>
                    <motion.button
                      type="button"
                      onClick={() => removeImageUrl(index)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      disabled={formData.imageUrls.length <= 1}
                      className="p-3 text-charcoal/50 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <Trash2 size={18} />
                    </motion.button>
                  </motion.div>
                ))}
              </AnimatePresence>

              <motion.button
                type="button"
                onClick={addImageUrl}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-forest-200 text-forest-600 rounded-xl hover:border-copper-400 hover:text-copper-600 hover:bg-copper-50/30 transition-colors"
              >
                <Plus size={18} />
                <span className="font-medium">添加图片</span>
              </motion.button>
            </div>

            {validImageUrls.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 grid grid-cols-3 sm:grid-cols-4 gap-3"
              >
                {validImageUrls.map((url, index) => (
                  <div
                    key={index}
                    className="aspect-square rounded-lg overflow-hidden border-2 border-forest-100 bg-forest-50"
                  >
                    <img
                      src={url}
                      alt={`预览 ${index + 1}`}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                ))}
              </motion.div>
            )}
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-xl shadow-md p-6"
          >
            <h2 className="font-display text-xl font-bold text-forest-800 mb-6">
              创作故事
            </h2>

            <div>
              <textarea
                value={formData.story}
                onChange={(e) =>
                  setFormData({ ...formData, story: e.target.value })
                }
                rows={5}
                className="w-full px-4 py-3 border-2 border-forest-200 rounded-xl focus:outline-none focus:border-copper-400 focus:ring-0 transition-colors resize-none"
                placeholder="描述你的创作灵感、制作过程和故事背景..."
              />
              <p className="text-right text-sm text-charcoal/40 mt-2">
                {formData.story.length} 字
              </p>
            </div>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-xl shadow-md p-6"
          >
            <h2 className="font-display text-xl font-bold text-forest-800 mb-6">
              设置
            </h2>

            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                id="forSale"
                checked={formData.forSale}
                onChange={(e) =>
                  setFormData({ ...formData, forSale: e.target.checked })
                }
                className="w-5 h-5 mt-0.5 accent-copper-500 cursor-pointer"
              />
              <div>
                <label
                  htmlFor="forSale"
                  className="text-charcoal font-medium cursor-pointer"
                >
                  此作品可出售
                </label>
                <p className="text-sm text-charcoal/50 mt-1">
                  勾选后该作品将在展览中显示可购买标识
                </p>
              </div>
            </div>
          </motion.section>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.02 }}
              whileTap={{ scale: loading ? 1 : 0.98 }}
              className="w-full md:w-auto md:px-12 py-4 bg-copper-500 text-ivory font-bold rounded-xl shadow-lg hover:bg-copper-600 hover:shadow-copper-500/30 hover:shadow-xl transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 text-lg"
            >
              {loading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  <span>发布中...</span>
                </>
              ) : (
                <>
                  <Upload size={20} />
                  <span>发布作品</span>
                </>
              )}
            </motion.button>
          </motion.div>
        </form>
      </motion.div>
    </div>
  );
}
