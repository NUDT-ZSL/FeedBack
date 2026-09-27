import { ChefHat } from 'lucide-react';

export default function KitchenPage() {
  return (
    <div className="min-h-screen bg-cream-50 pt-20 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center py-16 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-forest-500 mb-6 shadow-lg shadow-forest-500/20">
            <ChefHat className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-brown-700 font-display mb-4">
            我的厨房
          </h1>
          <p className="text-brown-400 text-lg">
            管理你的菜谱和收藏
          </p>
        </div>
      </div>
    </div>
  );
}
