import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Line, Sphere, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { soundEngine, ScaleType } from './SoundEngine'
import NoteGrid from './NoteGrid'

interface Note {
  id: string
  pitchIndex: number
  beatPosition: number
  timestamp: number
  color: string
  isPlaying?: boolean
}

interface TrailPoint {
  position: THREE.Vector3
  timestamp: number
}

const LOW_COLOR = new THREE.Color('#ff4466')
const HIGH_COLOR = new THREE.Color('#ffaa00')
const TRAIL_DURATION = 500
const NOTE_LIGHT_DURATION = 200
const MAX_NOTES = 300

const getNoteColor = (pitchIndex: number, maxPitch: number): string => {
  const t = Math.min(1, Math.max(0, pitchIndex / Math.max(1, maxPitch - 1)))
  const color = LOW_COLOR.clone().lerp(HIGH_COLOR, t)
  return `#${color.getHexString()}`
}

const getSpiralPosition = (
  beatPosition: number,
  pitchIndex: number,
  maxBeats: number,
  maxPitch: number,
  turns: number = 4,
  baseRadius: number = 1,
  radiusGrowth: number = 0.15
): THREE.Vector3 => {
  const t = beatPosition / maxBeats
  const angle = t * Math.PI * 2 * turns
  const radius = baseRadius + t * radiusGrowth * turns
  const height = (pitchIndex / Math.max(1, maxPitch - 1) - 0.5) * 2
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    height,
    Math.sin(angle) * radius
  )
}

const SpiralTrack: React.FC<{
  turns: number
  maxBeats: number
  segments?: number
}> = ({ turns, maxBeats, segments = 500 }) => {
  const points = useMemo(() => {
    const pts: [number, number, number][] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const beatPosition = t * maxBeats
      const pos = getSpiralPosition(beatPosition, 3.5, maxBeats, 8, turns, 1, 0.15)
      pts.push([pos.x, pos.y, pos.z])
    }
    return pts
  }, [turns, maxBeats, segments])

  return (
    <Line
      points={points}
      color="#00ffff44"
      lineWidth={1}
      transparent
      opacity={0.4}
    />
  )
}

const NoteSphere: React.FC<{
  note: Note
  maxBeats: number
  maxPitch: number
  turns: number
  isPlaying: boolean
  onDoubleClick: (id: string) => void
  trailPoints: TrailPoint[]
}> = ({ note, maxBeats, maxPitch, turns, isPlaying, onDoubleClick, trailPoints }) => {
  const meshRef = useRef<THREE.Mesh>(null)
  const lightRef = useRef<THREE.PointLight>(null)
  const [scale, setScale] = useState(1)

  const position = useMemo(() => 
    getSpiralPosition(note.beatPosition, note.pitchIndex, maxBeats, maxPitch, turns),
    [note.beatPosition, note.pitchIndex, maxBeats, maxPitch, turns]
  )

  useFrame(({ clock }) => {
    if (meshRef.current) {
      const pulse = 1 + Math.sin(clock.elapsedTime * 3) * 0.1
      const playScale = isPlaying ? 1.5 : 1
      setScale(pulse * playScale)
    }
    if (lightRef.current) {
      const intensity = isPlaying ? 2 : 0.5
      lightRef.current.intensity = intensity + Math.sin(clock.elapsedTime * 5) * 0.2
    }
  })

  const handleDoubleClick = useCallback((e: any) => {
    e.stopPropagation()
    onDoubleClick(note.id)
  }, [note.id, onDoubleClick])

  const trailMeshes = useMemo(() => {
    const now = Date.now()
    const recent = trailPoints.filter(p => now - p.timestamp < TRAIL_DURATION)
    return recent.map((point, i) => {
      const age = now - point.timestamp
      const alpha = Math.max(0, 0.8 * (1 - age / TRAIL_DURATION))
      return (
        <mesh key={i} position={point.position}>
          <sphereGeometry args={[0.1, 8, 8]} />
          <meshBasicMaterial
            color={note.color}
            transparent
            opacity={alpha * 0.5}
          />
        </mesh>
      )
    })
  }, [trailPoints, note.color])

  return (
    <group position={position}>
      {trailMeshes}
      <Sphere
        ref={meshRef}
        args={[0.15, 16, 16]}
        scale={scale}
        onDoubleClick={handleDoubleClick}
      >
        <meshStandardMaterial
          color={note.color}
          emissive={note.color}
          emissiveIntensity={isPlaying ? 1 : 0.3}
          metalness={0.5}
          roughness={0.2}
        />
      </Sphere>
      <pointLight
        ref={lightRef}
        color={note.color}
        intensity={0.5}
        distance={1}
        decay={2}
      />
    </group>
  )
}

const NoteTrailManager: React.FC<{
  notes: Note[]
  maxBeats: number
  maxPitch: number
  turns: number
  onNoteDoubleClick: (id: string) => void
  playingNoteIds: Set<string>
}> = ({ notes, maxBeats, maxPitch, turns, onNoteDoubleClick, playingNoteIds }) => {
  const trailsRef = useRef<Map<string, TrailPoint[]>>(new Map())

  useFrame(() => {
    const now = Date.now()
    notes.forEach(note => {
      const pos = getSpiralPosition(note.beatPosition, note.pitchIndex, maxBeats, maxPitch, turns)
      if (!trailsRef.current.has(note.id)) {
        trailsRef.current.set(note.id, [])
      }
      const trail = trailsRef.current.get(note.id)!
      trail.push({ position: pos.clone(), timestamp: now })
      while (trail.length > 0 && now - trail[0].timestamp > TRAIL_DURATION) {
        trail.shift()
      }
    })
    const noteIds = new Set(notes.map(n => n.id))
    trailsRef.current.forEach((_, id) => {
      if (!noteIds.has(id)) {
        trailsRef.current.delete(id)
      }
    })
  })

  return (
    <group>
      {notes.map(note => (
        <NoteSphere
          key={note.id}
          note={note}
          maxBeats={maxBeats}
          maxPitch={maxPitch}
          turns={turns}
          isPlaying={playingNoteIds.has(note.id)}
          onDoubleClick={onNoteDoubleClick}
          trailPoints={trailsRef.current.get(note.id) || []}
        />
      ))}
    </group>
  )
}

const Scene: React.FC<{
  notes: Note[]
  turns: number
  maxBeats: number
  maxPitch: number
  onNoteDoubleClick: (id: string) => void
  playingNoteIds: Set<string>
}> = ({ notes, turns, maxBeats, maxPitch, onNoteDoubleClick, playingNoteIds }) => {
  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={0.5} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <SpiralTrack turns={turns} maxBeats={maxBeats} />
      <NoteTrailManager
        notes={notes}
        maxBeats={maxBeats}
        maxPitch={maxPitch}
        turns={turns}
        onNoteDoubleClick={onNoteDoubleClick}
        playingNoteIds={playingNoteIds}
      />
      <OrbitControls
        enablePan={false}
        minDistance={2}
        maxDistance={10}
        minPolarAngle={Math.PI / 4}
        maxPolarAngle={Math.PI * 3 / 4}
      />
    </>
  )
}

const MelodyEditor: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [scale, setScale] = useState<ScaleType>('major')
  const [turns, setTurns] = useState(4)
  const [maxBeats] = useState(16)
  const [maxPitch] = useState(8)
  const [currentBeat, setCurrentBeat] = useState(0)
  const [playingNoteIds, setPlayingNoteIds] = useState<Set<string>>(new Set())
  const [beatPulse, setBeatPulse] = useState(false)

  const recordingStartTime = useRef<number>(0)
  const playStartTime = useRef<number>(0)
  const playIntervalRef = useRef<number | null>(null)
  const recordedNotesRef = useRef<Note[]>([])

  useEffect(() => {
    soundEngine.init()
    soundEngine.setBPM(bpm)
  }, [bpm])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (isPlaying) {
          stopPlayback()
        } else {
          startPlayback()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPlaying, notes])

  const addNote = useCallback((pitchIndex: number, beatPosition?: number) => {
    if (notes.length >= MAX_NOTES) return

    const now = Date.now()
    const timestamp = isRecording ? now - recordingStartTime.current : now
    const actualBeatPosition = beatPosition ?? (isRecording ? (timestamp / 1000) * (bpm / 60) : (notes.length % maxBeats))

    const newNote: Note = {
      id: `note-${now}-${Math.random().toString(36).substr(2, 9)}`,
      pitchIndex,
      beatPosition: actualBeatPosition,
      timestamp,
      color: getNoteColor(pitchIndex, maxPitch),
    }

    soundEngine.playNote(pitchIndex, scale)

    if (isRecording) {
      recordedNotesRef.current.push(newNote)
    }

    setNotes(prev => [...prev, newNote])

    if (!isRecording) {
      lightUpNote(newNote.id)
    }
  }, [notes.length, isRecording, bpm, maxBeats, maxPitch, scale])

  const lightUpNote = useCallback((noteId: string) => {
    setPlayingNoteIds(prev => new Set(prev).add(noteId))
    setTimeout(() => {
      setPlayingNoteIds(prev => {
        const next = new Set(prev)
        next.delete(noteId)
        return next
      })
    }, NOTE_LIGHT_DURATION)
  }, [])

  const deleteNote = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId))
    soundEngine.playDeleteSound()
  }, [])

  const clearAllNotes = useCallback(() => {
    setNotes([])
  }, [])

  const startRecording = useCallback(async () => {
    await soundEngine.init()
    setIsRecording(true)
    setIsPlaying(false)
    recordingStartTime.current = Date.now()
    recordedNotesRef.current = []
  }, [])

  const stopRecording = useCallback(() => {
    setIsRecording(false)
    if (recordedNotesRef.current.length > 0) {
      setNotes(recordedNotesRef.current)
    }
  }, [])

  const startPlayback = useCallback(async () => {
    if (notes.length === 0) return
    await soundEngine.init()

    setIsPlaying(true)
    setIsRecording(false)
    playStartTime.current = Date.now()

    const sortedNotes = [...notes].sort((a, b) => a.timestamp - b.timestamp)
    let noteIndex = 0

    const maxTimestamp = sortedNotes[sortedNotes.length - 1].timestamp + 1000

    const tick = () => {
      const elapsed = Date.now() - playStartTime.current
      const beat = (elapsed / 1000) * (bpm / 60)
      setCurrentBeat(beat % maxBeats)

      if (Math.floor(beat) !== Math.floor((elapsed - 16) / 1000 * (bpm / 60))) {
        setBeatPulse(true)
        setTimeout(() => setBeatPulse(false), 200)
      }

      while (noteIndex < sortedNotes.length && sortedNotes[noteIndex].timestamp <= elapsed) {
        const note = sortedNotes[noteIndex]
        soundEngine.playNote(note.pitchIndex, scale)
        lightUpNote(note.id)
        noteIndex++
      }

      if (elapsed < maxTimestamp && noteIndex < sortedNotes.length) {
        playIntervalRef.current = requestAnimationFrame(tick)
      } else {
        setIsPlaying(false)
        setCurrentBeat(0)
      }
    }

    playIntervalRef.current = requestAnimationFrame(tick)
  }, [notes, bpm, maxBeats, scale, lightUpNote])

  const stopPlayback = useCallback(() => {
    setIsPlaying(false)
    setCurrentBeat(0)
    setPlayingNoteIds(new Set())
    if (playIntervalRef.current) {
      cancelAnimationFrame(playIntervalRef.current)
      playIntervalRef.current = null
    }
  }, [])

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      stopPlayback()
    } else {
      startPlayback()
    }
  }, [isPlaying, startPlayback, stopPlayback])

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  const handleBpmChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newBpm = parseInt(e.target.value)
    setBpm(newBpm)
    soundEngine.setBPM(newBpm)
    setBeatPulse(true)
    setTimeout(() => setBeatPulse(false), 200)
  }, [])

  const progress = notes.length > 0 ? (currentBeat / maxBeats) * 100 : 0

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        flex: '1', 
        display: 'flex', 
        minHeight: 0,
        flexDirection: window.innerWidth < 768 ? 'row' : 'row'
      }}>
        <div style={{
          width: window.innerWidth < 768 ? '80px' : '200px',
          padding: '16px',
          display: 'flex',
          flexDirection: window.innerWidth < 768 ? 'column' : 'column',
          gap: '12px',
          order: window.innerWidth < 768 ? 2 : 0,
        }}>
          <button
            className={`btn glass-panel ${isPlaying ? 'beat-pulse' : ''}`}
            onClick={togglePlayPause}
            style={{
              background: isPlaying ? 'rgba(255, 68, 102, 0.3)' : 'rgba(255, 255, 255, 0.08)',
            }}
          >
            {isPlaying ? '⏸ 暂停' : '▶ 播放'}
          </button>

          <button
            className={`btn glass-panel ${isRecording ? 'beat-pulse' : ''}`}
            onClick={toggleRecording}
            style={{
              background: isRecording ? 'rgba(255, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.08)',
            }}
          >
            {isRecording ? '⏹ 停止' : '● 录制'}
          </button>

          <div className="glass-panel" style={{ padding: '12px' }}>
            <div style={{ fontSize: '12px', marginBottom: '8px', opacity: 0.8 }}>
              BPM: <span className={beatPulse ? 'beat-pulse' : ''}>{bpm}</span>
            </div>
            <input
              type="range"
              min="60"
              max="180"
              value={bpm}
              onChange={handleBpmChange}
              className="slider"
              style={{ width: '100%' }}
            />
          </div>

          <div className="glass-panel" style={{ padding: '12px' }}>
            <div style={{ fontSize: '12px', marginBottom: '8px', opacity: 0.8 }}>音阶</div>
            <select
              value={scale}
              onChange={(e) => setScale(e.target.value as ScaleType)}
              style={{
                width: '100%',
                padding: '6px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '4px',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <option value="major">C大调</option>
              <option value="minor">A小调</option>
              <option value="pentatonic">五声音阶</option>
            </select>
          </div>

          <div className="glass-panel" style={{ padding: '12px' }}>
            <div style={{ fontSize: '12px', marginBottom: '8px', opacity: 0.8 }}>
              圈数: {turns}
            </div>
            <input
              type="range"
              min="3"
              max="5"
              step="1"
              value={turns}
              onChange={(e) => setTurns(parseInt(e.target.value))}
              className="slider"
              style={{ width: '100%' }}
            />
          </div>

          <button
            className="btn glass-panel"
            onClick={clearAllNotes}
            style={{ marginTop: 'auto' }}
          >
            🗑 清除全部
          </button>
        </div>

        <div style={{ 
          flex: 1, 
          position: 'relative',
          minHeight: window.innerWidth < 768 ? '60%' : '75%',
        }}>
          <Canvas
            camera={{ position: [0, 0, 5], fov: 60 }}
            style={{ background: 'linear-gradient(180deg, #1a0b2e 0%, #0d0a1a 100%)' }}
            gl={{ antialias: true, alpha: false }}
          >
            <fog attach="fog" args={['#1a0b2e', 5, 20]} />
            <Scene
              notes={notes}
              turns={turns}
              maxBeats={maxBeats}
              maxPitch={maxPitch}
              onNoteDoubleClick={deleteNote}
              playingNoteIds={playingNoteIds}
            />
          </Canvas>

          <NoteGrid
            onNoteAdd={addNote}
            scale={scale}
            maxPitch={maxPitch}
            maxBeats={maxBeats}
            isRecording={isRecording}
          />
        </div>
      </div>

      <div
        className="glass-panel"
        style={{
          height: '60px',
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          margin: '10px',
          marginTop: '0',
        }}
      >
        <div style={{ fontSize: '14px', opacity: 0.9 }}>
          BPM: <span className={beatPulse ? 'beat-pulse' : ''} style={{ color: '#ffaa00' }}>{bpm}</span>
        </div>
        <div style={{ fontSize: '14px', opacity: 0.9 }}>
          音符: <span style={{ color: '#ff4466' }}>{notes.length}</span> / {MAX_NOTES}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{
            width: '100%',
            height: '4px',
            background: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '2px',
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #ff4466, #ffaa00)',
              borderRadius: '2px',
              transition: 'width 0.05s linear',
            }} />
          </div>
          <div style={{ fontSize: '11px', opacity: 0.6, textAlign: 'center' }}>
            节拍: {currentBeat.toFixed(1)} / {maxBeats}
          </div>
        </div>
        <div style={{ fontSize: '12px', opacity: 0.6 }}>
          双击音符删除 · 空格播放/暂停
        </div>
      </div>
    </div>
  )
}

export default MelodyEditor
