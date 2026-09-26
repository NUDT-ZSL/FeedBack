import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { Plus, PawPrint, Package } from 'lucide-react'
import { useStore, type Pet, type Item } from '../store'
import PetCard from '../components/PetCard'
import ItemCard from '../components/ItemCard'

type TabKey = 'myPets' | 'myItems' | 'allPets' | 'allItems'

export default function UserProfile() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()
  const { currentUser, pets, items, users, fetchPets, fetchItems, fetchUsers, fetchApplications } = useStore()
  const [tab, setTab] = useState<TabKey>('myPets')
  const [showPetModal, setShowPetModal] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [petForm, setPetForm] = useState({ name: '', breed: '', age: '', personality: '', photo: '', availableForBorrow: true, availableForAdoption: false })
  const [itemForm, setItemForm] = useState({ name: '', image: '', condition: '全新', location: '', availableForBorrow: true })

  useEffect(() => {
    fetchPets()
    fetchItems()
    fetchUsers()
    if (currentUser) fetchApplications()
  }, [currentUser])

  if (!currentUser) {
    navigate('/login')
    return null
  }

  const isOwner = currentUser.id === userId
  const viewedUser = isOwner ? currentUser : users.find((u) => u.id === userId) || currentUser

  const myPets = pets.filter((p) => p.ownerId === userId)
  const myItems = items.filter((i) => i.ownerId === userId)
  const displayPets = tab === 'myPets' ? myPets : pets
  const displayItems = tab === 'myItems' ? myItems : items
  const showPets = tab === 'myPets' || tab === 'allPets'

  const getOwnerName = (ownerId: string) => {
    const u = users.find((u) => u.id === ownerId)
    return u?.username || '未知用户'
  }

  const handlePublishPet = async () => {
    await fetch('/api/pets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...petForm, ownerId: currentUser.id }),
    })
    setShowPetModal(false)
    setPetForm({ name: '', breed: '', age: '', personality: '', photo: '', availableForBorrow: true, availableForAdoption: false })
    fetchPets()
  }

  const handlePublishItem = async () => {
    await fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...itemForm, ownerId: currentUser.id }),
    })
    setShowItemModal(false)
    setItemForm({ name: '', image: '', condition: '全新', location: '', availableForBorrow: true })
    fetchItems()
  }

  const tabs: { key: TabKey; label: string }[] = isOwner
    ? [
        { key: 'myPets', label: '我的宠物' },
        { key: 'myItems', label: '我的物品' },
        { key: 'allPets', label: '全部宠物' },
        { key: 'allItems', label: '全部物品' },
      ]
    : [
        { key: 'allPets', label: '全部宠物' },
        { key: 'allItems', label: '全部物品' },
      ]

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="glass-card p-6 mb-6 flex items-center gap-4">
        <div className="avatar-circle w-16 h-16 text-2xl" style={{ backgroundColor: '#FF9A5C' }}>
          {viewedUser.username[0].toUpperCase()}
        </div>
        <div>
          <h2 className="font-bold text-lg">{viewedUser.username}</h2>
          <p className="text-sm text-gray-500">加入于 {new Date(viewedUser.createdAt).toLocaleDateString('zh-CN')}</p>
        </div>
        {isOwner && (
          <div className="ml-auto flex gap-2">
            <button
              className="flex items-center gap-1 px-4 py-2 bg-warm-orange text-white rounded-lg text-sm hover:bg-warm-orange-light transition active:scale-95"
              onClick={() => setShowPetModal(true)}
            >
              <Plus size={16} /> 发布宠物
            </button>
            <button
              className="flex items-center gap-1 px-4 py-2 bg-warm-orange text-white rounded-lg text-sm hover:bg-warm-orange-light transition active:scale-95"
              onClick={() => setShowItemModal(true)}
            >
              <Plus size={16} /> 发布物品
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition',
              tab === t.key ? 'bg-warm-orange text-white' : 'bg-white/50 text-gray-600 hover:bg-white/70'
            )}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {showPets ? (
        displayPets.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <PawPrint size={48} className="mx-auto mb-3 opacity-40" />
            <p>暂无宠物</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {displayPets.map((pet) => (
              <PetCard key={pet.id} pet={pet} ownerName={getOwnerName(pet.ownerId)} />
            ))}
          </div>
        )
      ) : displayItems.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          <Package size={48} className="mx-auto mb-3 opacity-40" />
          <p>暂无物品</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayItems.map((item) => (
            <ItemCard key={item.id} item={item} ownerName={getOwnerName(item.ownerId)} />
          ))}
        </div>
      )}

      {showPetModal && (
        <ModalOverlay onClose={() => setShowPetModal(false)}>
          <h3 className="font-bold text-lg mb-4">发布宠物</h3>
          <div className="flex flex-col gap-3">
            <input placeholder="宠物名字" className="input-field" value={petForm.name} onChange={(e) => setPetForm({ ...petForm, name: e.target.value })} />
            <input placeholder="品种" className="input-field" value={petForm.breed} onChange={(e) => setPetForm({ ...petForm, breed: e.target.value })} />
            <input placeholder="年龄" className="input-field" value={petForm.age} onChange={(e) => setPetForm({ ...petForm, age: e.target.value })} />
            <input placeholder="性格描述" className="input-field" value={petForm.personality} onChange={(e) => setPetForm({ ...petForm, personality: e.target.value })} />
            <input placeholder="照片URL（可留空）" className="input-field" value={petForm.photo} onChange={(e) => setPetForm({ ...petForm, photo: e.target.value })} />
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={petForm.availableForBorrow} onChange={(e) => setPetForm({ ...petForm, availableForBorrow: e.target.checked })} />
                可借出
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={petForm.availableForAdoption} onChange={(e) => setPetForm({ ...petForm, availableForAdoption: e.target.checked })} />
                可领养
              </label>
            </div>
            <button className="btn-primary" onClick={handlePublishPet}>发布</button>
          </div>
        </ModalOverlay>
      )}

      {showItemModal && (
        <ModalOverlay onClose={() => setShowItemModal(false)}>
          <h3 className="font-bold text-lg mb-4">发布物品</h3>
          <div className="flex flex-col gap-3">
            <input placeholder="物品名称" className="input-field" value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} />
            <input placeholder="图片URL（可留空）" className="input-field" value={itemForm.image} onChange={(e) => setItemForm({ ...itemForm, image: e.target.value })} />
            <select className="input-field" value={itemForm.condition} onChange={(e) => setItemForm({ ...itemForm, condition: e.target.value })}>
              <option value="全新">全新</option>
              <option value="几乎全新">几乎全新</option>
              <option value="轻微使用痕迹">轻微使用痕迹</option>
              <option value="明显使用痕迹">明显使用痕迹</option>
            </select>
            <input placeholder="所在地" className="input-field" value={itemForm.location} onChange={(e) => setItemForm({ ...itemForm, location: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={itemForm.availableForBorrow} onChange={(e) => setItemForm({ ...itemForm, availableForBorrow: e.target.checked })} />
              可借出
            </label>
            <button className="btn-primary" onClick={handlePublishItem}>发布</button>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="glass-card p-6 w-full max-w-md relative z-10" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
