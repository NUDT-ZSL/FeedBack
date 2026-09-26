import { useNavigate } from 'react-router-dom'
import type { Pet } from '../store'

export default function PetCard({ pet, ownerName }: { pet: Pet; ownerName?: string }) {
  const navigate = useNavigate()

  return (
    <div
      className="glass-card overflow-hidden cursor-pointer"
      onClick={() => navigate(`/detail/pet/${pet.id}`)}
    >
      <div className="aspect-[4/3] overflow-hidden">
        <img
          src={pet.photo || 'https://via.placeholder.com/400x300?text=🐾'}
          alt={pet.name}
          className="w-full h-full object-cover rounded-t-2xl"
        />
      </div>
      <div className="p-4">
        <h3 className="font-bold text-base mb-1">{pet.name}</h3>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-xs px-2 py-0.5 rounded-full bg-warm-orange/15 text-warm-orange font-medium">
            {pet.breed}
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
            {pet.age}
          </span>
        </div>
        <p className="text-sm text-gray-600 line-clamp-2 mb-3">{pet.personality}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {pet.availableForBorrow && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-warm-orange/20 text-warm-orange font-medium">
              可借出
            </span>
          )}
          {pet.availableForAdoption && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-warm-green/20 text-warm-green font-medium">
              可领养
            </span>
          )}
        </div>
        {ownerName && (
          <p className="text-xs text-gray-400 mt-2">主人: {ownerName}</p>
        )}
      </div>
    </div>
  )
}
