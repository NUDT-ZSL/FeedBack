import { useParams } from 'react-router-dom';
import { ChefHat, Clock, Star } from 'lucide-react';

export default function RecipeDetail() {
  const { id } = useParams();

  return (
    <div className="min-h-screen bg-cream-50 pt-20 pb-12">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="text-center py-16 animate-fade-in-up">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-brown-500 mb-6 shadow-lg shadow-brown-500/20">
            <ChefHat className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-brown-700 font-display mb-2">
            菜谱详情
          </h1>
          <p className="text-brown-400">
            菜谱 ID: {id}
          </p>
          <div className="flex items-center justify-center gap-6 mt-6">
            <div className="flex items-center gap-2 text-brown-500">
              <Clock className="w-5 h-5" />
              <span>烹饪时间</span>
            </div>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className="w-5 h-5 text-yellow-400 fill-yellow-400"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
