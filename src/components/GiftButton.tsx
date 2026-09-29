import { useState, useEffect, useRef } from 'react'
import { Star, Music, Heart } from 'lucide-react'
import { GIFT_TYPES, sendGift } from '../data/mockData'
import toast from 'react-hot-toast'
import type { Work } from '../data/mockData'

interface GiftButtonProps {
  workId: string
  onGiftSent?: (work: Work) => void
}

interface Particle {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
  color: string
}

export default function GiftButton({ workId, onGiftSent }: GiftButtonProps) {
  const [particles, setParticles] = useState<Particle[]>([])
  const [starBlink, setStarBlink] = useState(false)
  const [noteFloat, setNoteFloat] = useState(false)
  const particleIdRef = useRef(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setStarBlink(prev => !prev)
    }, 300)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      setNoteFloat(prev => !prev)
    }, 400)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (particles.length > 0) {
      const interval = setInterval(() => {
        setParticles(prev =>
          prev
            .map(p => ({
              ...p,
              y: p.y + p.vy,
              x: p.x + p.vx,
              vy: p.vy - 0.2,
              size: p.size * 0.96,
              opacity: p.opacity * 0.97,
            }))
            .filter(p => p.opacity > 0.01 && p.y > -50)
        )
      }, 16)
      return () => clearInterval(interval)
    }
  }, [particles.length])

  const createHeartParticles = (x: number, y: number) => {
    const newParticles: Particle[] = []
    for (let i = 0; i < 30; i++) {
      newParticles.push({
        id: particleIdRef.current++,
        x,
        y,
        vx: (Math.random() - 0.5) * 6,
        vy: -Math.random() * 8 - 3,
        size: Math.random() * 10 + 5,
        opacity: 1,
        color: `hsl(${340 + Math.random() * 40}, 100%, ${60 + Math.random() * 20}%)`,
      })
    }
    setParticles(prev => [...prev, ...newParticles])
  }

  const handleGift = (giftType: typeof GIFT_TYPES[number]) => {
    const result = sendGift(workId, giftType.type, giftType.price)
    if (result.success && result.work) {
      toast.success(`送出了 ${giftType.name} × 1`)
      if (onGiftSent && result.work) {
        onGiftSent(result.work)
      }

      if (giftType.type === 'heart') {
        const centerX = window.innerWidth / 2
        const centerY = window.innerHeight - 100
        createHeartParticles(centerX, centerY)
      }
    }
  }

  const getGiftIcon = (type: string, size: number) => {
    switch (type) {
      case 'star':
        return <Star size={size} fill="currentColor" />
      case 'note':
        return <Music size={size} />
      case 'heart':
        return <Heart size={size} fill="currentColor" />
      default:
        return <Star size={size} />
    }
  }

  const getGiftColor = (type: string) => {
    switch (type) {
      case 'star':
        return 'text-yellow-400'
      case 'note':
        return 'text-cyan-400'
      case 'heart':
        return 'text-pink-500'
      default:
        return 'text-white'
    }
  }

  const getAnimationClass = (type: string) => {
    switch (type) {
      case 'star':
        return starBlink ? 'opacity-100 brightness-150' : 'opacity-70 brightness-100'
      case 'note':
        return 'transition-transform duration-400 ease-in-out'
      case 'heart':
        return 'hover:scale-125 active:scale-95'
      default:
        return ''
    }
  }

  return (
    <div className="relative">
      <div className="flex gap-3">
        {GIFT_TYPES.map((gift) => (
          <button
            key={gift.type}
            onClick={() => handleGift(gift)}
            className={`flex flex-col items-center gap-1.5 px-5 py-3 rounded-xl bg-white/5 border border-white/10 transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:shadow-[0_0_20px_rgba(233,69,96,0.3)] active:scale-95 ${getGiftColor(gift.type)}`}
            style={{
              transform: gift.type === 'note' ? (noteFloat ? 'translateY(-5px)' : 'translateY(0)') : undefined,
              transition: gift.type === 'note' ? 'transform 0.4s ease-in-out, box-shadow 0.4s ease' : 'all 0.3s ease',
            }}
          >
            <div className={`transition-all duration-300 ${getAnimationClass(gift.type)}`}>
              {getGiftIcon(gift.type, 24)}
            </div>
            <span className="text-xs font-medium">{gift.name}</span>
            <span className="text-[10px] text-white/50">¥{gift.price}</span>
          </button>
        ))}
      </div>

      {particles.map((particle) => (
        <div
          key={particle.id}
          className="fixed pointer-events-none z-50"
          style={{
            left: particle.x,
            top: particle.y,
            width: particle.size,
            height: particle.size,
            backgroundColor: particle.color,
            opacity: particle.opacity,
            borderRadius: '50%',
            boxShadow: `0 0 ${particle.size}px ${particle.color}`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}
    </div>
  )
}
