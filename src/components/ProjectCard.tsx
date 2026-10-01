import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Project {
  id: string;
  name: string;
  colors: string[];
  createdAt: string;
}

interface ProjectCardProps {
  project: Project;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function ProjectCard({ project, onLoad, onDelete }: ProjectCardProps) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(project.id);
  };

  return (
    <div
      onClick={() => onLoad(project.id)}
      className={cn(
        'group relative cursor-pointer rounded-xl bg-white p-4 shadow-sm',
        'border border-gray-200 transition-all duration-300 ease-out',
        'hover:-translate-y-1.5 hover:shadow-lg dark:bg-gray-800',
        'dark:border-gray-700'
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onLoad(project.id);
        }
      }}
      aria-label={`加载项目: ${project.name}`}
    >
      <button
        onClick={handleDelete}
        className={cn(
          'absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center',
          'rounded-full bg-red-50 text-red-500 opacity-0 transition-all duration-200',
          'hover:bg-red-100 focus:opacity-100 focus:outline-none focus:ring-2',
          'focus:ring-red-400 focus:ring-offset-2 group-hover:opacity-100',
          'dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
        )}
        aria-label={`删除项目: ${project.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <div className="mb-3 flex gap-1">
        {project.colors.map((color, index) => (
          <div
            key={index}
            className="h-10 flex-1 first:rounded-l-lg last:rounded-r-lg border border-white/50 shadow-inner"
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>

      <div className="space-y-1">
        <h3 className="truncate font-semibold text-gray-900 dark:text-gray-100">
          {project.name}
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {new Date(project.createdAt).toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </p>
      </div>
    </div>
  );
}
