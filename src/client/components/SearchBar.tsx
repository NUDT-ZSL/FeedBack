import { useState, useEffect, useCallback } from 'react'
import { Search } from 'lucide-react'
import { useAppStore } from '../store'
import { cn } from '@/lib/utils'

interface SearchBarProps {
  placeholder?: string
  className?: string
}

export default function SearchBar({ placeholder = '搜索...', className }: SearchBarProps) {
  const [inputValue, setInputValue] = useState('')
  const setSearchQuery = useAppStore((state) => state.setSearchQuery)

  const debouncedSetSearch = useCallback(
    (value: string) => {
      const timer = setTimeout(() => {
        setSearchQuery(value)
      }, 200)
      return () => clearTimeout(timer)
    },
    [setSearchQuery]
  )

  useEffect(() => {
    const cleanup = debouncedSetSearch(inputValue)
    return cleanup
  }, [inputValue, debouncedSetSearch])

  return (
    <div className={cn('relative w-full max-w-md', className)}>
      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
      <Search className="w-5 h-5 text-gray-400" />
      </div>
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
      />
    </div>
  )
}
