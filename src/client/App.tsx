import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, RotateCcw } from 'lucide-react'
import { useSkillStore } from './store/useSkillStore'
import SkillGraph from './SkillGraph'
import PathPlanner from './PathPlanner'
import SkillTooltip from './components/SkillTooltip'
import ResourceModal from './components/ResourceModal'

export default function App() {
  const {
    skills,
    selectedSkill,
    selectedResourceId,
    targetJobId,
    fetchSkills,
    setSearchQuery,
    setTargetJob,
    setSelectedResourceId,
    resetStore,
  } = useSkillStore()

  const [searchInput, setSearchInput] = useState('')
  const [isMobile, setIsMobile] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsMobile(entry.contentRect.width < 768)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setSearchQuery(value)
      }, 200)
    },
    [setSearchQuery],
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const selectedResource = selectedResourceId
    ? skills.flatMap((s) => s.resources).find((r) => r.id === selectedResourceId) ?? null
    : null

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#1a1a2e',
        color: '#e0e0e0',
        fontFamily: 'sans-serif',
        overflow: 'hidden',
      }}
    >
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          height: 56,
          backgroundColor: '#16213e',
          borderBottom: '1px solid #0f3460',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontFamily: 'Orbitron, sans-serif',
            fontSize: 22,
            fontWeight: 700,
            color: '#e94560',
            letterSpacing: 2,
          }}
        >
          SkillMap
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <select
            value={targetJobId ?? ''}
            onChange={(e) => setTargetJob(e.target.value || null)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #0f3460',
              backgroundColor: '#1a1a2e',
              color: '#e0e0e0',
              fontSize: 14,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="">选择职位</option>
            <option value="frontend">前端工程师</option>
            <option value="backend">后端工程师</option>
            <option value="fullstack">全栈工程师</option>
            <option value="devops">DevOps 工程师</option>
          </select>

          <button
            onClick={resetStore}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #0f3460',
              backgroundColor: '#1a1a2e',
              color: '#e0e0e0',
              fontSize: 14,
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0f3460')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#1a1a2e')}
          >
            <RotateCcw size={14} />
            重置
          </button>
        </div>
      </nav>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flex: isMobile ? 'none' : '0 0 70%',
            width: isMobile ? '100%' : undefined,
            height: isMobile ? '50%' : '100%',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <SkillGraph />
        </div>

        <div
          style={{
            width: isMobile ? '100%' : 320,
            height: isMobile ? 'auto' : '100%',
            backgroundColor: '#16213e',
            borderLeft: isMobile ? 'none' : '1px solid #0f3460',
            borderTop: isMobile ? '1px solid #0f3460' : 'none',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #0f3460' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search
                size={16}
                style={{
                  position: 'absolute',
                  left: 10,
                  color: '#8b8ba3',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="搜索技能..."
                style={{
                  width: '100%',
                  padding: '8px 12px 8px 34px',
                  borderRadius: 6,
                  border: '1px solid #0f3460',
                  backgroundColor: '#1a1a2e',
                  color: '#e0e0e0',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            <PathPlanner />
          </div>
        </div>
      </div>

      {selectedSkill && (
        <SkillTooltip
          skill={selectedSkill as any}
          position={{ x: 0, y: 0 }}
          isVisible={true}
          onResourceClick={(resource: any) => setSelectedResourceId(resource.id)}
        />
      )}

      <ResourceModal
        resource={selectedResource as any}
        isOpen={selectedResourceId !== null}
        onClose={() => setSelectedResourceId(null)}
      />
    </div>
  )
}
