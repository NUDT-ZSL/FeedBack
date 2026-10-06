interface CategoryFilterProps {
  categories: string[];
  active: string;
  onChange: (category: string) => void;
}

export default function CategoryFilter({ categories, active, onChange }: CategoryFilterProps) {
  const all = ['全部', ...categories];
  return (
    <div className="category-filter">
      {all.map(category => (
        <button
          key={category}
          className={`category-pill${active === category ? ' active' : ''}`}
          onClick={() => onChange(category)}
        >
          {category}
        </button>
      ))}
    </div>
  );
}
