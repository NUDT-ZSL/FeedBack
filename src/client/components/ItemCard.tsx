import { useNavigate } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import type { Item } from '../store'

export default function ItemCard({ item, ownerName }: { item: Item; ownerName?: string }) {
  const navigate = useNavigate()

  return (
    <div
      className="glass-card overflow-hidden cursor-pointer p-4"
      onClick={() => navigate(`/detail/item/${item.id}`)}
    >
      <div className="flex gap-4">
        <div className="w-28 h-28 flex-shrink-0 overflow-hidden rounded-xl">
          <img
            src={item.image || 'https://via.placeholder.com/200x200?text=📦'}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-base mb-1 truncate">{item.name}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-warm-green/15 text-warm-green font-medium">
            {item.condition}
          </span>
          {item.location && (
            <div className="flex items-center gap-1 text-sm text-gray-500 mt-2">
              <MapPin size={14} />
              <span className="truncate">{item.location}</span>
            </div>
          )}
          {item.availableForBorrow && (
            <span className="inline-block text-xs px-2.5 py-1 rounded-full bg-warm-orange/20 text-warm-orange font-medium mt-2">
              可借出
            </span>
          )}
          {ownerName && (
            <p className="text-xs text-gray-400 mt-1">所有者: {ownerName}</p>
          )}
        </div>
      </div>
    </div>
  )
}
