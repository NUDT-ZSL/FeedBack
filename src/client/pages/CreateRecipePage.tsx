import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Minus,
  ChevronUp,
  ChevronDown,
  Star,
  Clock,
  Tag,
  Image,
  ChefHat,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../store/AppContext';
import { cn } from '@/lib/utils';
import type { Ingredient, Step } from '../types';

const AVAILABLE_TAGS = [
  '川菜',
  '家常菜',
  '甜点',
  '快手菜',
  '下饭菜',
  '烘焙',
  '汤羹',
  '凉菜',
];

interface IngredientInput extends Omit<Ingredient, 'id'> {
  id: string;
}

interface StepInput extends Omit<Step, 'id'> {
  id: string;
}

let ingredientIdCounter = 0;
let stepIdCounter = 0;

const generateIngredientId = () => `ing-${++ingredientIdCounter}`;
const generateStepId = () => `step-${++stepIdCounter}`;

export default function CreateRecipePage() {
  const navigate = useNavigate();
  const { token, isAuthenticated } = useAuth();

  const [title, setTitle] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [cookTime, setCookTime] = useState<number>(30);
  const [difficulty, setDifficulty] = useState<number>(3);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { id: generateIngredientId(), name: '', quantity: 0, unit: '克' },
  ]);
  const [steps, setSteps] = useState<StepInput[]>([
    { id: generateStepId(), order: 1, description: '' },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const validateForm = useCallback(() => {
    const newErrors: Record<string, string> = {};

    if (!title.trim()) {
      newErrors.title = '请输入菜谱标题';
    }

    const validIngredients = ingredients.filter(
      (ing) => ing.name.trim() && ing.quantity > 0
    );
    if (validIngredients.length === 0) {
      newErrors.ingredients = '请至少添加一种食材';
    }

    const validSteps = steps.filter((step) => step.description.trim());
    if (validSteps.length === 0) {
      newErrors.steps = '请至少添加一个步骤';
    }

    if (cookTime <= 0) {
      newErrors.cookTime = '请输入有效的烹饪时间';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [title, ingredients, steps, cookTime]);

  const handleAddIngredient = () => {
    setIngredients((prev) => [
      ...prev,
      { id: generateIngredientId(), name: '', quantity: 0, unit: '克' },
    ]);
  };

  const handleRemoveIngredient = (id: string) => {
    if (ingredients.length > 1) {
      setIngredients((prev) => prev.filter((ing) => ing.id !== id));
    }
  };

  const handleUpdateIngredient = (
    id: string,
    field: keyof IngredientInput,
    value: string | number
  ) => {
    setIngredients((prev) =>
      prev.map((ing) => (ing.id === id ? { ...ing, [field]: value } : ing))
    );
  };

  const handleAddStep = () => {
    setSteps((prev) => [
      ...prev,
      { id: generateStepId(), order: prev.length + 1, description: '' },
    ]);
  };

  const handleRemoveStep = (id: string) => {
    if (steps.length > 1) {
      setSteps((prev) => {
        const filtered = prev.filter((step) => step.id !== id);
        return filtered.map((step, index) => ({ ...step, order: index + 1 }));
      });
    }
  };

  const handleUpdateStep = (id: string, description: string) => {
    setSteps((prev) =>
      prev.map((step) =>
        step.id === id ? { ...step, description } : step
      )
    );
  };

  const handleMoveStepUp = (index: number) => {
    if (index > 0) {
      setSteps((prev) => {
        const newSteps = [...prev];
        [newSteps[index - 1], newSteps[index]] = [
          newSteps[index],
          newSteps[index - 1],
        ];
        return newSteps.map((step, i) => ({ ...step, order: i + 1 }));
      });
    }
  };

  const handleMoveStepDown = (index: number) => {
    if (index < steps.length - 1) {
      setSteps((prev) => {
        const newSteps = [...prev];
        [newSteps[index], newSteps[index + 1]] = [
          newSteps[index + 1],
          newSteps[index],
        ];
        return newSteps.map((step, i) => ({ ...step, order: i + 1 }));
      });
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    if (!token || !isAuthenticated) {
      navigate('/login');
      return;
    }

    setIsSubmitting(true);

    try {
      const validIngredients = ingredients
        .filter((ing) => ing.name.trim() && ing.quantity > 0)
        .map((ing) => ({
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
        }));

      const validSteps = steps
        .filter((step) => step.description.trim())
        .map((step) => ({
          order: step.order,
          description: step.description,
          imageUrl: step.imageUrl,
        }));

      const response = await fetch('/api/recipe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: title.trim(),
          coverImage: coverImage.trim(),
          ingredients: validIngredients,
          steps: validSteps,
          cookTime,
          difficulty,
          tags: selectedTags,
        }),
      });

      const data = await response.json();

      if (data.success && data.data) {
        setShowSuccess(true);
        setTimeout(() => {
          navigate(`/recipe/${data.data.id}`);
        }, 1500);
      } else {
        setErrors({ submit: data.error || '发布失败，请重试' });
      }
    } catch {
      setErrors({ submit: '网络错误，请稍后重试' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate(-1);
  };

  return (
    <div className="min-h-screen bg-cream-50 pt-20 pb-12">
      {showSuccess && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-fade-in-up">
          <div className="bg-forest-500 text-white px-6 py-3 rounded-xl shadow-card-hover flex items-center gap-2">
            <ChefHat className="w-5 h-5" />
            <span className="font-medium">菜谱发布成功！正在跳转...</span>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <div className="mb-6">
          <button
            onClick={handleCancel}
            className="flex items-center gap-2 text-brown-500 hover:text-brown-700 transition-colors duration-200"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>返回</span>
          </button>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-brown-700 font-display mb-2">
            创建新菜谱
          </h1>
          <p className="text-brown-400">分享你的美味食谱</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-white rounded-2xl shadow-card p-6 space-y-6">
            <h2 className="text-xl font-semibold text-brown-600 font-display flex items-center gap-2">
              <ChefHat className="w-5 h-5" />
              基本信息
            </h2>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-brown-600">
                菜谱标题
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：红烧五花肉"
                className={cn(
                  'w-full px-4 py-3 rounded-xl border-2 bg-cream-50',
                  'text-brown-700 placeholder-brown-300',
                  'transition-all duration-200',
                  'focus:outline-none focus:ring-0 focus:border-forest-500',
                  errors.title ? 'border-accent-red' : 'border-brown-200'
                )}
              />
              {errors.title && (
                <p className="text-sm text-accent-red">{errors.title}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-brown-600 flex items-center gap-2">
                <Image className="w-4 h-4" />
                封面图片 URL
              </label>
              <input
                type="text"
                value={coverImage}
                onChange={(e) => setCoverImage(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className={cn(
                  'w-full px-4 py-3 rounded-xl border-2 bg-cream-50',
                  'text-brown-700 placeholder-brown-300',
                  'transition-all duration-200',
                  'focus:outline-none focus:ring-0 focus:border-forest-500',
                  'border-brown-200'
                )}
              />
              {coverImage && (
                <div className="mt-3 aspect-video rounded-xl overflow-hidden bg-brown-100 border-2 border-brown-200">
                  <img
                    src={coverImage}
                    alt="封面预览"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-card p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-brown-600 font-display flex items-center gap-2">
                <Tag className="w-5 h-5" />
                食材清单
              </h2>
              <button
                type="button"
                onClick={handleAddIngredient}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-forest-600 bg-forest-50 rounded-lg hover:bg-forest-100 transition-colors duration-200"
              >
                <Plus className="w-4 h-4" />
                添加食材
              </button>
            </div>

            {errors.ingredients && (
              <p className="text-sm text-accent-red">{errors.ingredients}</p>
            )}

            <div className="space-y-3">
              {ingredients.map((ingredient, index) => (
                <div
                  key={ingredient.id}
                  className="flex items-center gap-3 animate-fade-in-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <span className="text-sm text-brown-400 w-6 text-center">
                    {index + 1}.
                  </span>
                  <input
                    type="text"
                    value={ingredient.name}
                    onChange={(e) =>
                      handleUpdateIngredient(ingredient.id, 'name', e.target.value)
                    }
                    placeholder="食材名称"
                    className={cn(
                      'flex-1 px-3 py-2 rounded-lg border-2 bg-cream-50',
                      'text-brown-700 placeholder-brown-300 text-sm',
                      'transition-all duration-200',
                      'focus:outline-none focus:ring-0 focus:border-forest-500',
                      'border-brown-200'
                    )}
                  />
                  <input
                    type="number"
                    value={ingredient.quantity || ''}
                    onChange={(e) =>
                      handleUpdateIngredient(
                        ingredient.id,
                        'quantity',
                        parseFloat(e.target.value) || 0
                      )
                    }
                    placeholder="0"
                    className={cn(
                      'w-20 px-3 py-2 rounded-lg border-2 bg-cream-50',
                      'text-brown-700 placeholder-brown-300 text-sm text-right',
                      'transition-all duration-200',
                      'focus:outline-none focus:ring-0 focus:border-forest-500',
                      'border-brown-200'
                    )}
                  />
                  <select
                    value={ingredient.unit}
                    onChange={(e) =>
                      handleUpdateIngredient(ingredient.id, 'unit', e.target.value)
                    }
                    className={cn(
                      'px-3 py-2 rounded-lg border-2 bg-cream-50',
                      'text-brown-700 text-sm',
                      'transition-all duration-200',
                      'focus:outline-none focus:ring-0 focus:border-forest-500',
                      'border-brown-200'
                    )}
                  >
                    <option value="克">克</option>
                    <option value="毫升">毫升</option>
                    <option value="个">个</option>
                    <option value="勺">勺</option>
                    <option value="茶匙">茶匙</option>
                    <option value="汤匙">汤匙</option>
                    <option value="适量">适量</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleRemoveIngredient(ingredient.id)}
                    disabled={ingredients.length <= 1}
                    className={cn(
                      'p-2 rounded-lg transition-colors duration-200',
                      ingredients.length <= 1
                        ? 'text-brown-200 cursor-not-allowed'
                        : 'text-brown-400 hover:text-accent-red hover:bg-cream-100'
                    )}
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-card p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-brown-600 font-display flex items-center gap-2">
                <ChefHat className="w-5 h-5" />
                烹饪步骤
              </h2>
              <button
                type="button"
                onClick={handleAddStep}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-forest-600 bg-forest-50 rounded-lg hover:bg-forest-100 transition-colors duration-200"
              >
                <Plus className="w-4 h-4" />
                添加步骤
              </button>
            </div>

            {errors.steps && (
              <p className="text-sm text-accent-red">{errors.steps}</p>
            )}

            <div className="space-y-4">
              {steps.map((step, index) => (
                <div
                  key={step.id}
                  className="flex gap-3 animate-fade-in-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-8 h-8 rounded-full bg-forest-500 text-white flex items-center justify-center text-sm font-medium">
                      {step.order}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => handleMoveStepUp(index)}
                        disabled={index === 0}
                        className={cn(
                          'p-1 rounded transition-colors duration-200',
                          index === 0
                            ? 'text-brown-200 cursor-not-allowed'
                            : 'text-brown-400 hover:text-forest-500 hover:bg-cream-100'
                        )}
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveStepDown(index)}
                        disabled={index === steps.length - 1}
                        className={cn(
                          'p-1 rounded transition-colors duration-200',
                          index === steps.length - 1
                            ? 'text-brown-200 cursor-not-allowed'
                            : 'text-brown-400 hover:text-forest-500 hover:bg-cream-100'
                        )}
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 flex gap-2">
                    <textarea
                      value={step.description}
                      onChange={(e) =>
                        handleUpdateStep(step.id, e.target.value)
                      }
                      placeholder="描述这个步骤..."
                      rows={3}
                      className={cn(
                        'flex-1 px-4 py-3 rounded-xl border-2 bg-cream-50 resize-none',
                        'text-brown-700 placeholder-brown-300 text-sm',
                        'transition-all duration-200',
                        'focus:outline-none focus:ring-0 focus:border-forest-500',
                        'border-brown-200'
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveStep(step.id)}
                      disabled={steps.length <= 1}
                      className={cn(
                        'p-2 h-fit rounded-lg transition-colors duration-200',
                        steps.length <= 1
                          ? 'text-brown-200 cursor-not-allowed'
                          : 'text-brown-400 hover:text-accent-red hover:bg-cream-100'
                      )}
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-card p-6 space-y-6">
            <h2 className="text-xl font-semibold text-brown-600 font-display flex items-center gap-2">
              <Clock className="w-5 h-5" />
              烹饪信息
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-brown-600">
                  烹饪时间
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={cookTime}
                    onChange={(e) =>
                      setCookTime(parseInt(e.target.value) || 0)
                    }
                    min={1}
                    className={cn(
                      'flex-1 px-4 py-3 rounded-xl border-2 bg-cream-50',
                      'text-brown-700',
                      'transition-all duration-200',
                      'focus:outline-none focus:ring-0 focus:border-forest-500',
                      errors.cookTime ? 'border-accent-red' : 'border-brown-200'
                    )}
                  />
                  <span className="text-brown-500 font-medium">分钟</span>
                </div>
                {errors.cookTime && (
                  <p className="text-sm text-accent-red">{errors.cookTime}</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-brown-600">
                  难度等级
                </label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setDifficulty(star)}
                      className="p-1 transition-transform duration-200 hover:scale-110 active:scale-95"
                    >
                      <Star
                        className={cn(
                          'w-7 h-7 transition-colors duration-200',
                          star <= difficulty
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-brown-200'
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-card p-6 space-y-6">
            <h2 className="text-xl font-semibold text-brown-600 font-display flex items-center gap-2">
              <Tag className="w-5 h-5" />
              标签分类
            </h2>

            <div className="flex flex-wrap gap-2">
              {AVAILABLE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleTagToggle(tag)}
                  className={cn(
                    'px-4 py-2 rounded-full text-sm font-medium',
                    'transition-all duration-200',
                    'border-2',
                    selectedTags.includes(tag)
                      ? 'bg-forest-500 text-white border-forest-500'
                      : 'bg-cream-50 text-brown-500 border-brown-200 hover:border-forest-300'
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {errors.submit && (
            <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-4 text-accent-red text-center">
              {errors.submit}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            <button
              type="button"
              onClick={handleCancel}
              className={cn(
                'flex-1 py-4 rounded-xl font-semibold text-lg',
                'transition-all duration-200',
                'bg-cream-100 text-brown-500',
                'hover:bg-cream-200',
                'active:scale-[0.98]'
              )}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                'flex-1 py-4 rounded-xl font-semibold text-lg',
                'transition-all duration-200',
                'bg-forest-500 text-white',
                'hover:bg-forest-600',
                'active:scale-[0.98]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'shadow-lg shadow-forest-500/20'
              )}
            >
              {isSubmitting ? '发布中...' : '发布菜谱'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
